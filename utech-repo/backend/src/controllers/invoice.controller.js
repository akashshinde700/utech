'use strict';
const dayjs = require('dayjs');
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextNumber } = require('../utils/numbering');
const { calcLineAmount, calcTaxes, round2, roundInvoiceTotal, stateCodeOf } = require('../utils/gst');
const { streamInvoicePdf } = require('../services/invoice.pdf');
const { audit } = require('../utils/audit');

const INVOICE_INCLUDE = {
  party: true,
  lines: { include: { item: true } },
  payments: true,
  createdBy: { select: { id: true, name: true, email: true } },
};

// The company's own GSTIN state code — an invoice is intra-state only when the
// customer is registered in the same state. Set COMPANY_STATE_CODE in the env
// (2 digits, e.g. 27 = Maharashtra); falls back to the client's choice when the
// party has no GSTIN on file.
const COMPANY_STATE_CODE = (process.env.COMPANY_STATE_CODE || '').trim() || null;

function resolveIntraState(party, clientValue) {
  const partyCode = stateCodeOf(party && party.gstin);
  if (COMPANY_STATE_CODE && partyCode) return partyCode === COMPANY_STATE_CODE;
  return clientValue !== undefined ? !!clientValue : true;
}

const OPEN_STATUSES = ['ISSUED', 'PARTIALLY_PAID'];

function withOverdue(inv, startOfDay) {
  const overdue =
    OPEN_STATUSES.includes(inv.status) && inv.dueDate && new Date(inv.dueDate) < startOfDay;
  return { ...inv, overdue: !!overdue };
}

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'date', 'createdAt', 'number', 'total',
  ]);
  const startOfDay = dayjs().startOf('day').toDate();
  const where = {};
  if (req.query.status) {
    if (req.query.status === 'OVERDUE') {
      // derived, never stored: an open invoice past its due date
      where.status = { in: OPEN_STATUSES };
      where.dueDate = { lt: startOfDay };
    } else {
      const statuses = req.query.status.split(',').map((s) => s.trim());
      where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
    }
  }
  const partyId = parseInt(req.query.partyId, 10);
  if (Number.isFinite(partyId)) where.partyId = partyId;
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
    prisma.invoice.findMany({
      where, skip, take, orderBy: { [sortBy]: sortDir },
      include: { party: { select: { id: true, name: true } } },
    }),
    prisma.invoice.count({ where }),
  ]);
  res.json(paginated(items.map((i) => withOverdue(i, startOfDay)), total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  res.json(withOverdue(invoice, dayjs().startOf('day').toDate()));
}

function buildLines(lines) {
  return lines.map((l) => ({
    itemId: l.itemId || null,
    description: l.description,
    hsnCode: l.hsnCode || null,
    qty: l.qty,
    rate: l.rate,
    gstRate: l.gstRate,
    amount: calcLineAmount(l.qty, l.rate),
  }));
}

// Recompute every stored money field for a set of lines + discount + tax split.
function computeInvoiceTotals(lines, isIntraState, discount) {
  const t = calcTaxes(lines, isIntraState, discount);
  const { total, roundOff } = roundInvoiceTotal(t.total);
  return {
    subtotal: t.subtotal,
    cgst: t.cgst,
    sgst: t.sgst,
    igst: t.igst,
    discount: t.discount,
    roundOff,
    total,
  };
}

// Mirror the invoice's receivable into the party ledger so the party statement
// and outstanding balance actually reflect sales (previously only returns wrote
// ledger rows — the ledger was missing every invoice and every payment).
async function upsertInvoiceLedger(tx, invoice) {
  await tx.partyLedger.deleteMany({ where: { refType: 'invoice', refId: invoice.id } });
  if (invoice.status === 'CANCELLED') return;
  await tx.partyLedger.create({
    data: {
      partyId: invoice.partyId,
      date: invoice.date,
      refType: 'invoice',
      refId: invoice.id,
      debit: invoice.total,
      credit: 0,
      notes: `Invoice ${invoice.number}`,
    },
  });
}

async function create(req, res) {
  const { lines, isIntraState, discount = 0, ...rest } = req.body;

  const party = await prisma.party.findUnique({ where: { id: rest.partyId } });
  if (!party) throw new HttpError(400, 'Party not found');
  const intra = resolveIntraState(party, isIntraState);

  const totals = computeInvoiceTotals(lines, intra, discount);
  const number = await nextNumber('invoice', 'invoice');

  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        ...rest,
        date: new Date(rest.date),
        number,
        ...totals,
        status: 'ISSUED',
        createdById: req.user ? req.user.id : null,
        lines: { create: buildLines(lines) },
      },
      include: INVOICE_INCLUDE,
    });
    await upsertInvoiceLedger(tx, created);
    return created;
  });
  await audit(req, 'create', 'Invoice', invoice.id, { number });
  res.status(201).json(invoice);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const { lines, isIntraState, discount, ...rest } = req.body;

  const existing = await prisma.invoice.findUnique({ where: { id }, include: { lines: true } });
  if (!existing) throw new HttpError(404, 'Invoice not found');
  if (existing.status === 'CANCELLED') throw new HttpError(400, 'Cannot edit a cancelled invoice');
  if (existing.status === 'PAID' && (lines || discount !== undefined)) {
    throw new HttpError(400, 'Cannot edit the lines or discount of a paid invoice');
  }

  const data = { ...rest };
  if (rest.date) data.date = new Date(rest.date);

  // recompute totals whenever the lines OR the discount OR the tax split changed
  const linesChanged = Array.isArray(lines);
  const discountChanged = discount !== undefined;
  let recompute = linesChanged || discountChanged || isIntraState !== undefined;

  if (recompute) {
    const effLines = linesChanged
      ? lines
      : existing.lines.map((l) => ({ qty: Number(l.qty), rate: Number(l.rate), gstRate: Number(l.gstRate) }));
    const effDiscount = discountChanged ? discount : Number(existing.discount);
    // keep the split the invoice already carries unless the client sends one
    const party = await prisma.party.findUnique({ where: { id: rest.partyId ?? existing.partyId } });
    const intra = isIntraState !== undefined
      ? resolveIntraState(party, isIntraState)
      : !(Number(existing.igst) > 0);
    Object.assign(data, computeInvoiceTotals(effLines, intra, effDiscount));
  }

  const invoice = await prisma.$transaction(async (tx) => {
    if (linesChanged) {
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
    }
    const updated = await tx.invoice.update({
      where: { id },
      data: linesChanged ? { ...data, lines: { create: buildLines(lines) } } : data,
      include: INVOICE_INCLUDE,
    });
    if (recompute || rest.partyId || rest.date) await upsertInvoiceLedger(tx, updated);
    return updated;
  });
  await audit(req, 'update', 'Invoice', id);
  res.json(invoice);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.invoice.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Invoice not found');
  if (existing.status === 'CANCELLED') throw new HttpError(400, 'Invoice is already cancelled');

  // money has moved against this document — cancelling it would silently
  // erase a customer debit; a credit note is the accounting-correct reversal
  const paid = await prisma.invoicePayment.aggregate({
    where: { invoiceId: id },
    _sum: { amount: true },
  });
  if (Number(paid._sum.amount || 0) > 0 || Number(existing.amountPaid) > 0) {
    throw new HttpError(400, 'invoice has payments; use credit note');
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id }, data: { status: 'CANCELLED' } });
    await tx.partyLedger.deleteMany({ where: { refType: 'invoice', refId: id } });
  });
  await audit(req, 'cancel', 'Invoice', id, { number: existing.number });
  res.json({ ok: true });
}

