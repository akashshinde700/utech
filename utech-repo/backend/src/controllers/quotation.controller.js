'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextNumber } = require('../utils/numbering');
const { calcLineAmount, calcTaxes, roundInvoiceTotal } = require('../utils/gst');
const Decimal = require('decimal.js');
const { audit } = require('../utils/audit');
const { quotationTypesFor, assertQuotationType } = require('../utils/typedAccess');

const INCLUDE = { party: true, lines: { include: { item: true } } };

async function lockQuotation(tx, id) {
  await tx.$queryRaw`SELECT \`id\` FROM \`Quotation\` WHERE \`id\` = ${id} FOR UPDATE`;
}

const QUOTATION_TRANSITIONS = {
  DRAFT: ['SENT'],
  SENT: ['APPROVED', 'REJECTED'],
};

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
      where, skip, take, orderBy: [{ [sortBy]: sortDir }, { id: sortDir }],
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

const maxMoney = new Decimal('999999999999.99');
function quotationTotals(lines, isIntraState, discount) {
  const taxes = calcTaxes(lines, isIntraState);
  if (new Decimal(discount).greaterThan(taxes.subtotal)) throw new HttpError(400, 'Discount cannot exceed the subtotal');
  const total = new Decimal(taxes.total).minus(discount);
  if (new Decimal(taxes.subtotal).greaterThan(maxMoney) || total.greaterThan(maxMoney)) {
    throw new HttpError(400, 'Quotation amount exceeds the supported money limit');
  }
  return { subtotal: taxes.subtotal, cgst: taxes.cgst, sgst: taxes.sgst, igst: taxes.igst, discount, total: total.toNumber() };
}

// Do not turn inconsistent historical quotation rows into a fresh receivable.
// Existing data is left untouched; the quotation must first be corrected.
function assertConvertibleAmounts(q) {
  const invalid = () => { throw new HttpError(400, 'Quotation amounts are inconsistent; correct the quotation before conversion'); };
  if (!Array.isArray(q.lines) || q.lines.length === 0) invalid();
  let sum = new Decimal(0);
  for (const line of q.lines) {
    const qty = new Decimal(String(line.qty));
    const rate = new Decimal(String(line.rate));
    const amount = new Decimal(String(line.amount));
    if (qty.lte(0) || rate.lt(0) || amount.lt(0) || !amount.eq(calcLineAmount(String(line.qty), String(line.rate)))) invalid();
    sum = sum.plus(amount);
  }
  const subtotal = new Decimal(String(q.subtotal ?? 0));
  const discount = new Decimal(String(q.discount ?? 0));
  const tax = ['cgst', 'sgst', 'igst'].reduce((total, key) => {
    const part = new Decimal(String(q[key] ?? 0));
    if (part.lt(0)) invalid();
    return total.plus(part);
  }, new Decimal(0));
  const total = new Decimal(String(q.total ?? 0));
  if (!subtotal.eq(sum) || discount.lt(0) || discount.gt(subtotal)
    || total.lt(0) || total.gt(maxMoney) || !total.eq(subtotal.plus(tax).minus(discount))) invalid();
}

