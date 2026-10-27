'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextNumber } = require('../utils/numbering');
const { calcLineAmount, calcTaxes, round2 } = require('../utils/gst');
const { audit } = require('../utils/audit');
const stockService = require('../services/stockService');
const { assertLines } = require('../utils/lines');
const { dateRangeFilter } = require('../utils/dates');

const SALES_RETURN_INCLUDE = {
  party: true,
  invoice: { include: { lines: true } },
  lines: { include: { item: true } },
  approvedBy: { select: { id: true, name: true, email: true } },
  receivedBy: { select: { id: true, name: true, email: true } },
  dispatchChallan: { select: { id: true, number: true, status: true, date: true } },
};

// Statuses where the physical receipt may still be recorded/changed. Once the
// stock has been put back (PROCESSED) or the document abandoned, the proof is
// frozen with the rest of the document.
const RECEIPT_OPEN_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'];
const CHALLAN_DISPATCHED_STATUSES = ['DISPATCHED', 'DELIVERED'];

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'date', 'createdAt', 'number', 'total',
  ]);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.partyId) where.partyId = parseInt(req.query.partyId, 10);
  if (req.query.invoiceId) where.invoiceId = parseInt(req.query.invoiceId, 10);
  const dateRange = dateRangeFilter(req.query.from, req.query.to);
  if (dateRange) where.date = dateRange;
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
  const seen = new Set();
  for (const l of lines) {
    if (seen.has(Number(l.invoiceLineId))) throw new HttpError(400, 'Each source line may appear only once in a return');
    seen.add(Number(l.invoiceLineId));
    if (!l.invoiceLineId || !invoiceLineIds.has(Number(l.invoiceLineId))) {
      throw new HttpError(400, `Line does not belong to invoice ${invoice.number}`);
    }
    const invoiceLine = invoice.lines.find((il) => il.id === Number(l.invoiceLineId));
    if ((invoiceLine.itemId || null) !== (l.itemId || null)) throw new HttpError(400, 'Return item must match the original invoice line');
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

// AUD-211 — a sales return proves a commercial claim, not that the goods came
// back. Stock is only allowed to move on process(), and only once this proof is
// recorded: the challan number the material arrived with, the date it was
// received, and (optionally) the outbound dispatch challan it belongs to.
//
// When a dispatch challan is named it must be the SAME customer's, it must
// actually have left the building (DISPATCHED/DELIVERED — a draft reserves
// stock but was never shipped), and the cumulative quantity returned against
// it can never exceed what that challan shipped.
async function validateReceiptProof(prismaLike, salesReturn, proof) {
  const receivedAt = new Date(proof.receivedAt);
  if (Number.isNaN(receivedAt.getTime())) {
    throw new HttpError(400, 'Received date is not a valid date');
  }
  // A receipt cannot be dated in the future: that would let someone "prove" a
  // physical return that has not happened yet. A minute of slack absorbs clock
  // skew between the client and the server.
  if (receivedAt.getTime() > Date.now() + 60 * 1000) {
    throw new HttpError(400, 'Received date cannot be in the future');
  }

  const challanId = proof.dispatchChallanId == null ? null : Number(proof.dispatchChallanId);
  if (challanId == null) return { receivedAt, challanId: null, challan: null };

  const challan = await prismaLike.dispatchChallan.findUnique({
    where: { id: challanId },
    include: { lines: true },
  });
  if (!challan) throw new HttpError(404, 'Dispatch challan not found');
  if (challan.partyId !== salesReturn.partyId) {
    throw new HttpError(400, 'The dispatch challan belongs to a different customer');
  }
  if (!CHALLAN_DISPATCHED_STATUSES.includes(challan.status)) {
    throw new HttpError(
      400,
      `Dispatch challan ${challan.number} is ${challan.status} — only dispatched or delivered goods can come back`,
    );
  }

  // Cumulative returned quantity per item against this challan, excluding the
  // return being edited/processed (its own lines must not count twice).
  const dispatchedByItem = new Map();
  for (const line of challan.lines || []) {
    const key = Number(line.itemId);
    dispatchedByItem.set(key, (dispatchedByItem.get(key) || 0) + Number(line.qty));
  }
  const returnedByItem = new Map();
  for (const line of salesReturn.lines || []) {
    if (line.itemId == null) continue;
    const key = Number(line.itemId);
    returnedByItem.set(key, (returnedByItem.get(key) || 0) + Number(line.qty));
  }
  for (const [itemId, returning] of returnedByItem.entries()) {
    const dispatched = dispatchedByItem.get(itemId) || 0;
    if (dispatched === 0) {
      throw new HttpError(
        400,
        `This return contains an item that dispatch challan ${challan.number} never shipped`,
      );
    }
    const priorAgg = await prismaLike.salesReturnLine.aggregate({
      where: {
        itemId,
        salesReturn: {
          dispatchChallanId: challanId,
          status: { not: 'CANCELLED' },
          ...(salesReturn.id ? { id: { not: salesReturn.id } } : {}),
        },
      },
      _sum: { qty: true },
    });
    const priorReturned = Number(priorAgg._sum.qty || 0);
    if (priorReturned + returning > dispatched) {
      throw new HttpError(
        400,
        `Return quantity exceeds what dispatch challan ${challan.number} shipped for this item (shipped ${dispatched}, already returned ${priorReturned})`,
      );
    }
  }

  return { receivedAt, challanId, challan };
}

// POST /sales-returns/:id/receipt — record the physical goods receipt.
async function recordReceipt(req, res) {
  const id = parseInt(req.params.id, 10);
  const { returnChallanNo, receivedAt, dispatchChallanId } = req.body;

  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.salesReturn.findUnique({ where: { id }, include: { lines: true } });
    if (!existing) throw new HttpError(404, 'Sales return not found');
    if (!RECEIPT_OPEN_STATUSES.includes(existing.status)) {
      throw new HttpError(400, `Cannot record a receipt for a sales return in ${existing.status} status`);
    }

    const proof = await validateReceiptProof(tx, existing, {
      receivedAt,
      dispatchChallanId: dispatchChallanId ?? existing.dispatchChallanId ?? null,
    });

    const saved = await tx.salesReturn.update({
      where: { id },
      data: {
        returnChallanNo: returnChallanNo.trim(),
        receivedAt: proof.receivedAt,
        receivedById: req.user ? req.user.id : null,
        dispatchChallanId: proof.challanId,
      },
      include: SALES_RETURN_INCLUDE,
    });
    await audit(req, 'receipt', 'SalesReturn', id, {
      number: saved.number, returnChallanNo: saved.returnChallanNo, dispatchChallanId: proof.challanId,
    }, tx);
    return saved;
  });

  res.json(updated);
}

