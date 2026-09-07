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
  const invoiceLineIds = new Set(invoice.lines.map((l) => l.id));
  for (const l of lines) {
    if (!l.invoiceLineId || !invoiceLineIds.has(Number(l.invoiceLineId))) {
      throw new HttpError(400, `Line does not belong to invoice ${invoice.number}`);
    }
    const invoiceLine = invoice.lines.find((il) => il.id === Number(l.invoiceLineId));
    const priorAgg = await prisma.salesReturnLine.aggregate({
      where: {
        invoiceLineId: Number(l.invoiceLineId),
        salesReturn: { status: { not: 'CANCELLED' } },
      },
      _sum: { qty: true },
    });
    const priorReturned = Number(priorAgg._sum.qty || 0);
    if (priorReturned + Number(l.qty) > Number(invoiceLine.qty)) {
      throw new HttpError(400, `Return quantity exceeds the invoiced quantity for line ${l.invoiceLineId} (invoiced ${Number(invoiceLine.qty)}, already returned ${priorReturned})`);
    }
  }
  
  const computedLines = buildLines(lines);
  const taxes = calcTaxes(lines, isIntraState);
  const total = round2(taxes.total - Number(discount || 0));
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
        discount,
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
    const taxes = calcTaxes(lines, isIntraState !== false);
    Object.assign(editable, {
      subtotal: taxes.subtotal,
      cgst: taxes.cgst,
      sgst: taxes.sgst,
      igst: taxes.igst,
      discount,
      total: round2(taxes.total - Number(discount || 0)),
      refundAmount: round2(taxes.total - Number(discount || 0)),
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

    // Update stock ledger for returned items
    for (const line of existing.lines) {
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
