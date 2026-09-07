'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { audit } = require('../utils/audit');

const SHAPE = (sc) => ({
  id: sc.id,
  departmentId: sc.departmentId,
  department: sc.department ? { id: sc.department.id, name: sc.department.name } : undefined,
  name: sc.name,
  code: sc.code,
  description: sc.description,
  isActive: sc.isActive,
  userCount: sc._count ? sc._count.users : undefined,
});

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'createdAt', 'name',
  ]);
  const where = {};
  if (req.query.departmentId) where.departmentId = parseInt(req.query.departmentId, 10);
  if (req.query.isActive !== undefined) where.isActive = req.query.isActive === 'true';
  if (search) where.name = { contains: search };

  const [items, total] = await Promise.all([
    prisma.departmentSubCategory.findMany({
      where, skip, take, orderBy: { [sortBy]: sortDir },
      include: { department: { select: { id: true, name: true } }, _count: { select: { users: true } } },
    }),
    prisma.departmentSubCategory.count({ where }),
  ]);
  res.json(paginated(items.map(SHAPE), total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const sc = await prisma.departmentSubCategory.findUnique({
    where: { id },
    include: { department: { select: { id: true, name: true } }, _count: { select: { users: true } } },
  });
  if (!sc) throw new HttpError(404, 'Sub category not found');
  res.json(SHAPE(sc));
}

async function assertNoActiveDuplicate(departmentId, name, excludeId) {
  const dupe = await prisma.departmentSubCategory.findFirst({
    where: {
      departmentId, isActive: true,
      name: { equals: name.trim() },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (dupe) throw new HttpError(400, `An active sub category named "${name.trim()}" already exists in this department`);
}

async function create(req, res) {
  const { departmentId, name, code, description, isActive } = req.body;
  const dept = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!dept) throw new HttpError(404, 'Department not found');
  await assertNoActiveDuplicate(departmentId, name);

  const sc = await prisma.departmentSubCategory.create({
    data: { departmentId, name: name.trim(), code: code || null, description: description || null, isActive, createdById: req.user.id },
    include: { department: { select: { id: true, name: true } } },
  });
  await audit(req, 'create', 'DepartmentSubCategory', sc.id, { departmentId, name: sc.name });
  res.status(201).json(SHAPE(sc));
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.departmentSubCategory.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Sub category not found');
  const { departmentId, name, code, description, isActive } = req.body;
  const effectiveDeptId = departmentId !== undefined ? departmentId : existing.departmentId;
  if (name !== undefined) await assertNoActiveDuplicate(effectiveDeptId, name, id);

  const sc = await prisma.departmentSubCategory.update({
    where: { id },
    data: {
      departmentId, name: name !== undefined ? name.trim() : undefined, code, description, isActive,
    },
    include: { department: { select: { id: true, name: true } } },
  });
  await audit(req, isActive !== undefined ? (isActive ? 'activate' : 'deactivate') : 'update', 'DepartmentSubCategory', id, req.body);
  res.json(SHAPE(sc));
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.departmentSubCategory.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
  if (!existing) throw new HttpError(404, 'Sub category not found');
  if (existing._count.users > 0) throw new HttpError(400, `Cannot delete: ${existing._count.users} user(s) are assigned to this sub category`);
  await prisma.departmentSubCategory.delete({ where: { id } });
  await audit(req, 'delete', 'DepartmentSubCategory', id, { name: existing.name });
  res.json({ ok: true });
}

module.exports = { list, get, create, update, remove };
