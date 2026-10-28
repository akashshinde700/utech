'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { weightForItem, shapeFromSize } = require('../utils/materialWeight');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextCode } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const { getLowStockItems } = require('../services/stockService');

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'createdAt', 'name', 'code', 'currentStock',
  ]);
  const where = {};
  if (req.query.type) {
    const types = req.query.type.split(',').map((s) => s.trim());
    where.type = types.length === 1 ? types[0] : { in: types };
  }
  // lowStock filter — comparing two columns is awkward in Prisma where-clause,
  // so we fetch and filter post-query when requested. (small dataset for masters)
  const lowStockOnly = req.query.lowStock === '1';
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { code: { contains: search } },
      { hsnCode: { contains: search } },
      // the stock register is searched by size as often as by name
      { size: { contains: search } },
    ];
  }
  if (lowStockOnly) {
    const low = await getLowStockItems(prisma);
    const lowIds = new Set(low.map((i) => i.id));
    where.id = { in: [...lowIds] };
  }
  if (req.query.projectId) where.projectId = parseInt(req.query.projectId, 10);
  const [items, total] = await Promise.all([
    prisma.item.findMany({
      where, skip, take, orderBy: [{ [sortBy]: sortDir }, { id: sortDir }],
      include: { uom: true, category: true, project: { select: { id: true, code: true, name: true } } },
    }),
    prisma.item.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const item = await prisma.item.findUnique({
    where: { id },
    include: { uom: true, category: true, project: { select: { id: true, code: true, name: true } } },
  });
  if (!item) throw new HttpError(404, 'Item not found');
  res.json(item);
}

// Weight always follows the size with the plant's formulas, so the two can
// never disagree: a client may send a weight, it is recomputed anyway.
// Unknown size or a family with no agreed formula (pipe, flange) -> null.
function withDerivedWeight(data, existing = {}) {
  const pick = (k) => (data[k] !== undefined ? data[k] : existing[k]);
  const weight = weightForItem({ size: pick('size'), name: pick('name'), metal: pick('metal') });
  return { ...data, weightKg: weight ? weight.kg : null };
}

// What the item form shows while someone is typing: the shape the size was
// read as, and the weight the metal calculator gives it. Parsing stays on the
// server so the form and the saved row can never disagree.
async function weightPreview(req, res) {
  const { size, name, metal } = req.body;
  const parsed = shapeFromSize(size, name || '');
  const weight = weightForItem({ size, name: name || '', metal });
  res.json({
    shape: parsed ? parsed.shape : null,
    note: parsed ? parsed.note : null,
    weightKg: weight ? weight.kg : null,
    reason: weight ? null
      : !parsed ? 'size-unreadable'
        : !metal ? 'metal-missing' : 'not-calculable',
  });
}

async function create(req, res) {
  const code = await nextCode('item', 'item');
  const data = withDerivedWeight({ ...req.body, code });
  if (data.openingStock != null) data.currentStock = data.openingStock;
  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.item.create({ data });
    // an opening stock without a ledger row makes the item's history start
    // mid-air — balances would never reconcile against the first movement
    const opening = Number(created.openingStock);
    if (opening > 0) {
      await tx.stockLedger.create({
        data: {
          itemId: created.id,
          date: created.createdAt,
          refType: 'OPENING',
          refId: created.id,
          qtyIn: opening,
          qtyOut: 0,
          balance: opening,
          notes: `Opening stock for ${created.code}`,
          ownerType: 'COMPANY',
        },
      });
    }
    return created;
  });
  await audit(req, 'create', 'Item', item.id, { code: item.code, name: item.name });
  res.status(201).json(item);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  // openingStock is set once at creation (it writes an OPENING ledger row and
  // seeds currentStock) — changing it later would desync the ledger, so it is
  // never editable through a plain item edit.
  const { openingStock, ...rest } = req.body;
  const existing = await prisma.item.findUnique({ where: { id }, select: { size: true, name: true, metal: true } });
  if (!existing) throw new HttpError(404, 'Item not found');
  const data = withDerivedWeight(rest, existing);
  const item = await prisma.item.update({ where: { id }, data });
  await audit(req, 'update', 'Item', id, { code: item.code, name: item.name });
  res.json(item);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  await prisma.item.update({ where: { id }, data: { isActive: false } });
  await audit(req, 'deactivate', 'Item', id);
  res.json({ ok: true });
}

async function stockHistory(req, res) {
  const id = parseInt(req.params.id, 10);
  const rows = await prisma.stockLedger.findMany({
    // Ledger balances reflect posting order; a document may be backdated.
    where: { itemId: id }, orderBy: { id: 'asc' },
  });
  res.json(rows);
}

async function lookupUomAndCategory(_req, res) {
  const [uoms, categories] = await Promise.all([
    prisma.uom.findMany({ orderBy: { code: 'asc' } }),
    prisma.itemCategory.findMany({ orderBy: { name: 'asc' } }),
  ]);
  res.json({ uoms, categories });
}

module.exports = { list, get, create, update, remove, stockHistory, lookupUomAndCategory, weightPreview};
