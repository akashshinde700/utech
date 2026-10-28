'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const stockService = require('../services/stockService');
const { lockJobcard } = require('../utils/transactionLocks');
const { assertJobcardAccess } = require('../utils/jobcardAccess');

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
  // One repeatable-read snapshot keeps list balances and reservations aligned;
  // grouped aggregates avoid one extra query per lot.
  const result = await prisma.$transaction(async (tx) => {
    const [items, total] = await Promise.all([
      tx.customerMaterialLot.findMany({ where, skip, take, orderBy: [{ [sortBy]: sortDir }, { id: sortDir }], include: INCLUDE }),
      tx.customerMaterialLot.count({ where }),
    ]);
    const lotIds = items.map((l) => l.id);
    const sums = lotIds.length ? await tx.stockLedger.groupBy({
      by: ['customerMaterialLotId'], where: { customerMaterialLotId: { in: lotIds } },
      _sum: { qtyIn: true, qtyOut: true },
    }) : [];
    const reservations = lotIds.length ? await tx.customerMaterialAllocation.groupBy({
      by: ['lotId'], where: { lotId: { in: lotIds }, releasedAt: null }, _sum: { qty: true, weight: true },
    }) : [];
    const qtyByLot = new Map(sums.map((s) => [s.customerMaterialLotId, stockService.roundQuantity(Number(s._sum.qtyIn || 0) - Number(s._sum.qtyOut || 0))]));
    const byLot = new Map(reservations.map((r) => [r.lotId, r._sum]));
    const withQty = items.map((lot) => {
      const availableQty = qtyByLot.get(lot.id) || 0;
      const reservedQty = stockService.roundQuantity(byLot.get(lot.id)?.qty || 0);
      const reservedWeight = stockService.roundQuantity(byLot.get(lot.id)?.weight || 0);
      return { ...lot, availableQty, reservedQty, reservedWeight,
        unallocatedQty: stockService.roundQuantity(availableQty - reservedQty),
        unallocatedWeight: lot.currentWeight == null ? null : stockService.roundQuantity(Number(lot.currentWeight) - reservedWeight) };
    });
    return paginated(withQty, total, page, pageSize);
  }, { isolationLevel: 'RepeatableRead' });
  res.json(result);
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const snapshot = await prisma.$transaction(async (tx) => {
    await stockService.lockCustomerLot(tx, id);
    const lot = await tx.customerMaterialLot.findUnique({
      where: { id },
      include: {
        ...INCLUDE, stockLedger: { orderBy: { id: 'asc' } },
        allocations: { include: { jobcard: { select: { id: true, number: true, status: true, assignedOperatorId: true } } }, orderBy: { id: 'asc' } },
      },
    });
    if (!lot) throw new HttpError(404, 'Customer material lot not found');
    const availableQty = await stockService.getCustomerLotAvailableQty(tx, id);
    const reserved = await stockService.getCustomerLotReservations(tx, id);
    const canReadJobcards = req.user.role === 'SUPERADMIN' || req.user.permissions.includes('jobcard.read');
    const accessByCard = new Map();
    const allocations = [];
    if (canReadJobcards) {
      for (const allocation of lot.allocations) {
        const card = allocation.jobcard;
        if (!accessByCard.has(card.id)) {
          try { await assertJobcardAccess(req.user, card, tx); accessByCard.set(card.id, true); }
          catch (error) { if (error.statusCode !== 403) throw error; accessByCard.set(card.id, false); }
        }
        if (accessByCard.get(card.id)) {
          allocations.push({ ...allocation, jobcard: { id: card.id, number: card.number, status: card.status } });
        }
      }
    }
    return {
      ...lot, allocations, allocationDetailsRestricted: allocations.length !== lot.allocations.length,
      availableQty, reservedQty: reserved.qty, reservedWeight: reserved.weight,
      unallocatedQty: stockService.roundQuantity(availableQty - reserved.qty),
      unallocatedWeight: lot.currentWeight == null ? null : stockService.roundQuantity(Number(lot.currentWeight) - reserved.weight),
    };
  }, { isolationLevel: 'ReadCommitted' });
  res.json(snapshot);
}