async function addPayment(req, res) {
  const id = parseInt(req.params.id, 10);
  const amount = Number(req.body.amount);

  const updated = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id } });
    if (!inv) throw new HttpError(404, 'Invoice not found');
    if (inv.status === 'CANCELLED') throw new HttpError(400, 'Cannot record a payment on a cancelled invoice');
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Payment amount must be greater than 0');

    // the payments table is the source of truth for the race-free check; the
    // denormalized amountPaid is only a floor (it never decreases and is only
    // ever written here) so legacy rows that predate the payments table — or
    // seed data that sets amountPaid without rows — cannot be overpaid
    const paidAgg = await tx.invoicePayment.aggregate({
      where: { invoiceId: id },
      _sum: { amount: true },
    });
    const existingPaid = Math.max(Number(paidAgg._sum.amount || 0), Number(inv.amountPaid) || 0);
    if (existingPaid + amount > Number(inv.total)) {
      throw new HttpError(400, `Payment exceeds the invoice total (already paid ${existingPaid} of ${Number(inv.total)})`);
    }

    const newPaid = round2(existingPaid + amount);
    const status = newPaid >= Number(inv.total) ? 'PAID' : 'PARTIALLY_PAID';

    const payment = await tx.invoicePayment.create({ data: { invoiceId: id, ...req.body } });
    await tx.invoice.update({ where: { id }, data: { amountPaid: newPaid, status } });
    await tx.partyLedger.create({
      data: {
        partyId: inv.partyId,
        date: new Date(req.body.date),
        refType: 'payment',
        refId: id,
        debit: 0,
        credit: amount,
        notes: `Payment ${payment.mode}${payment.reference ? ` #${payment.reference}` : ''} — Invoice ${inv.number}`,
      },
    });

    return tx.invoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
  });

  await audit(req, 'payment', 'Invoice', id, { amount, mode: req.body.mode });
  res.json(updated);
}

async function downloadPdf(req, res) {
  const id = parseInt(req.params.id, 10);
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  return streamInvoicePdf(invoice, res);
}

module.exports = { list, get, create, update, remove, addPayment, downloadPdf };
