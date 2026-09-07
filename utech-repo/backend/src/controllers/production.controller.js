'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const stockService = require('../services/stockService');

const PRODUCTION_INCLUDE = {
  shift: true,
  jobcard: { select: { id: true, number: true } },
  item: true,
  bom: { include: { items: { include: { item: true } } } },
  machine: true,
  materialConsumptions: { include: { item: true } },
};

async function listShifts(req, res) {
  const shifts = await prisma.shift.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
  });
  res.json(shifts);
}

async function createShift(req, res) {
  const data = {};
  // explicit whitelist — raw req.body could otherwise carry id/createdAt
  for (const key of ['code', 'name', 'startTime', 'endTime', 'isActive']) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  const shift = await prisma.shift.create({
    data,
  });
  await audit(req, 'create', 'Shift', shift.id, { code: shift.code });
  res.status(201).json(shift);
}

async function updateShift(req, res) {
  const id = parseInt(req.params.id, 10);
  const data = {};
  // explicit whitelist — code is the shift's identity, status fields are not editable here
  for (const key of ['name', 'startTime', 'endTime', 'isActive']) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  const shift = await prisma.shift.update({
    where: { id },
    data,
  });
  await audit(req, 'update', 'Shift', id, { code: shift.code });
  res.json(shift);
}

async function listBatches(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'date', 'createdAt', 'number',
  ]);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.shiftId) where.shiftId = parseInt(req.query.shiftId, 10);
  if (req.query.jobcardId) where.jobcardId = parseInt(req.query.jobcardId, 10);
  if (req.query.itemId) where.itemId = parseInt(req.query.itemId, 10);
  if (req.query.machineId) where.machineId = parseInt(req.query.machineId, 10);
  if (req.query.from || req.query.to) {
    where.date = {};
    if (req.query.from) where.date.gte = new Date(req.query.from);
    if (req.query.to) where.date.lte = new Date(req.query.to);
  }
  if (search) {
    where.OR = [
      { number: { contains: search } },
      { item: { name: { contains: search } } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.productionBatch.findMany({
      where, skip, take, orderBy: { [sortBy]: sortDir },
      include: { 
        shift: { select: { id: true, code: true, name: true } },
        item: { select: { id: true, code: true, name: true } },
        machine: { select: { id: true, code: true, name: true } }
      },
    }),
    prisma.productionBatch.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

async function getBatch(req, res) {
  const id = parseInt(req.params.id, 10);
  const batch = await prisma.productionBatch.findUnique({ where: { id }, include: PRODUCTION_INCLUDE });
  if (!batch) throw new HttpError(404, 'Production batch not found');
  res.json(batch);
}

function buildMaterialConsumptions(materials) {
  return materials.map((m) => ({
    itemId: m.itemId,
    qtyPlanned: m.qtyPlanned,
    qtyConsumed: m.qtyConsumed || 0,
    uomCode: m.uomCode,
    notes: m.notes,
  }));
}

async function createBatch(req, res) {
  const { materialConsumptions, ...rest } = req.body;
  
  // Verify shift exists
  const shift = await prisma.shift.findUnique({ where: { id: rest.shiftId } });
  if (!shift) throw new HttpError(404, 'Shift not found');
  
  // Verify item exists
  const item = await prisma.item.findUnique({ where: { id: rest.itemId } });
  if (!item) throw new HttpError(404, 'Item not found');
  
  const computedMaterials = buildMaterialConsumptions(materialConsumptions || []);
  const number = await nextNumber('productionBatch', 'productionBatch');

  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.productionBatch.create({
      data: {
        ...rest,
        date: new Date(rest.date),
        number,
        status: 'PLANNED',
        materialConsumptions: { create: computedMaterials },
      },
      include: PRODUCTION_INCLUDE,
    });
    
    await audit(req, 'create', 'ProductionBatch', created.id, { number: created.number });
    return created;
  });
  
  res.status(201).json(batch);
}

async function updateBatch(req, res) {
  const id = parseInt(req.params.id, 10);
  const { materialConsumptions, ...rest } = req.body;

  const existing = await prisma.productionBatch.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Production batch not found');
  if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
    throw new HttpError(400, 'Cannot update batch in ' + existing.status + ' status');
  }

  const data = {};
  // explicit whitelist — a generic edit must never reach id/number/status or
  // the completion quantities (set by the complete endpoint)
  for (const key of ['date', 'shiftId', 'jobcardId', 'itemId', 'bomId', 'machineId', 'qtyPlanned', 'notes']) {
    if (rest[key] !== undefined) data[key] = rest[key];
  }
  if (data.date) data.date = new Date(data.date);

  const batch = await prisma.$transaction(async (tx) => {
    if (materialConsumptions) {
      await tx.productionMaterial.deleteMany({ where: { batchId: id } });
    }
    const updated = await tx.productionBatch.update({
      where: { id },
      data: materialConsumptions
        ? { ...data, materialConsumptions: { create: buildMaterialConsumptions(materialConsumptions) } }
        : data,
      include: PRODUCTION_INCLUDE,
    });
    
    await audit(req, 'update', 'ProductionBatch', id, { number: updated.number });
    return updated;
  });
  res.json(batch);
}

