'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextCode } = require('../utils/numbering');
const { audit } = require('../utils/audit');

const INCLUDE = {
  department: { select: { id: true, name: true, code: true } },
  parentProcess: { select: { id: true, name: true } },
  dependsOnProcess: { select: { id: true, name: true } },
  _count: { select: { subProcesses: true } },
};

// A department-scoped user (Department Head / Supervisor / Team Leader) and
// any department-bound employee (Operator) see GLOBAL processes (department
// null) plus their own department's — never another department's custom ones.
function visibilityWhere(req) {
  if (req.user.role === 'SUPERADMIN') return {};
  if (req.user.departmentId && (req.user.scopeToDepartment || req.user.role === 'OPERATOR')) {
    return { OR: [{ departmentId: null }, { departmentId: req.user.departmentId }] };
  }
  return {};
}

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'createdAt', 'name', 'code', 'displayOrder',
  ]);
  const and = [visibilityWhere(req)];
  if (req.query.departmentId) and.push({ departmentId: parseInt(req.query.departmentId, 10) });
  if (req.query.stage) and.push({ stage: req.query.stage });
  if (req.query.topLevelOnly === '1') and.push({ parentProcessId: null });
  if (req.query.parentProcessId) and.push({ parentProcessId: parseInt(req.query.parentProcessId, 10) });
  if (req.query.type === 'GLOBAL') and.push({ departmentId: null });
  if (req.query.type === 'DEPARTMENT_SPECIFIC') and.push({ departmentId: { not: null } });
  if (req.query.isActive !== undefined) and.push({ isActive: req.query.isActive === 'true' });
  if (search) and.push({ OR: [{ name: { contains: search } }, { code: { contains: search } }] });
  const where = { AND: and };

  const [items, total] = await Promise.all([
    prisma.process.findMany({ where, skip, take, orderBy: [{ [sortBy]: sortDir }], include: INCLUDE }),
    prisma.process.count({ where }),
  ]);
  res.json(paginated(items.map((p) => ({ ...p, type: p.departmentId ? 'DEPARTMENT_SPECIFIC' : 'GLOBAL' })), total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const p = await prisma.process.findUnique({
    where: { id }, include: { ...INCLUDE, subProcesses: { orderBy: { displayOrder: 'asc' } } },
  });
  if (!p) throw new HttpError(404, 'Process not found');
  res.json({ ...p, type: p.departmentId ? 'DEPARTMENT_SPECIFIC' : 'GLOBAL' });
}

async function assertWritableDepartment(req, departmentId) {
  if (req.user.role === 'SUPERADMIN') return;
  if (!req.user.scopeToDepartment) return; // Admin/Manager: unrestricted
  if (!departmentId || departmentId !== req.user.departmentId) {
    throw new HttpError(403, 'You can only manage processes for your own department (not global ones)');
  }
}

async function create(req, res) {
  // a scoped creator (Department Head/Supervisor/Team Leader) doesn't have to
  // pass departmentId — it defaults to their own; they just can't override it
  if (req.user.scopeToDepartment && req.body.departmentId == null) {
    req.body.departmentId = req.user.departmentId;
  }
  await assertWritableDepartment(req, req.body.departmentId);
  if (req.body.parentProcessId) {
    const parent = await prisma.process.findUnique({ where: { id: req.body.parentProcessId }, select: { departmentId: true } });
    if (!parent) throw new HttpError(400, 'Parent process not found');
  }
  const code = req.body.code || await nextCode('process', 'process');
  const data = { ...req.body, code };
  data.createdById = req.user.id;
  const p = await prisma.process.create({ data, include: INCLUDE });
  await audit(req, 'create', 'Process', p.id, { code: p.code, name: p.name });
  res.status(201).json({ ...p, type: p.departmentId ? 'DEPARTMENT_SPECIFIC' : 'GLOBAL' });
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.process.findUnique({ where: { id }, select: { departmentId: true } });
  if (!existing) throw new HttpError(404, 'Process not found');
  await assertWritableDepartment(req, existing.departmentId);
  // a scoped user may edit their own department's process but may never move
  // it to another department or make it global
  if (req.body.departmentId !== undefined) await assertWritableDepartment(req, req.body.departmentId);
  if (req.body.parentProcessId === id) throw new HttpError(400, 'A process cannot be its own sub-process');

  const p = await prisma.process.update({ where: { id }, data: req.body, include: INCLUDE });
  await audit(req, 'update', 'Process', id, { code: p.code, name: p.name });
  res.json({ ...p, type: p.departmentId ? 'DEPARTMENT_SPECIFIC' : 'GLOBAL' });
}

// never a hard delete — historical tasks must keep showing the original
// process name, so this only flips isActive (same convention as item/machine)
async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.process.findUnique({ where: { id }, select: { departmentId: true } });
  if (!existing) throw new HttpError(404, 'Process not found');
  await assertWritableDepartment(req, existing.departmentId);
  await prisma.process.update({ where: { id }, data: { isActive: false } });
  await audit(req, 'deactivate', 'Process', id);
  res.json({ ok: true });
}

module.exports = { list, get, create, update, remove };