async function create(req, res) {
  const inwardNumber = await nextNumber('customerMaterialLot', 'customerMaterialLot', 'inwardNumber');
  const lot = await prisma.$transaction(async (tx) => {
    const created = await tx.customerMaterialLot.create({
      data: {
        ...req.body,
        // A new inward's supplied weight is an explicit initial on-hand measurement.
        currentWeight: req.body.weight ?? null,
        inwardNumber,
        status: 'RECEIVED',
        createdById: req.user ? req.user.id : null,
      },
      include: INCLUDE,
    });
    await stockService.moveCustomerMaterial({
      tx, lotId: created.id, date: created.receivedDate,
      refType: 'CUSTOMER_INWARD', refId: created.id, qtyIn: created.qty,
      weightIn: created.weight, notes: `Inward ${created.inwardNumber}`,
    });
    return created;
  }, { isolationLevel: 'ReadCommitted' });
  await audit(req, 'create', 'CustomerMaterialLot', lot.id, { inwardNumber });
  res.status(201).json(lot);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const lot = await prisma.$transaction(async (tx) => {
    await stockService.lockCustomerLot(tx, id);
    const existing = await tx.customerMaterialLot.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Customer material lot not found');
    const data = { ...req.body };
    if ('weight' in data && (data.weight == null ? existing.weight != null : Number(data.weight) !== Number(existing.weight))) {
      const reserved = await stockService.getCustomerLotReservations(tx, id);
      if (reserved.qty > 0) throw new HttpError(400, 'Release job-card reservations before changing the original weight');
      // Editing an original value does not measure the present stock.
      data.currentWeight = null;
    }
    return tx.customerMaterialLot.update({ where: { id }, data, include: INCLUDE });
  }, { isolationLevel: 'ReadCommitted' });
  await audit(req, 'update', 'CustomerMaterialLot', id);
  res.json(lot);
}

async function allocate(req, res) {
  const lotId = parseInt(req.params.id, 10);
  const { jobcardId, qty, weight } = req.body;
  const allocation = await prisma.$transaction(async (tx) => {
    // Same order as job-card cancellation: jobcard first, then lot.
    await lockJobcard(tx, jobcardId);
    const jobcard = await tx.jobcard.findUnique({ where: { id: jobcardId } });
    if (!jobcard) throw new HttpError(404, 'Job card not found');
    await assertJobcardAccess(req.user, jobcard, tx);
    if (['COMPLETED', 'CANCELLED'].includes(jobcard.status)) throw new HttpError(400, 'Cannot reserve material for a closed job card');
    await stockService.lockCustomerLot(tx, lotId);
    const lot = await tx.customerMaterialLot.findUnique({ where: { id: lotId } });
    if (!lot) throw new HttpError(404, 'Customer material lot not found');
    if (!ACTIVE_STATUSES.includes(lot.status)) throw new HttpError(400, 'Cannot reserve a closed lot');
    if (jobcard.partyId != null && jobcard.partyId !== lot.customerId) throw new HttpError(400, 'Job card customer does not match this lot');
    if (lot.currentWeight == null) throw new HttpError(400, 'Measure and reconcile the on-hand weight before allocating');
    const availableQty = await stockService.getCustomerLotAvailableQty(tx, lotId);
    const reserved = await stockService.getCustomerLotReservations(tx, lotId);
    if (qty > stockService.roundQuantity(availableQty - reserved.qty)) throw new HttpError(400, 'Insufficient unallocated quantity');
    if (weight > stockService.roundQuantity(Number(lot.currentWeight) - reserved.weight)) throw new HttpError(400, 'Insufficient unallocated weight');
    const created = await tx.customerMaterialAllocation.create({
      data: { lotId, jobcardId, qty, weight, createdById: req.user.id },
      include: { jobcard: { select: { id: true, number: true, status: true } } },
    });
    await audit(req, 'allocate', 'CustomerMaterialLot', lotId, { allocationId: created.id, jobcardId, qty, weight }, tx, { required: true });
    return created;
  }, { isolationLevel: 'ReadCommitted' });
  res.status(201).json(allocation);
}