async function create(req, res) {
  const { lines, isIntraState, discount = 0, ...rest } = req.body;
  assertLines(lines, { requireKey: 'invoiceLineId', requireKeyLabel: 'invoiceLineId (the invoice line this return is against)' });

  // Verify invoice exists
  const invoice = await prisma.invoice.findUnique({
    where: { id: rest.invoiceId },
    include: { party: true, lines: true }
  });
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  if (invoice.status === 'CANCELLED') throw new HttpError(400, 'Cannot return a cancelled invoice');

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
    
    await audit(req, 'create', 'SalesReturn', created.id, { number: created.number }, tx);
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

  if (lines !== undefined) {
    // readable 400s for a malformed payload (new in this branch) before the
    // stricter invoice-anchoring and over-return cap checks
    assertLines(lines, { requireKey: 'invoiceLineId', requireKeyLabel: 'invoiceLineId (the invoice line this return is against)' });

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
    if (lines !== undefined) {
      await tx.salesReturnLine.deleteMany({ where: { salesReturnId: id } });
    }
    const updated = await tx.salesReturn.update({
      where: { id },
      data: lines !== undefined
        ? { ...editable, lines: { create: buildLines(lines) } }
        : editable,
      include: SALES_RETURN_INCLUDE,
    });
    
    await audit(req, 'update', 'SalesReturn', id, { number: updated.number }, tx);
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
    
    await audit(req, 'approve', 'SalesReturn', id, { number: updated.number }, tx);
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

    // AUD-211 — no physical proof, no stock movement. Proof captured on the
    // document wins; a caller may also supply it inline (and it is then stored
    // on the same record, so the audit trail is identical either way).
    const inlineProof = req.body && (req.body.returnChallanNo || req.body.receivedAt);
    if (inlineProof) {
      const proof = await validateReceiptProof(tx, existing, {
        receivedAt: req.body.receivedAt || existing.receivedAt,
        dispatchChallanId: req.body.dispatchChallanId ?? existing.dispatchChallanId ?? null,
      });
      existing.returnChallanNo = (req.body.returnChallanNo || existing.returnChallanNo || '').trim();
      existing.receivedAt = proof.receivedAt;
      existing.dispatchChallanId = proof.challanId;
      if (!existing.returnChallanNo) {
        throw new HttpError(400, 'Record the return challan number before processing');
      }
      await tx.salesReturn.update({
        where: { id },
        data: {
          returnChallanNo: existing.returnChallanNo,
          receivedAt: existing.receivedAt,
          receivedById: req.user ? req.user.id : null,
          dispatchChallanId: existing.dispatchChallanId,
        },
      });
    }

    if (!existing.returnChallanNo || !existing.receivedAt) {
      throw new HttpError(
        400,
        'Record the physical return receipt first (return challan number and the date the goods were received) — '
        + 'without it there is no proof the material actually came back, so stock cannot be restored',
      );
    }
    if (existing.dispatchChallanId) {
      // re-validate at the moment stock moves: another return may have claimed
      // the same challan quantity since the receipt was recorded
      await validateReceiptProof(tx, existing, {
        receivedAt: existing.receivedAt,
        dispatchChallanId: existing.dispatchChallanId,
      });
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
    
    await audit(req, 'process', 'SalesReturn', id, { number: updated.number }, tx);
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

module.exports = { list, get, create, update, approve, recordReceipt, process, remove };
