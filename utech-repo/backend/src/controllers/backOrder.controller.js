'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');

const BACK_ORDER_INCLUDE = {
  party: true,
  invoice: { select: { id: true, number: true } },
  lines: { include: { item: true } },
};

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'date', 'createdAt', 'number', 'expectedDate',
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
    prisma.backOrder.findMany({
      where, skip, take, orderBy: { [sortBy]: sortDir },
      include: { 
        party: { select: { id: true, name: true } }, 
        invoice: { select: { id: true, number: true } }
      },
    }),
    prisma.backOrder.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const backOrder = await prisma.backOrder.findUnique({ where: { id }, include: BACK_ORDER_INCLUDE });
  if (!backOrder) throw new HttpError(404, 'Back order not found');
  res.json(backOrder);
}

function buildLines(lines) {
  return lines.map((l) => ({
    itemId: l.itemId,
    description: l.description,
    qtyOrdered: l.qtyOrdered,
    qtyFulfilled: l.qtyFulfilled || 0,
    rate: l.rate,
    notes: l.notes,
  }));
}

async function create(req, res) {
  const { lines, ...rest } = req.body;
  
  let partyId = rest.partyId;
  if (rest.invoiceId) {
    const invoice = await prisma.invoice.findUnique({ where: { id: rest.invoiceId }, include: { party: true } });
    if (!invoice) throw new HttpError(404, 'Invoice not found');
    partyId = invoice.partyId;
  }
  
  if (!partyId) throw new HttpError(400, 'Either partyId or invoiceId is required');
  
  const computedLines = buildLines(lines);
  const number = await nextNumber('backOrder', 'backOrder');

  const backOrder = await prisma.$transaction(async (tx) => {
    const created = await tx.backOrder.create({
      data: {
        ...rest,
        partyId,
        number,
        status: 'PENDING',
        lines: { create: computedLines },
      },
      include: BACK_ORDER_INCLUDE,
    });
    
    await audit(req, 'create', 'BackOrder', created.id, { number: created.number });
    return created;
  });
  
  res.status(201).json(backOrder);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const { lines, ...rest } = req.body;

  const existing = await prisma.backOrder.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Back order not found');
  if (existing.status === 'FULFILLED' || existing.status === 'CANCELLED') {
    throw new HttpError(400, 'Cannot update back order in ' + existing.status + ' status');
  }

  const data = {};
  // explicit whitelist — a generic edit must never reach id/number/status/
  // invoiceId/partyId (status changes via the fulfill/cancel endpoints)
  for (const key of ['date', 'expectedDate', 'notes']) {
    if (rest[key] !== undefined) data[key] = rest[key];
  }
  if (data.date) data.date = new Date(data.date);

  const backOrder = await prisma.$transaction(async (tx) => {
    if (lines) {
      await tx.backOrderLine.deleteMany({ where: { backOrderId: id } });
    }
    const updated = await tx.backOrder.update({
      where: { id },
      data: lines
        ? { ...data, lines: { create: buildLines(lines) } }
        : data,
      include: BACK_ORDER_INCLUDE,
    });

    await audit(req, 'update', 'BackOrder', id, { number: updated.number });
    return updated;
  });
  res.json(backOrder);
}

async function fulfill(req, res) {
  const id = parseInt(req.params.id, 10);
  const { lineId, qty } = req.body;
  
  const backOrder = await prisma.$transaction(async (tx) => {
    const existing = await tx.backOrder.findUnique({ 
      where: { id },
      include: { lines: true }
    });
    if (!existing) throw new HttpError(404, 'Back order not found');
    if (existing.status === 'FULFILLED' || existing.status === 'CANCELLED') {
      throw new HttpError(400, 'Cannot fulfill back order in ' + existing.status + ' status');
    }

    // Update specific line
    const line = await tx.backOrderLine.findUnique({ where: { id: lineId } });
    if (!line || line.backOrderId !== id) {
      throw new HttpError(404, 'Back order line not found');
    }
    
    const newFulfilled = Number(line.qtyFulfilled) + Number(qty);
    if (newFulfilled > Number(line.qtyOrdered)) {
      throw new HttpError(400, 'Fulfilled quantity cannot exceed ordered quantity');
    }
    
    await tx.backOrderLine.update({
      where: { id: lineId },
      data: { qtyFulfilled: newFulfilled },
    });

    // Check if all lines are fulfilled
    const updatedLines = await tx.backOrderLine.findMany({ where: { backOrderId: id } });
    const allFulfilled = updatedLines.every(l => Number(l.qtyFulfilled) >= Number(l.qtyOrdered));
    
    let newStatus = existing.status;
    if (allFulfilled) {
      newStatus = 'FULFILLED';
    } else if (updatedLines.some(l => Number(l.qtyFulfilled) > 0)) {
      newStatus = 'PARTIALLY_FULFILLED';
    }

    const updated = await tx.backOrder.update({
      where: { id },
      data: { status: newStatus },
      include: BACK_ORDER_INCLUDE,
    });
    
    await audit(req, 'fulfill', 'BackOrder', id, { number: updated.number, lineId, qty });
    return updated;
  });
  res.json(backOrder);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.backOrder.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Back order not found');
  if (existing.status === 'FULFILLED') {
    throw new HttpError(400, 'Cannot cancel fulfilled back order');
  }
  
  await prisma.backOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
  await audit(req, 'cancel', 'BackOrder', id, { number: existing.number });
  res.json({ ok: true });
}

module.exports = { list, get, create, update, fulfill, remove };
