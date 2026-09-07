'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { audit } = require('../utils/audit');

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'createdAt', 'name', 'code',
  ]);
  const where = search
    ? { OR: [{ name: { contains: search } }, { code: { contains: search } }] }
    : {};
  const [items, total] = await Promise.all([
    prisma.machine.findMany({ where, skip, take, orderBy: { [sortBy]: sortDir } }),
    prisma.machine.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const m = await prisma.machine.findUnique({ where: { id } });
  if (!m) throw new HttpError(404, 'Machine not found');
  res.json(m);
}

async function create(req, res) {
  // explicit whitelist — raw req.body could otherwise carry id/createdAt
  const data = {};
  for (const key of ['code', 'name', 'type', 'capacity', 'status', 'notes']) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  const m = await prisma.machine.create({ data });
  audit(req, 'create', 'Machine', m.id, { code: m.code, name: m.name });
  res.status(201).json(m);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  // explicit whitelist — a generic edit must never reach id/code/createdAt
  const data = {};
  for (const key of ['name', 'type', 'capacity', 'status', 'notes']) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  const m = await prisma.machine.update({ where: { id }, data });
  audit(req, 'update', 'Machine', id, { code: m.code, name: m.name });
  res.json(m);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  await prisma.machine.update({ where: { id }, data: { status: 'RETIRED' } });
  audit(req, 'retire', 'Machine', id);
  res.json({ ok: true });
}

module.exports = { list, get, create, update, remove };
