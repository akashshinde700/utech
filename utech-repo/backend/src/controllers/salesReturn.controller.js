'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextNumber } = require('../utils/numbering');
const { calcLineAmount, calcTaxes, round2 } = require('../utils/gst');
const { audit } = require('../utils/audit');
const stockService = require('../services/stockService');

const SALES_RETURN_INCLUDE = {
  party: true,
  invoice: { include: { lines: true } },
  lines: { include: { item: true } },
  approvedBy: { select: { id: true, name: true, email: true } },
};

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'date', 'createdAt', 'number', 'total',
  ]);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.partyId) where.partyId = parseInt(req.query.partyId, 10);
  if (req.query.invoiceId) where.invoiceId = parseInt(req.query.invoiceId, 10);
  if (req.query.from || req.query.to) {
    where.date = {};
    if (req.query.from) where.date.gte = new Date(req.query.from);
    if (req.query.to) where.date.lte = new Date(req.query.to);
  }
  if (search) {
    where.OR = [
      { number: { contains: search } },
      { party: { name: { contains: search } } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.salesReturn.findMany({
      where, skip, take, orderBy: { [sortBy]: sortDir },
      include: { party: { select: { id: true, name: true } }, invoice: { select: { id: true, number: true } } },
    }),
    prisma.salesReturn.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const salesReturn = await prisma.salesReturn.findUnique({ where: { id }, include: SALES_RETURN_INCLUDE });
  if (!salesReturn) throw new HttpError(404, 'Sales return not found');
  res.json(salesReturn);
}

function buildLines(lines) {
  return lines.map((l) => ({
    invoiceLineId: l.invoiceLineId,
    itemId: l.itemId,
    description: l.description,
    hsnCode: l.hsnCode || null,
    qty: l.qty,
    rate: l.rate,
    gstRate: l.gstRate,
    amount: calcLineAmount(l.qty, l.rate),
    reason: l.reason,
  }));
}

// Shared by create AND update (AUD-202): every returned line must anchor back
// to a line of THIS invoice, and the cumulative quantity returned (this return
// + every other non-cancelled return, optionally excluding the row being
// edited) can never exceed what was actually sold. The update path used to
// skip both checks, so a DRAFT return could be edited past the invoiced
// quantity or re-pointed at another invoice's line.
async function assertReturnableLines(prismaLike, lines, invoice, excludeReturnId = null) {
  const invoiceLineIds = new Set(invoice.lines.map((l) => l.id));
  for (const l of lines) {
    if (!l.invoiceLineId || !invoiceLineIds.has(Number(l.invoiceLineId))) {
      throw new HttpError(400, `Line does not belong to invoice ${invoice.number}`);
    }
    const invoiceLine = invoice.lines.find((il) => il.id === Number(l.invoiceLineId));
    const priorAgg = await prismaLike.salesReturnLine.aggregate({
      where: {
        invoiceLineId: Number(l.invoiceLineId),
        salesReturn: {
          status: { not: 'CANCELLED' },
          ...(excludeReturnId ? { id: { not: excludeReturnId } } : {}),
        },
      },
      _sum: { qty: true },
    });
    const priorReturned = Number(priorAgg._sum.qty || 0);
    if (priorReturned + Number(l.qty) > Number(invoiceLine.qty)) {
      throw new HttpError(400, `Return quantity exceeds the invoiced quantity for line ${l.invoiceLineId} (invoiced ${Number(invoiceLine.qty)}, already returned ${priorReturned})`);
    }
  }
}

async function create(req, res) {
  const { lines, isIntraState, discount = 0, ...rest } = req.body;

  // Verify invoice exists
  const invoice = await prisma.invoice.findUnique({
    where: { id: rest.invoiceId },
    include: { party: true, lines: true }
  });
  if (!invoice) throw new HttpError(404, 'Invoice not found');

  // every returned line must anchor back to a line of THIS invoice, and the
  // cumulative quantity returned (this return + prior ones, ignoring
  // cancelled drafts) can never exceed what was actually sold
  await assertReturnableLines(prisma, lines, invoice);
  
  const computedLines = buildLines(lines);
  // AUD-204: a header discount reduces the TAXABLE value and GST is charged on
  // the net — exactly like utils/gst.js documents and Invoice.create computes.
  // The old code charged full GST and then subtracted the discount from the
  // grand total, so a return with a discount refunded a different amount than
  // the proportional value of the invoice it reverses.
  const taxes = calcTaxes(lines, isIntraState, discount);
  const total = round2(taxes.total);
  const number = await nextNumber('salesReturn', 'salesReturn');

  // explicit whitelist — nothing from the body may reach the computed money
  // fields, status, number or partyId (those are set below / by dedicated endpoints)
  const safe = {};
  for (const key of ['reason', 'notes']) if (rest[key] !== undefined) safe[key] = rest[key];

  const salesReturn = await prisma.$transaction(async (tx) => {
    const created = await tx.salesReturn.create({
      data: {
        ...safe,
        invoiceId: invoice.id,
        date: new Date(rest.date),
        partyId: invoice.partyId,
        number,
        subtotal: taxes.subtotal,
        cgst: taxes.cgst,
        sgst: taxes.sgst,
        igst: taxes.igst,
        discount: taxes.discount,
        total,
        refundAmount: total,
        status: 'DRAFT',
        lines: { create: computedLines },
      },
      include: SALES_RETURN_INCLUDE,
    });
    
    await audit(req, 'create', 'SalesReturn', created.id, { number: created.number });
    return created;
  });
  
  res.status(201).json(salesReturn);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const { lines, isIntraState, discount = 0, ...rest } = req.body;

  const existing = await prisma.salesReturn.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Sales return not found');
  if (existing.status !== 'DRAFT') {
    throw new HttpError(400, 'Cannot update sales return in ' + existing.status + ' status');
  }

  // explicit whitelist — a generic edit must never reach id/number/status/
  // invoiceId/partyId or the computed totals (those belong to the dedicated
  // approve/process endpoints and the tax engine)
  const editable = {};
  for (const key of ['date', 'reason', 'notes']) {
    if (rest[key] !== undefined) editable[key] = rest[key];
  }
  if (editable.date) editable.date = new Date(editable.date);

  if (lines) {
    // AUD-202: line replacement on edit obeys the same anchoring and
    // over-return rules as create — the return being edited no longer counts
    // against its own cap.
    const invoice = await prisma.invoice.findUnique({
      where: { id: existing.invoiceId },
      include: { party: true, lines: true },
    });
    if (!invoice) throw new HttpError(404, 'Invoice not found');
    await assertReturnableLines(prisma, lines, invoice, id);

    // AUD-204: discount-before-tax, matching Invoice.create / utils/gst.js
    const taxes = calcTaxes(lines, isIntraState !== false, discount);
    Object.assign(editable, {
      subtotal: taxes.subtotal,
      cgst: taxes.cgst,
      sgst: taxes.sgst,
      igst: taxes.igst,
      discount: taxes.discount,
      total: round2(taxes.total),
      refundAmount: round2(taxes.total),
    });
  }

  const salesReturn = await prisma.$transaction(async (tx) => {
    if (lines) {
      await tx.salesReturnLine.deleteMany({ where: { salesReturnId: id } });
    }
    const updated = await tx.salesReturn.update({
      where: { id },
      data: lines
        ? { ...editable, lines: { create: buildLines(lines) } }
        : editable,
      include: SALES_RETURN_INCLUDE,
    });
    
    await audit(req, 'update', 'SalesReturn', id, { number: updated.number });
    return updated;
  });
  res.json(salesReturn);
}

async function approve(req, res) {
  const id = parseInt(req.params.id, 10);
  const salesReturn = await prisma.$transaction(async (tx) => {
    const existing = await tx.salesReturn.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Sales return not found');
    if (existing.status !== 'DRAFT' && existing.status !== 'PENDING_APPROVAL') {
      throw new HttpError(400, 'Cannot approve sales return in ' + existing.status + ' status');
    }

    const updated = await tx.salesReturn.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: req.user ? req.user.id : null,
        approvedAt: new Date(),
      },
      include: SALES_RETURN_INCLUDE,
    });
    
    await audit(req, 'approve', 'SalesReturn', id, { number: updated.number });
    return updated;
  });
  res.json(salesReturn);
}

