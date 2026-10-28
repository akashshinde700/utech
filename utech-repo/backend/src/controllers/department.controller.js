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
      where, skip, take, orderBy: [{ [sortBy]: sortDir }, { id: sortDir }],
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

// Both `name` and `code` are unique in the schema. Checking only the code made
// a duplicate name fall through to a raw database error (500, "Something went
// wrong") instead of telling the user which field to change.
async function assertUniqueDepartment({ name, code }, excludeId = null) {
  const or = [];
  if (name) or.push({ name: String(name).trim() });
  if (code) or.push({ code: String(code).trim() });
  if (!or.length) return;
  const clash = await prisma.department.findFirst({
    where: { OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, name: true, code: true },
  });
  if (!clash) return;
  if (name && clash.name === String(name).trim()) {
    throw new HttpError(400, `Department name "${clash.name}" is already in use`);
  }
  throw new HttpError(400, `Department code "${clash.code}" is already in use`);
}

async function create(req, res) {
  const { name, code, description, departmentHeadUserId, isActive } = req.body;
  if (!String(name || '').trim()) throw new HttpError(400, 'Department name is required');
  await assertUniqueDepartment({ name, code });
  const d = await prisma.department.create({
    data: {
      name: String(name).trim(),
      code: code ? String(code).trim() : code,
      description, departmentHeadUserId, isActive,
    },
  });
  await audit(req, 'create', 'Department', d.id, { code: d.code, name: d.name });
  res.status(201).json(d);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const { name, code, description, departmentHeadUserId, isActive } = req.body;
  const existing = await prisma.department.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Department not found');
  if (name !== undefined && !String(name).trim()) throw new HttpError(400, 'Department name is required');
  await assertUniqueDepartment({ name, code }, id);
  const d = await prisma.department.update({
    where: { id },
    data: {
      name: name !== undefined ? String(name).trim() : undefined,
      code: code !== undefined ? String(code).trim() : undefined,
      description, departmentHeadUserId, isActive,
    },
  });
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