async function releaseAllocation(req, res) {
  const lotId = parseInt(req.params.id, 10);
  const allocationId = parseInt(req.params.allocationId, 10);
  const allocation = await prisma.$transaction(async (tx) => {
    const initial = await tx.customerMaterialAllocation.findUnique({ where: { id: allocationId } });
    if (!initial || initial.lotId !== lotId) throw new HttpError(404, 'Allocation not found');
    await lockJobcard(tx, initial.jobcardId);
    const jobcard = await tx.jobcard.findUnique({ where: { id: initial.jobcardId } });
    if (!jobcard) throw new HttpError(404, 'Job card not found');
    await assertJobcardAccess(req.user, jobcard, tx);
    await stockService.lockCustomerLot(tx, lotId);
    const existing = await tx.customerMaterialAllocation.findUnique({ where: { id: allocationId } });
    if (!existing || existing.lotId !== lotId) throw new HttpError(404, 'Allocation not found');
    if (existing.releasedAt) throw new HttpError(400, 'Allocation is already released');
    const updated = await tx.customerMaterialAllocation.update({
      where: { id: allocationId },
      data: { releasedAt: new Date(), releasedById: req.user.id, releaseReason: req.body.reason },
    });
    await audit(req, 'releaseAllocation', 'CustomerMaterialLot', lotId, { allocationId, reason: req.body.reason }, tx, { required: true });
    return updated;
  }, { isolationLevel: 'ReadCommitted' });
  res.json(allocation);
}

async function reconcileWeight(req, res) {
  const id = parseInt(req.params.id, 10);
  const lot = await prisma.$transaction(async (tx) => {
    await stockService.lockCustomerLot(tx, id);
    const existing = await tx.customerMaterialLot.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Customer material lot not found');
    const reserved = await stockService.getCustomerLotReservations(tx, id);
    if (req.body.weight < reserved.weight) throw new HttpError(400, 'Measured weight is below existing job-card reservations');
    const availableQty = await stockService.getCustomerLotAvailableQty(tx, id);
    const updated = await tx.customerMaterialLot.update({ where: { id }, data: { currentWeight: req.body.weight }, include: INCLUDE });
    await tx.stockLedger.create({ data: {
      itemId: existing.itemId || null, date: new Date(), refType: 'CUSTOMER_WEIGHT_RECONCILE', refId: id,
      qtyIn: 0, qtyOut: 0, balance: availableQty, weightBalance: req.body.weight,
      notes: req.body.reason, ownerType: 'CUSTOMER', customerMaterialLotId: id,
    } });
    await audit(req, 'reconcileWeight', 'CustomerMaterialLot', id, { previous: existing.currentWeight, measured: req.body.weight, reason: req.body.reason }, tx, { required: true });
    return updated;
  }, { isolationLevel: 'ReadCommitted' });
  res.json(lot);
}

async function disposition(req, res, { refType, toStatus, auditAction }) {
  const id = parseInt(req.params.id, 10);
  const { qty, weight, notes } = req.body;
  const lot = await prisma.$transaction(async (tx) => {
    await stockService.lockCustomerLot(tx, id);
    const existing = await tx.customerMaterialLot.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Customer material lot not found');
    await stockService.moveCustomerMaterial({ tx, lotId: id, refType, refId: id, qtyOut: qty, weightOut: weight, notes });
    const remaining = await stockService.getCustomerLotAvailableQty(tx, id);
    // Zero on-hand does not close a lot while other material is at a vendor.
    const outstanding = remaining <= 0 ? await tx.jobworkChallan.count({
      where: { customerMaterialLotId: id, status: { in: ['ISSUED', 'PARTIAL_RECEIVED'] } },
    }) : 0;
    return tx.customerMaterialLot.update({
      where: { id },
      data: { status: remaining <= 0 ? (outstanding ? 'AT_VENDOR' : toStatus) : existing.status },
      include: INCLUDE,
    });
  }, { isolationLevel: 'ReadCommitted' });
  await audit(req, auditAction, 'CustomerMaterialLot', id, { qty, weight });
  res.json(lot);
}

const consume = (req, res) => disposition(req, res, { refType: 'CUSTOMER_CONSUMPTION', toStatus: 'CONSUMED', auditAction: 'consume' });
const dispatchToCustomer = (req, res) => disposition(req, res, { refType: 'CUSTOMER_DISPATCH', toStatus: 'DISPATCHED', auditAction: 'dispatchToCustomer' });
const returnToCustomer = (req, res) => disposition(req, res, { refType: 'CUSTOMER_RETURN', toStatus: 'RETURNED_TO_CUSTOMER', auditAction: 'returnToCustomer' });

module.exports = { list, get, create, update, allocate, releaseAllocation, reconcileWeight, consume, dispatchToCustomer, returnToCustomer };
