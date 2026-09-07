'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'date', 'createdAt', 'number', 'amount',
  ]);
  const where = {};
  if (req.query.category) where.category = req.query.category;
  if (req.query.partyId) where.partyId = parseInt(req.query.partyId, 10);
  if (req.query.from || req.query.to) {
    where.date = {};
    if (req.query.from) where.date.gte = new Date(req.query.from);
    if (req.query.to) where.date.lte = new Date(req.query.to);
  }
  if (search) where.OR = [{ number: { contains: search } }, { description: { contains: search } }];
  const [items, total] = await Promise.all([
    prisma.expense.findMany({
      where, skip, take, orderBy: { [sortBy]: sortDir },
      include: { party: { select: { id: true, name: true } } },
    }),
    prisma.expense.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const e = await prisma.expense.findUnique({
    where: { id },
    include: { party: true },
  });
  if (!e) throw new HttpError(404, 'Expense not found');
  res.json(e);
}

async function create(req, res) {
  if (!req.body.description?.trim()) throw new HttpError(400, 'Description is required');
  if (!req.body.amount || Number(req.body.amount) <= 0) throw new HttpError(400, 'Amount must be greater than 0');
  // explicit whitelist — raw req.body could otherwise carry id/number/createdById
  const data = {};
  for (const key of ['date', 'category', 'partyId', 'description', 'amount', 'taxAmount', 'paymentMode', 'reference', 'notes']) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  const number = await nextNumber('expense', 'EXP');
  const e = await prisma.expense.create({
    data: {
      ...data,
      date: new Date(data.date),
      number,
      createdById: req.user ? req.user.id : null,
    },
  });
  audit(req, 'create', 'Expense', e.id, { number, amount: req.body.amount });
  res.status(201).json(e);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  // explicit whitelist — a generic edit must never reach id/number/createdById
  const data = {};
  for (const key of ['date', 'category', 'partyId', 'description', 'amount', 'taxAmount', 'paymentMode', 'reference', 'notes']) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  if (data.date) data.date = new Date(data.date);
  const e = await prisma.expense.update({ where: { id }, data });
  audit(req, 'update', 'Expense', id);
  res.json(e);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  await prisma.expense.delete({ where: { id } });
  audit(req, 'delete', 'Expense', id);
  res.json({ ok: true });
}

async function summary(req, res) {
  // group by category
  const groups = await prisma.expense.groupBy({
    by: ['category'],
    _sum: { amount: true },
    _count: true,
    where: req.query.from || req.query.to
      ? {
          date: {
            ...(req.query.from ? { gte: new Date(req.query.from) } : {}),
            ...(req.query.to ? { lte: new Date(req.query.to) } : {}),
          },
        }
      : undefined,
  });
  res.json(groups.map((g) => ({
    category: g.category,
    total: Number(g._sum.amount || 0),
    count: g._count,
  })));
}

module.exports = { list, get, create, update, remove, summary };
