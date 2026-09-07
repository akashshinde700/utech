'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const stockService = require('../services/stockService');

const INCLUDE = {
  customer: { select: { id: true, name: true, code: true } },
  jobcard: { select: { id: true, number: true } },
  item: { select: { id: true, name: true, code: true } },
  createdBy: { select: { id: true, name: true } },
};

// active = not yet fully closed out (dispatched back to the customer, or
// returned unused) — this is what "Customer Inventory" actually shows.
const ACTIVE_STATUSES = ['RECEIVED', 'IN_PROCESS', 'AT_VENDOR'];

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'receivedDate', 'createdAt', 'inwardNumber',
  ]);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.customerId) where.customerId = parseInt(req.query.customerId, 10);
  if (req.query.activeOnly === '1') where.status = { in: ACTIVE_STATUSES };
  if (search) {
    where.OR = [
      { inwardNumber: { contains: search } },
      { materialDescription: { contains: search } },
      { heatNumber: { contains: search } },
      { lotNumber: { contains: search } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.customerMaterialLot.findMany({
      where, skip, take, orderBy: { [sortBy]: sortDir }, include: INCLUDE,
    }),
    prisma.customerMaterialLot.count({ where }),
  ]);
  const withQty = await Promise.all(items.map(async (lot) => ({
    ...lot,
    availableQty: await stockService.getCustomerLotAvailableQty(prisma, lot.id),
  })));
  res.json(paginated(withQty, total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const lot = await prisma.customerMaterialLot.findUnique({
    where: { id },
    include: { ...INCLUDE, stockLedger: { orderBy: { date: 'asc' } } },
  });
  if (!lot) throw new HttpError(404, 'Customer material lot not found');
  const availableQty = await stockService.getCustomerLotAvailableQty(prisma, id);
  res.json({ ...lot, availableQty });
}

async function create(req, res) {
  const inwardNumber = await nextNumber('customerMaterialLot', 'customerMaterialLot', 'inwardNumber');
  const lot = await prisma.$transaction(async (tx) => {
    const created = await tx.customerMaterialLot.create({
      data: {
        ...req.body,
        inwardNumber,
        status: 'RECEIVED',
        createdById: req.user ? req.user.id : null,
      },
      include: INCLUDE,
    });
    await stockService.moveCustomerMaterial({
      tx, lotId: created.id, date: created.receivedDate,
      refType: 'CUSTOMER_INWARD', refId: created.id, qtyIn: created.qty,
      notes: `Inward ${created.inwardNumber}`,
    });
    return created;
  });
  await audit(req, 'create', 'CustomerMaterialLot', lot.id, { inwardNumber });
  res.status(201).json(lot);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const lot = await prisma.customerMaterialLot.update({ where: { id }, data: req.body, include: INCLUDE });
  await audit(req, 'update', 'CustomerMaterialLot', id);
  res.json(lot);
}

async function disposition(req, res, { refType, toStatus, auditAction }) {
  const id = parseInt(req.params.id, 10);
  const { qty, notes } = req.body;
  const lot = await prisma.$transaction(async (tx) => {
    const existing = await tx.customerMaterialLot.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Customer material lot not found');
    await stockService.moveCustomerMaterial({ tx, lotId: id, refType, refId: id, qtyOut: qty, notes });
    const remaining = await stockService.getCustomerLotAvailableQty(tx, id);
    return tx.customerMaterialLot.update({
      where: { id },
      data: { status: remaining <= 0 ? toStatus : existing.status },
      include: INCLUDE,
    });
  });
  await audit(req, auditAction, 'CustomerMaterialLot', id, { qty });
  res.json(lot);
}

const consume = (req, res) => disposition(req, res, { refType: 'CUSTOMER_CONSUMPTION', toStatus: 'CONSUMED', auditAction: 'consume' });
const dispatchToCustomer = (req, res) => disposition(req, res, { refType: 'CUSTOMER_DISPATCH', toStatus: 'DISPATCHED', auditAction: 'dispatchToCustomer' });
const returnToCustomer = (req, res) => disposition(req, res, { refType: 'CUSTOMER_RETURN', toStatus: 'RETURNED_TO_CUSTOMER', auditAction: 'returnToCustomer' });

module.exports = { list, get, create, update, consume, dispatchToCustomer, returnToCustomer };