async function startBatch(req, res) {
  const id = parseInt(req.params.id, 10);
  const batch = await prisma.$transaction(async (tx) => {
    const existing = await tx.productionBatch.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Production batch not found');
    if (existing.status !== 'PLANNED') {
      throw new HttpError(400, 'Cannot start batch in ' + existing.status + ' status');
    }

    const updated = await tx.productionBatch.update({
      where: { id },
      data: {
        status: 'IN_PROGRESS',
        startTime: new Date(),
      },
      include: PRODUCTION_INCLUDE,
    });
    
    await audit(req, 'start', 'ProductionBatch', id, { number: updated.number });
    return updated;
  });
  res.json(batch);
}

async function completeBatch(req, res) {
  const id = parseInt(req.params.id, 10);
  const { qtyProduced, qtyRejected } = req.body;
  
  const batch = await prisma.$transaction(async (tx) => {
    const existing = await tx.productionBatch.findUnique({ 
      where: { id },
      include: { materialConsumptions: true, item: true }
    });
    if (!existing) throw new HttpError(404, 'Production batch not found');
    if (existing.status !== 'IN_PROGRESS') {
      throw new HttpError(400, 'Cannot complete batch in ' + existing.status + ' status');
    }

    // Update finished item stock
    await stockService.moveCompanyStock({
      tx, itemId: existing.itemId, date: new Date(),
      refType: 'PRODUCTION', refId: id, qtyIn: qtyProduced,
      notes: `Production batch ${existing.number}`, skipAudit: true,
    });

    // Deduct material consumption from stock
    for (const material of existing.materialConsumptions) {
      // qtyConsumed is a Prisma Decimal object even when its value is 0 — an
      // object is always truthy, so `|| qtyPlanned` never falls through without
      // comparing the numeric value first.
      const consumedQty = Number(material.qtyConsumed) > 0 ? material.qtyConsumed : material.qtyPlanned;
      await stockService.moveCompanyStock({
        tx, itemId: material.itemId, date: new Date(),
        refType: 'PRODUCTION', refId: id, qtyOut: consumedQty,
        notes: `Production batch ${existing.number} - material consumption`, skipAudit: true,
      });
    }

    const updated = await tx.productionBatch.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        qtyProduced,
        qtyRejected,
        endTime: new Date(),
      },
      include: PRODUCTION_INCLUDE,
    });
    
    await audit(req, 'complete', 'ProductionBatch', id, { number: updated.number, qtyProduced, qtyRejected });
    return updated;
  });
  res.json(batch);
}

async function cancelBatch(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.productionBatch.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Production batch not found');
  if (existing.status === 'COMPLETED') {
    throw new HttpError(400, 'Cannot cancel completed batch');
  }
  
  await prisma.productionBatch.update({ where: { id }, data: { status: 'CANCELLED' } });
  await audit(req, 'cancel', 'ProductionBatch', id, { number: existing.number });
  res.json({ ok: true });
}

async function updateMaterialConsumption(req, res) {
  const id = parseInt(req.params.id, 10);
  const { materialId, qtyConsumed } = req.body;

  const batch = await prisma.$transaction(async (tx) => {
    const existing = await tx.productionBatch.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Production batch not found');
    // consumption drives the stock ledger at completion — editing it after
    // the batch is closed would diverge the ledger from what was moved
    if (existing.status === 'COMPLETED') {
      throw new HttpError(400, 'Cannot edit material consumption of a completed batch');
    }

    const material = await tx.productionMaterial.findUnique({ where: { id: materialId } });
    if (!material || material.batchId !== id) {
      throw new HttpError(404, 'Material not found in this batch');
    }

    const updated = await tx.productionMaterial.update({
      where: { id: materialId },
      data: { qtyConsumed },
    });

    await audit(req, 'updateMaterial', 'ProductionBatch', id, { number: existing.number, materialId, qtyConsumed });
    return updated;
  });
  res.json(batch);
}

module.exports = { 
  listShifts, createShift, updateShift,
  listBatches, getBatch, createBatch, updateBatch, startBatch, completeBatch, cancelBatch, updateMaterialConsumption 
};
