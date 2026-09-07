'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { audit } = require('../utils/audit');

const SHAPE = (d) => ({
  id: d.id,
  name: d.name,
  code: d.code,
  description: d.description,
  isActive: d.isActive,
  departmentHeadUserId: d.departmentHeadUserId,
  departmentHead: d.departmentHead ? { id: d.departmentHead.id, name: d.departmentHead.name } : null,
  operatorCount: d._count ? d._count.users : undefined,
});

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'createdAt', 'name', 'code',
  ]);
  const where = search
    ? { OR: [{ name: { contains: search } }, { code: { contains: search } }] }
    : {};
  // Department Head / Supervisor / Team Leader only ever see their own department
  if (req.user.scopeToDepartment) where.id = req.user.departmentId;

  const [items, total] = await Promise.all([
    prisma.department.findMany({
      where, skip, take, orderBy: { [sortBy]: sortDir },
      include: { departmentHead: { select: { id: true, name: true } }, _count: { select: { users: { where: { role: { name: 'OPERATOR' } } } } } },
    }),
    prisma.department.count({ where }),
  ]);
  res.json(paginated(items.map(SHAPE), total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  if (req.user.scopeToDepartment && id !== req.user.departmentId) {
    throw new HttpError(403, 'You can only view your own department');
  }
  const d = await prisma.department.findUnique({
    where: { id },
    include: { departmentHead: { select: { id: true, name: true } }, _count: { select: { users: { where: { role: { name: 'OPERATOR' } } } } } },
  });
  if (!d) throw new HttpError(404, 'Department not found');
  res.json(SHAPE(d));
}

async function create(req, res) {
  const { name, code, description, departmentHeadUserId, isActive } = req.body;
  if (code) {
    const dupe = await prisma.department.findUnique({ where: { code } });
    if (dupe) throw new HttpError(400, `Department code "${code}" is already in use`);
  }
  const d = await prisma.department.create({ data: { name, code, description, departmentHeadUserId, isActive } });
  await audit(req, 'create', 'Department', d.id, { code: d.code, name: d.name });
  res.status(201).json(d);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const { name, code, description, departmentHeadUserId, isActive } = req.body;
  if (code) {
    const dupe = await prisma.department.findUnique({ where: { code } });
    if (dupe && dupe.id !== id) throw new HttpError(400, `Department code "${code}" is already in use`);
  }
  const d = await prisma.department.update({ where: { id }, data: { name, code, description, departmentHeadUserId, isActive } });
  await audit(req, 'update', 'Department', id, { code: d.code, name: d.name });
  res.json(d);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  const userCount = await prisma.user.count({ where: { departmentId: id } });
  if (userCount > 0) throw new HttpError(400, `Cannot remove: ${userCount} user(s) are assigned to this department`);
  await prisma.department.update({ where: { id }, data: { isActive: false } });
  await audit(req, 'deactivate', 'Department', id);
  res.json({ ok: true });
}

module.exports = { list, get, create, update, remove };
