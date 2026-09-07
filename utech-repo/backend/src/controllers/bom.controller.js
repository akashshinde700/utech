'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { audit } = require('../utils/audit');

const BOM_INCLUDE = {
  finishedItem: true,
  items: { include: { item: true } },
};

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, ['code', 'name', 'createdAt']);
  const where = {};
  if (search) {
    where.OR = [
      { code: { contains: search } },
      { name: { contains: search } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.bom.findMany({
      where, skip, take, orderBy: { [sortBy]: sortDir },
      include: { 
        finishedItem: { select: { id: true, code: true, name: true } },
        items: { include: { item: true } }
      },
    }),
    prisma.bom.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const bom = await prisma.bom.findUnique({ where: { id }, include: BOM_INCLUDE });
  if (!bom) throw new HttpError(404, 'BOM not found');
  res.json(bom);
}

function buildItems(items) {
  return items.map((i) => ({
    itemId: i.itemId,
    qty: i.qty,
    uomCode: i.uomCode,
    notes: i.notes,
  }));
}

async function create(req, res) {
  const { items, ...rest } = req.body;
  const computedItems = buildItems(items);

  const bom = await prisma.$transaction(async (tx) => {
    const created = await tx.bom.create({
      data: {
        ...rest,
        finishedItemId: rest.finishedItemId || null,
        items: { create: computedItems },
      },
      include: BOM_INCLUDE,
    });
    
    await audit(req, 'create', 'Bom', created.id, { code: created.code });
    return created;
  });
  
  res.status(201).json(bom);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const { items, ...rest } = req.body;

  const bom = await prisma.$transaction(async (tx) => {
    if (items) {
      await tx.bomItem.deleteMany({ where: { bomId: id } });
    }
    const updated = await tx.bom.update({
      where: { id },
      data: items
        ? { ...rest, finishedItemId: rest.finishedItemId || null, items: { create: buildItems(items) } }
        : { ...rest, finishedItemId: rest.finishedItemId || null },
      include: BOM_INCLUDE,
    });
    
    await audit(req, 'update', 'Bom', id, { code: updated.code });
    return updated;
  });
  res.json(bom);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.bom.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'BOM not found');
  
  await prisma.bom.delete({ where: { id } });
  await audit(req, 'delete', 'Bom', id, { code: existing.code });
  res.json({ ok: true });
}

module.exports = { list, get, create, update, remove };
