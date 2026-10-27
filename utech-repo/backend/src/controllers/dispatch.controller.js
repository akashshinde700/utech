'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const stockService = require('../services/stockService');

const INCLUDE = {
  party: { select: { id: true, name: true } },
  lines: { include: { item: true } },
};

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'date', 'createdAt', 'number',
  ]);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.partyId) where.partyId = parseInt(req.query.partyId, 10);
  if (search) where.OR = [{ number: { contains: search } }, { party: { name: { contains: search } } }];
  const [items, total] = await Promise.all([
    prisma.dispatchChallan.findMany({ where, skip, take, orderBy: { [sortBy]: sortDir }, include: { party: true } }),
    prisma.dispatchChallan.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const d = await prisma.dispatchChallan.findUnique({ where: { id }, include: INCLUDE });
  if (!d) throw new HttpError(404, 'Dispatch not found');
  res.json(d);
}


// When a challan names the invoice it fulfils, that reference has to mean
// something: the invoice must exist, belong to the same customer, still be
// live, and the goods being shipped must not exceed what was billed. Before
// this guard a challan could ship 100 pieces against a 2-piece invoice (or
// against ANOTHER customer's invoice) with no warning, so the invoice, the
// dispatch and the stock ledger told three different stories.
async function assertInvoiceCoversDispatch(tx, invoiceId, partyId, lines) {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: { lines: true, party: { select: { id: true, name: true } } },
  });
  if (!invoice) throw new HttpError(400, 'Invoice not found');
  if (invoice.status === 'CANCELLED') throw new HttpError(400, 'Cannot dispatch against a cancelled invoice');
  if (Number(invoice.partyId) !== Number(partyId)) {
    throw new HttpError(400, `Invoice ${invoice.number} belongs to ${invoice.party ? invoice.party.name : 'another customer'}, not to this challan's party`);
  }

  const invoicedByItem = new Map();
  for (const line of invoice.lines) {
    if (line.itemId == null) continue;
    invoicedByItem.set(line.itemId, (invoicedByItem.get(line.itemId) || 0) + Number(line.qty));
  }

  // everything already shipped (or queued) against this invoice
  const prior = await tx.dispatchChallan.findMany({
    where: { invoiceId, status: { not: 'CANCELLED' } },
    include: { lines: true },
  });
  const shippedByItem = new Map();
  for (const challan of prior) {
    for (const line of challan.lines) {
      if (line.itemId == null) continue;
      shippedByItem.set(line.itemId, (shippedByItem.get(line.itemId) || 0) + Number(line.qty));
    }
  }

  const requestedByItem = new Map();
  for (const line of lines) {
    if (line.itemId == null) continue;
    requestedByItem.set(line.itemId, (requestedByItem.get(line.itemId) || 0) + Number(line.qty));
  }

  for (const [itemId, requested] of requestedByItem) {
    const invoiced = invoicedByItem.get(itemId);
    if (invoiced === undefined) {
      throw new HttpError(400, `Item ${itemId} is not on invoice ${invoice.number} — bill it before dispatching`);
    }
    const alreadyShipped = stockService.roundQuantity(shippedByItem.get(itemId) || 0);
    const remaining = stockService.roundQuantity(invoiced - alreadyShipped);
    if (stockService.roundQuantity(requested) > remaining) {
      throw new HttpError(
        400,
        `Dispatch exceeds invoice ${invoice.number} for item ${itemId}: invoiced ${invoiced}, already dispatched ${alreadyShipped}, remaining ${remaining}, requested ${stockService.roundQuantity(requested)}`,
      );
    }
  }
  return invoice;
}

async function create(req, res) {
  const { lines, ...rest } = req.body;
  const number = await nextNumber('dispatchChallan', 'dispatch');
  const d = await prisma.$transaction(async (tx) => {
    const party = await tx.party.findUnique({ where: { id: rest.partyId } });
    if (!party || party.type === 'VENDOR') throw new HttpError(400, 'Select a customer for dispatch');
    if (rest.invoiceId != null) {
      await assertInvoiceCoversDispatch(tx, Number(rest.invoiceId), rest.partyId, lines);
    }
    const created = await tx.dispatchChallan.create({
      data: {
        ...rest,
        date: new Date(rest.date),
        number,
        lines: { create: lines },
      },
      include: INCLUDE,
    });
    for (const l of lines) {
      await stockService.moveCompanyStock({
        tx, itemId: l.itemId, date: new Date(rest.date),
        refType: 'DISPATCH', refId: created.id, qtyOut: l.qty,
        req, auditAction: 'create', auditEntity: 'DispatchChallan',
      });
    }
    return created;
  });
  res.status(201).json(d);
}

async function markStatus(req, res) {
  const id = parseInt(req.params.id, 10);
  const status = req.params.status.toUpperCase();
  const allowed = ['DISPATCHED', 'DELIVERED', 'CANCELLED'];
  if (!allowed.includes(status)) throw new HttpError(400, 'Invalid status');

  const d = await prisma.$transaction(async (tx) => {
    const challan = await tx.dispatchChallan.findUnique({ where: { id }, include: { lines: true } });
    if (!challan) throw new HttpError(404, 'Dispatch not found');
    const transitions = { DRAFT: ['DISPATCHED', 'CANCELLED'], DISPATCHED: ['DELIVERED', 'CANCELLED'] };
    if (!(transitions[challan.status] || []).includes(status)) {
      throw new HttpError(400, `Cannot change a ${challan.status} dispatch to ${status}`);
    }
    // Claim the status before restoring any stock. Concurrent cancellation or
    // delivery attempts cannot both act on the same stale status.
    const claim = await tx.dispatchChallan.updateMany({ where: { id, status: challan.status }, data: { status } });
    if (!claim.count) throw new HttpError(409, 'Dispatch changed. Refresh and try again.');

    // cancelling gives the goods back: every line's qty was moved OUT of
    // company stock at creation (a draft reserves stock), so a cancel moves
    // each line back IN — otherwise cancelled dispatches permanently destroy
    // inventory that never left the building
    if (status === 'CANCELLED') {
      for (const line of challan.lines) {
        const qty = Number(line.qty);
        if (qty <= 0) continue;
        await stockService.moveCompanyStock({
          tx, itemId: line.itemId, date: new Date(),
          refType: 'DISPATCH_CANCEL', refId: id, qtyIn: qty,
          notes: `Dispatch ${challan.number} cancelled`, skipAudit: true,
        });
      }
    }

    return tx.dispatchChallan.findUnique({ where: { id }, include: INCLUDE });
  });

  if (status === 'CANCELLED') {
    await audit(req, 'dispatch.cancel', 'DispatchChallan', id, {
      number: d.number, linesRestored: d.lines.length,
    });
  }
  res.json(d);
}

module.exports = { list, get, create, markStatus };
