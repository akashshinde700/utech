'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextNumber } = require('../utils/numbering');
const { calcLineAmount, calcTaxes, round2 } = require('../utils/gst');
const { audit } = require('../utils/audit');
const { quotationTypesFor, assertQuotationType } = require('../utils/typedAccess');

const INCLUDE = { party: true, lines: { include: { item: true } } };

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'date', 'createdAt', 'number', 'total',
  ]);
  const where = {};
  // only the kinds (customer / vendor) the caller may read, optionally narrowed
  const readable = quotationTypesFor(req, 'read');
  where.type = { in: req.query.type ? readable.filter((t) => t === req.query.type) : readable };
  if (req.query.status) where.status = req.query.status;
  if (search) where.OR = [{ number: { contains: search } }, { party: { name: { contains: search } } }];
  const [items, total] = await Promise.all([
    prisma.quotation.findMany({
      where, skip, take, orderBy: { [sortBy]: sortDir },
      include: { party: { select: { id: true, name: true } } },
    }),
    prisma.quotation.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const q = await prisma.quotation.findUnique({ where: { id }, include: INCLUDE });
  if (!q) throw new HttpError(404, 'Quotation not found');
  assertQuotationType(req, 'read', q.type);
  res.json(q);
}

// A customer quotation goes to a customer, a vendor quotation comes from a
// vendor; a BOTH party fits either.
async function assertPartyFits(partyId, type) {
  const party = await prisma.party.findUnique({ where: { id: partyId }, select: { type: true, name: true } });
  if (!party) throw new HttpError(400, 'Party not found');
  const ok = party.type === 'BOTH' || party.type === type;
  if (!ok) {
    throw new HttpError(400, `${party.name} is a ${party.type.toLowerCase()} — pick a ${type.toLowerCase()} for a ${type.toLowerCase()} quotation`);
  }
}

function buildLines(lines) {
  // quotations are sent without GST — rate/amount are the final figures
  return lines.map((l) => ({
    itemId: l.itemId || null,
    description: l.description || '',
    drgNo: l.drgNo || null,
    qty: l.qty,
    rate: l.rate,
    gstRate: 0,
    amount: calcLineAmount(l.qty, l.rate),
  }));
}

async function create(req, res) {
  const { lines, isIntraState = true, discount = 0, validUntil, notes = '', headerText, footerText, type = 'CUSTOMER', ...rest } = req.body;
  assertQuotationType(req, 'create', type);
  await assertPartyFits(rest.partyId, type);
  const taxes = calcTaxes(lines, isIntraState);
  const total = round2(taxes.total - Number(discount || 0));
  const number = await nextNumber('quotation', type === 'VENDOR' ? 'vendorQuotation' : 'quotation');
  const q = await prisma.quotation.create({
    data: {
      ...rest,
      type,
      date: new Date(rest.date),
      validTill: validUntil ? new Date(validUntil) : null,
      number,
      subtotal: taxes.subtotal,
      cgst: taxes.cgst,
      sgst: taxes.sgst,
      igst: taxes.igst,
      discount,
      total,
      notes,
      headerText: headerText || null,
      footerText: footerText || null,
      status: 'DRAFT',
      lines: { create: buildLines(lines) },
    },
    include: INCLUDE,
  });
  await audit(req, 'create', 'Quotation', q.id, { number: q.number });
  res.status(201).json(q);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.quotation.findUnique({ where: { id }, select: { type: true } });
  if (!existing) throw new HttpError(404, 'Quotation not found');
  assertQuotationType(req, 'update', existing.type);
  const { lines, isIntraState = true, discount = 0, validUntil, notes, headerText, footerText, ...rest } = req.body;
  if (rest.partyId) await assertPartyFits(rest.partyId, existing.type);
  const data = {
    ...rest,
    ...(rest.date ? { date: new Date(rest.date) } : {}),
    ...(validUntil !== undefined ? { validTill: validUntil ? new Date(validUntil) : null } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(headerText !== undefined ? { headerText: headerText || null } : {}),
    ...(footerText !== undefined ? { footerText: footerText || null } : {}),
  };
  if (lines) {
    const taxes = calcTaxes(lines, isIntraState);
    data.subtotal = taxes.subtotal;
    data.cgst = taxes.cgst;
    data.sgst = taxes.sgst;
    data.igst = taxes.igst;
    data.discount = discount;
    data.total = round2(taxes.total - Number(discount || 0));
  }
  const q = await prisma.$transaction(async (tx) => {
    if (lines) {
      await tx.quotationLine.deleteMany({ where: { quotationId: id } });
    }
    return tx.quotation.update({
      where: { id },
      data: {
        ...data,
        ...(lines ? { lines: { create: buildLines(lines) } } : {}),
      },
      include: INCLUDE,
    });
  });
  await audit(req, 'update', 'Quotation', id, { number: q.number });
  res.json(q);
}

async function convertToInvoice(req, res) {
  const id = parseInt(req.params.id, 10);
  const q = await prisma.quotation.findUnique({ where: { id }, include: { lines: true } });
  if (!q) throw new HttpError(404, 'Quotation not found');
  // a vendor's quote is something we buy — it never becomes our sales invoice
  if (q.type !== 'CUSTOMER') throw new HttpError(400, 'Only a customer quotation can be converted to an invoice');
  assertQuotationType(req, 'update', q.type);
  if (q.status === 'CONVERTED') throw new HttpError(400, 'Already converted');

  const number = await nextNumber('invoice', 'invoice');
  // round the carried-over grand total to the nearest rupee, like every other invoice
  const exact = round2(Number(q.total));
  const roundedTotal = Math.round(exact);
  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        number,
        date: new Date(),
        partyId: q.partyId,
        quotationId: q.id,
        status: 'ISSUED',
        subtotal: q.subtotal, cgst: q.cgst, sgst: q.sgst, igst: q.igst,
        discount: q.discount, roundOff: round2(roundedTotal - exact), total: roundedTotal,
        notes: q.notes,
        lines: {
          create: q.lines.map((l) => ({
            itemId: l.itemId,
            description: l.description,
            qty: l.qty, rate: l.rate, gstRate: l.gstRate, amount: l.amount,
          })),
        },
      },
      include: { lines: true, party: true },
    });
    await tx.quotation.update({ where: { id }, data: { status: 'CONVERTED' } });
    // mirror the receivable into the party ledger (see invoice.controller)
    await tx.partyLedger.create({
      data: {
        partyId: created.partyId, date: created.date,
        refType: 'invoice', refId: created.id,
        debit: created.total, credit: 0,
        notes: `Invoice ${created.number} (from quotation ${q.number})`,
      },
    });
    return created;
  });
  await audit(req, 'convertToInvoice', 'Quotation', id, { number: q.number, invoiceId: invoice.id });
  res.status(201).json(invoice);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  const q = await prisma.quotation.findUnique({ where: { id } });
  if (!q) throw new HttpError(404, 'Quotation not found');
  assertQuotationType(req, 'delete', q.type);

  // first delete = cancel; deleting an already-cancelled quotation removes it for good
  if (q.status === 'CANCELLED') {
    await prisma.$transaction(async (tx) => {
      // keep any invoice that was converted from this quotation, just drop the stale link
      await tx.invoice.updateMany({ where: { quotationId: id }, data: { quotationId: null } });
      await tx.quotation.delete({ where: { id } });
    });
    return res.json({ ok: true, deleted: true });
  }

  await prisma.quotation.update({ where: { id }, data: { status: 'CANCELLED' } });
  await audit(req, 'cancel', 'Quotation', id, { number: q.number });
  res.json({ ok: true, deleted: false });
}

module.exports = { list, get, create, update, convertToInvoice, remove };