async function create(req, res) {
  const { lines, isIntraState = true, discount = 0, validUntil, notes = '', headerText, footerText, type = 'CUSTOMER', ...rest } = req.body;
  assertQuotationType(req, 'create', type);
  await assertPartyFits(rest.partyId, type);
  const totals = quotationTotals(lines, isIntraState, discount);
  const number = await nextNumber('quotation', type === 'VENDOR' ? 'vendorQuotation' : 'quotation');
  const q = await prisma.quotation.create({
    data: {
      ...rest,
      type,
      date: new Date(rest.date),
      validTill: validUntil ? new Date(validUntil) : null,
      number,
      ...totals,
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
  const { lines, isIntraState = true, discount, validUntil, notes, headerText, footerText, ...rest } = req.body;
  if (rest.partyId) await assertPartyFits(rest.partyId, existing.type);
  const data = {
    ...rest,
    ...(rest.date ? { date: new Date(rest.date) } : {}),
    ...(validUntil !== undefined ? { validTill: validUntil ? new Date(validUntil) : null } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(headerText !== undefined ? { headerText: headerText || null } : {}),
    ...(footerText !== undefined ? { footerText: footerText || null } : {}),
  };
  const q = await prisma.$transaction(async (tx) => {
    await lockQuotation(tx, id);
    const current = await tx.quotation.findUnique({ where: { id }, include: { lines: true } });
    if (!current) throw new HttpError(404, 'Quotation not found');
    if (['CONVERTED', 'CANCELLED'].includes(current.status)) {
      throw new HttpError(400, `Cannot edit a ${current.status.toLowerCase()} quotation`);
    }
    const editingContent = Object.keys(req.body).some((key) => key !== 'status');
    if (rest.status && editingContent) throw new HttpError(400, 'Change quotation status separately from editing its content');
    if (rest.status && rest.status !== current.status && !(QUOTATION_TRANSITIONS[current.status] || []).includes(rest.status)) {
      throw new HttpError(400, `Cannot change quotation from ${current.status} to ${rest.status}`);
    }
    // Any edit to a sent/approved/rejected document invalidates its prior
    // decision; the revised version must be sent and accepted again.
    if (editingContent && current.status !== 'DRAFT') data.status = 'DRAFT';
    if (lines) {
      Object.assign(data, quotationTotals(lines, isIntraState, discount ?? Number(current.discount || 0)));
      await tx.quotationLine.deleteMany({ where: { quotationId: id } });
    } else if (discount !== undefined) {
      const subtotal = new Decimal(String(current.subtotal ?? 0));
      if (new Decimal(discount).greaterThan(subtotal)) throw new HttpError(400, 'Discount cannot exceed the subtotal');
      const total = subtotal.plus(String(current.cgst ?? 0)).plus(String(current.sgst ?? 0))
        .plus(String(current.igst ?? 0)).minus(discount);
      if (total.gt(maxMoney)) throw new HttpError(400, 'Quotation amount exceeds the supported money limit');
      data.discount = discount;
      data.total = total.toNumber();
    }
    return tx.quotation.update({
      where: { id },
      data: {
        ...data,
        ...(lines ? { lines: { create: buildLines(lines) } } : {}),
      },
      include: INCLUDE,
    });
  }, { isolationLevel: 'ReadCommitted' });
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
  if (q.status !== 'APPROVED') throw new HttpError(400, 'Only an approved quotation can be converted to an invoice');

  const number = await nextNumber('invoice', 'invoice');
  const invoice = await prisma.$transaction(async (tx) => {
    // Re-read after acquiring the same row lock used by quotation edits; this
    // makes the approved lines, status, invoice and ledger one atomic snapshot.
    await lockQuotation(tx, id);
    const q = await tx.quotation.findUnique({ where: { id }, include: { lines: true } });
    if (!q) throw new HttpError(404, 'Quotation not found');
    if (q.type !== 'CUSTOMER' || q.status !== 'APPROVED') {
      throw new HttpError(400, 'Only an approved customer quotation can be converted to an invoice');
    }
    assertQuotationType(req, 'update', q.type);
    assertConvertibleAmounts(q);
    const { total: roundedTotal, roundOff } = roundInvoiceTotal(Number(q.total));
    if (new Decimal(roundedTotal).greaterThan(maxMoney)) throw new HttpError(400, 'Invoice amount exceeds the supported money limit');
    const created = await tx.invoice.create({
      data: {
        number,
        date: new Date(),
        partyId: q.partyId,
        quotationId: q.id,
        status: 'ISSUED',
        subtotal: q.subtotal, cgst: q.cgst, sgst: q.sgst, igst: q.igst,
        discount: q.discount, roundOff, total: roundedTotal,
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
  }, { isolationLevel: 'ReadCommitted' });
  await audit(req, 'convertToInvoice', 'Quotation', id, { number: q.number, invoiceId: invoice.id });
  res.status(201).json(invoice);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  const result = await prisma.$transaction(async (tx) => {
    // Use the same lock as edits/conversion, then re-read before deciding
    // whether this request cancels or permanently removes the quotation.
    await lockQuotation(tx, id);
    const q = await tx.quotation.findUnique({ where: { id } });
    if (!q) throw new HttpError(404, 'Quotation not found');
    assertQuotationType(req, 'delete', q.type);
    if (q.status === 'CANCELLED') {
      // Preserve the existing behavior of keeping converted invoices.
      await tx.invoice.updateMany({ where: { quotationId: id }, data: { quotationId: null } });
      await tx.quotation.delete({ where: { id } });
      return { deleted: true, number: q.number };
    }
    await tx.quotation.update({ where: { id }, data: { status: 'CANCELLED' } });
    return { deleted: false, number: q.number };
  }, { isolationLevel: 'ReadCommitted' });
  if (!result.deleted) await audit(req, 'cancel', 'Quotation', id, { number: result.number });
  res.json({ ok: true, deleted: result.deleted });
}

module.exports = { list, get, create, update, convertToInvoice, remove };
