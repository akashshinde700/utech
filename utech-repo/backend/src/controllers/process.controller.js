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
    prisma.process.findMany({ where, skip, take, orderBy: { [sortBy]: sortDir } }),
    prisma.process.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const p = await prisma.process.findUnique({ where: { id } });
  if (!p) throw new HttpError(404, 'Process not found');
  res.json(p);
}

async function create(req, res) {
  // explicit whitelist — raw req.body could otherwise carry id/createdAt
  const data = {};
  for (const key of ['code', 'name', 'description', 'stdTimeMin', 'ratePerHour', 'isActive']) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  const p = await prisma.process.create({ data });
  audit(req, 'create', 'Process', p.id, { code: p.code, name: p.name });
  res.status(201).json(p);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  // explicit whitelist — a generic edit must never reach id/code/createdAt
  const data = {};
  for (const key of ['name', 'description', 'stdTimeMin', 'ratePerHour', 'isActive']) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  const p = await prisma.process.update({ where: { id }, data });
  audit(req, 'update', 'Process', id, { code: p.code, name: p.name });
  res.json(p);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  await prisma.process.update({ where: { id }, data: { isActive: false } });
  audit(req, 'deactivate', 'Process', id);
  res.json({ ok: true });
}

module.exports = { list, get, create, update, remove };