async function process(req, res) {
  const id = parseInt(req.params.id, 10);
  const salesReturn = await prisma.$transaction(async (tx) => {
    const existing = await tx.salesReturn.findUnique({ 
      where: { id },
      include: { lines: true }
    });
    if (!existing) throw new HttpError(404, 'Sales return not found');
    if (existing.status !== 'APPROVED') {
      throw new HttpError(400, 'Cannot process sales return in ' + existing.status + ' status');
    }

    // Update stock ledger for returned items. A description-only line (no
    // catalog item) has no stock position — the sale never moved item stock
    // for it, so "restoring" it would mint inventory out of thin air
    // (AUD-203). The party-ledger credit below still covers it.
    for (const line of existing.lines) {
      if (line.itemId == null) continue;
      await stockService.moveCompanyStock({
        tx, itemId: line.itemId, date: new Date(),
        refType: 'SALES_RETURN', refId: id, qtyIn: line.qty,
        notes: `Sales return ${existing.number}`, skipAudit: true,
      });
    }

    // Update party ledger
    await tx.partyLedger.create({
      data: {
        partyId: existing.partyId,
        date: new Date(),
        refType: 'SALES_RETURN',
        refId: id,
        debit: 0,
        credit: existing.refundAmount,
        notes: `Sales return ${existing.number}`,
      },
    });

    const updated = await tx.salesReturn.update({
      where: { id },
      data: { status: 'PROCESSED' },
      include: SALES_RETURN_INCLUDE,
    });
    
    await audit(req, 'process', 'SalesReturn', id, { number: updated.number });
    return updated;
  });
  res.json(salesReturn);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.salesReturn.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Sales return not found');
  if (existing.status !== 'DRAFT') {
    throw new HttpError(400, 'Cannot cancel sales return in ' + existing.status + ' status');
  }
  
  await prisma.salesReturn.update({ where: { id }, data: { status: 'CANCELLED' } });
  await audit(req, 'cancel', 'SalesReturn', id, { number: existing.number });
  res.json({ ok: true });
}

module.exports = { list, get, create, update, approve, process, remove };
