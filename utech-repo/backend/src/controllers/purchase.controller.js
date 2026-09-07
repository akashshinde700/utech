'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextNumber } = require('../utils/numbering');
const { calcLineAmount, round2 } = require('../utils/gst');
const { audit } = require('../utils/audit');

const INCLUDE = {
  party: { select: { id: true, name: true } },
  lines: { include: { item: true } },
  grns: true,
};

// A purchase order can only be changed while it is still a proposal, and only
// while nothing has been received against it — otherwise GRN lines would end up
// pointing at PO lines that no longer exist.
const EDITABLE_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'REJECTED'];
const DECIDABLE_STATUSES = ['DRAFT', 'PENDING_APPROVAL'];

async function loadOr404(id, include) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, include });
  if (!po) throw new HttpError(404, 'Purchase order not found');
  return po;
}

function buildLines(lines) {
  return lines.map((l) => ({
    // nullable: an outsourced part is often not in the Item master
    itemId: l.itemId ? Number(l.itemId) : null,
    description: l.description || null,
    qty: Number(l.qty),
    rate: Number(l.rate),
    gstRate: Number(l.gstRate || 18),
    amount: calcLineAmount(l.qty, l.rate),
  }));
}

function calcTotals(lines) {
  let subtotal = 0, gstTotal = 0;
  for (const l of lines) {
    const amt = Number(l.qty) * Number(l.rate);
    subtotal += amt;
    gstTotal += (amt * Number(l.gstRate || 0)) / 100;
  }
  return {
    subtotal: round2(subtotal),
    gstTotal: round2(gstTotal),
    total: round2(subtotal + gstTotal),
  };
}

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'date', 'createdAt', 'number', 'total',
  ]);
  const where = {};
  if (req.query.status) {
    const statuses = req.query.status.split(',').map(s => s.trim());
    where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
  }
  if (req.query.partyId) where.partyId = parseInt(req.query.partyId, 10);
  if (search) where.OR = [{ number: { contains: search } }, { party: { name: { contains: search } } }];
  const [items, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where, skip, take, orderBy: { [sortBy]: sortDir },
      include: { party: { select: { id: true, name: true } } },
    }),
    prisma.purchaseOrder.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

async function get(req, res) {
  const po = await loadOr404(parseInt(req.params.id, 10), INCLUDE);
  res.json(po);
}

async function create(req, res) {
  const { lines, ...rest } = req.body;
  const number = await nextNumber('purchaseOrder', 'PO');
  const totals = calcTotals(lines);
  const po = await prisma.purchaseOrder.create({
    data: {
      ...rest,
      date: new Date(rest.date),
      number,
      ...totals,
      partyId: Number(rest.partyId),
      status: 'PENDING_APPROVAL',
      lines: { create: buildLines(lines) },
    },
    include: INCLUDE,
  });
  audit(req, 'create', 'PurchaseOrder', po.id, { number, total: totals.total });
  res.status(201).json(po);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await loadOr404(id, { lines: true, grns: { select: { id: true } } });
  if (!EDITABLE_STATUSES.includes(existing.status)) {
    throw new HttpError(400, `Cannot edit a purchase order in ${existing.status} status`);
  }
  const { lines, ...rest } = req.body;
  if (lines && existing.grns.length) {
    throw new HttpError(400, 'Cannot replace the lines of a purchase order that already has a GRN against it');
  }

  const data = { ...rest };
  if (rest.partyId) data.partyId = Number(rest.partyId);
  if (rest.date) data.date = new Date(rest.date);
  if (lines) Object.assign(data, calcTotals(lines));

  const po = await prisma.$transaction(async (tx) => {
    if (lines) await tx.purchaseOrderLine.deleteMany({ where: { poId: id } });
    return tx.purchaseOrder.update({
      where: { id },
      data: lines ? { ...data, lines: { create: buildLines(lines) } } : data,
      include: INCLUDE,
    });
  });
  audit(req, 'update', 'PurchaseOrder', id);
  res.json(po);
}

async function approve(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await loadOr404(id);
  if (!DECIDABLE_STATUSES.includes(existing.status)) {
    throw new HttpError(400, `Cannot approve a purchase order in ${existing.status} status`);
  }
  // separation of duties: the person who raised the PO cannot be the one who
  // approves it — unless a SUPERADMIN explicitly overrides
  if (req.user && req.user.role !== 'SUPERADMIN') {
    const creatorLog = await prisma.auditLog.findFirst({
      where: { action: 'create', entity: 'PurchaseOrder', entityId: id },
      orderBy: { id: 'asc' },
      select: { userId: true },
    });
    if (creatorLog && creatorLog.userId === req.user.id) {
      throw new HttpError(403, 'You cannot approve a purchase order you created');
    }
  }
  const po = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: 'APPROVED',
      approvedById: req.user ? req.user.id : null,
      approvedAt: new Date(),
    },
    include: INCLUDE,
  });
  audit(req, 'approve', 'PurchaseOrder', id);
  res.json(po);
}

async function reject(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await loadOr404(id);
  if (!DECIDABLE_STATUSES.includes(existing.status)) {
    throw new HttpError(400, `Cannot reject a purchase order in ${existing.status} status`);
  }
  const po = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: 'REJECTED', rejectionReason: req.body.reason || null },
    include: INCLUDE,
  });
  audit(req, 'reject', 'PurchaseOrder', id, { reason: req.body.reason });
  res.json(po);
}

async function cancel(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await loadOr404(id, { lines: true });
  if (existing.status === 'CANCELLED') throw new HttpError(400, 'This purchase order is already cancelled');
  // goods already booked in cannot be un-ordered — cancel the GRN first, which
  // reverses the stock and rolls this status back on its own
  if (existing.lines.some((l) => Number(l.qtyReceived) > 0)) {
    throw new HttpError(400, 'Cannot cancel: goods have already been received against this purchase order');
  }
  await prisma.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
  audit(req, 'cancel', 'PurchaseOrder', id, { reason: req.body.reason || null });
  res.json({ ok: true });
}

module.exports = { list, get, create, update, approve, reject, cancel };
