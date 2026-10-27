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
  if (party.type === 'VENDOR') throw new HttpError(400, 'Select a customer, not a vendor, for a sales invoice');
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

// Optimistic row claim: a payment, cancellation or accounting edit must not
// commit using a stale balance/total/customer. updateMany takes the row lock
// and only one transaction can claim the exact version it read.
function invoiceVersion(inv) {
  return { id: inv.id, status: inv.status, amountPaid: inv.amountPaid ?? 0,
    ...(inv.total != null ? { total: inv.total } : {}),
    ...(inv.partyId != null ? { partyId: inv.partyId } : {}) };
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const { lines, isIntraState, discount, ...rest } = req.body;

  const invoice = await prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findUnique({ where: { id }, include: { lines: true } });
    if (!existing) throw new HttpError(404, 'Invoice not found');
    if (existing.status === 'CANCELLED') throw new HttpError(400, 'Cannot edit a cancelled invoice');

    const financialEdit = lines !== undefined || discount !== undefined || isIntraState !== undefined || rest.partyId !== undefined;
    if (financialEdit) {
      const payments = await tx.invoicePayment.aggregate({ where: { invoiceId: id }, _sum: { amount: true } });
      if (Number(existing.amountPaid) > 0 || Number(payments._sum.amount || 0) > 0 || ['PAID', 'PARTIALLY_PAID'].includes(existing.status)) {
        throw new HttpError(400, 'Cannot change invoice items, tax or customer after a payment. Use a credit note instead.');
      }
      const returns = await tx.salesReturn.count({ where: { invoiceId: id, status: { not: 'CANCELLED' } } });
      if (returns > 0) throw new HttpError(400, 'Cannot change an invoice with a sales return');
    }

    const data = { ...rest };
    if (rest.date) data.date = new Date(rest.date);
    const linesChanged = Array.isArray(lines);
    const recompute = linesChanged || discount !== undefined || isIntraState !== undefined || rest.partyId !== undefined;
    if (recompute) {
      const effLines = linesChanged ? lines : existing.lines.map((l) => ({ qty: Number(l.qty), rate: Number(l.rate), gstRate: Number(l.gstRate) }));
      const party = await tx.party.findUnique({ where: { id: rest.partyId ?? existing.partyId } });
      if (!party) throw new HttpError(400, 'Party not found');
      if (party.type === 'VENDOR') throw new HttpError(400, 'Select a customer, not a vendor, for a sales invoice');
      const intra = resolveIntraState(party, isIntraState !== undefined ? isIntraState : !(Number(existing.igst) > 0));
      Object.assign(data, computeInvoiceTotals(effLines, intra, discount !== undefined ? discount : Number(existing.discount)));
    }

    const claim = await tx.invoice.updateMany({ where: invoiceVersion(existing), data });
    if (!claim.count) throw new HttpError(409, 'Invoice changed while editing. Refresh and try again.');
    if (linesChanged) {
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
      await tx.invoiceLine.createMany({ data: buildLines(lines).map((line) => ({ ...line, invoiceId: id })) });
    }
    const updated = await tx.invoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
    if (recompute || rest.partyId || rest.date) await upsertInvoiceLedger(tx, updated);
    return updated;
  });
  await audit(req, 'update', 'Invoice', id);
  res.json(invoice);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id } });
    if (!inv) throw new HttpError(404, 'Invoice not found');
    if (inv.status === 'CANCELLED') throw new HttpError(400, 'Invoice is already cancelled');
    const paid = await tx.invoicePayment.aggregate({ where: { invoiceId: id }, _sum: { amount: true } });
    if (Number(paid._sum.amount || 0) > 0 || Number(inv.amountPaid) > 0) {
      throw new HttpError(400, 'invoice has payments; use credit note');
    }
    if (await tx.salesReturn.count({ where: { invoiceId: id, status: { not: 'CANCELLED' } } })) {
      throw new HttpError(400, 'Cannot cancel an invoice with a sales return');
    }
    const claim = await tx.invoice.updateMany({ where: invoiceVersion(inv), data: { status: 'CANCELLED' } });
    if (!claim.count) throw new HttpError(409, 'Invoice changed while cancelling. Refresh and try again.');
    await tx.partyLedger.deleteMany({ where: { refType: 'invoice', refId: id } });
    return inv;
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

    // Account for legacy rows that have only a header amount or only payment
    // rows. The conditional claim below serializes competing writes.
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

    const claim = await tx.invoice.updateMany({
      where: invoiceVersion(inv), data: { amountPaid: newPaid, status },
    });
    if (!claim.count) throw new HttpError(409, 'Invoice changed while recording payment. Refresh and try again.');
    const payment = await tx.invoicePayment.create({ data: { invoiceId: id, ...req.body } });
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

function taxConfig(_req, res) {
  res.json({ companyStateCode: COMPANY_STATE_CODE });
}

module.exports = { list, get, create, update, remove, addPayment, downloadPdf, taxConfig };
