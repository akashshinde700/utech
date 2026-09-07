'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { audit } = require('../utils/audit');

const SHAPE = (r) => ({
  id: r.id,
  name: r.name,
  code: r.code,
  description: r.description,
  isSystem: r.isSystem,
  isActive: r.isActive,
  hierarchyLevel: r.hierarchyLevel,
  parentRoleId: r.parentRoleId,
  parentRole: r.parentRole ? { id: r.parentRole.id, name: r.parentRole.name } : null,
  requiresDepartment: r.requiresDepartment,
  scopeToDepartment: r.scopeToDepartment,
});

async function list(_req, res) {
  const roles = await prisma.role.findMany({
    include: {
      permissions: { include: { permission: true } },
      parentRole: { select: { id: true, name: true } },
      _count: { select: { users: true } },
    },
    orderBy: { id: 'asc' },
  });
  res.json(
    roles.map((r) => ({
      ...SHAPE(r),
      userCount: r._count.users,
      permissions: r.permissions.map((rp) => rp.permission.key),
    }))
  );
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const role = await prisma.role.findUnique({
    where: { id },
    include: { permissions: { include: { permission: true } }, parentRole: { select: { id: true, name: true } } },
  });
  if (!role) throw new HttpError(404, 'Role not found');
  res.json({
    ...SHAPE(role),
    permissions: role.permissions.map((rp) => rp.permission.key),
  });
}

async function create(req, res) {
  const { name, code, description, hierarchyLevel, parentRoleId, requiresDepartment, scopeToDepartment, isActive, permissions = [] } = req.body;
  if (code) {
    const dupe = await prisma.role.findUnique({ where: { code } });
    if (dupe) throw new HttpError(400, `Role code "${code}" is already in use`);
  }
  const role = await prisma.$transaction(async (tx) => {
    const r = await tx.role.create({
      data: { name, code, description, hierarchyLevel, parentRoleId, requiresDepartment, scopeToDepartment, isActive },
    });
    if (permissions.length) {
      const perms = await tx.permission.findMany({ where: { key: { in: permissions } } });
      await tx.rolePermission.createMany({
        data: perms.map((p) => ({ roleId: r.id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }
    return r;
  });
  await audit(req, 'create', 'Role', role.id, {
    // role/permission changes must never be silent — audit carries the
    // affected role id and the granted permission keys
    name: role.name, permissions,
  });
  res.status(201).json(role);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const { name, code, description, hierarchyLevel, parentRoleId, requiresDepartment, scopeToDepartment, isActive, permissions } = req.body;
  if (code) {
    const dupe = await prisma.role.findUnique({ where: { code } });
    if (dupe && dupe.id !== id) throw new HttpError(400, `Role code "${code}" is already in use`);
  }
  await prisma.$transaction(async (tx) => {
    const existing = await tx.role.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Role not found');
    if (existing.isSystem && name && name !== existing.name) {
      throw new HttpError(400, 'Cannot rename a system role');
    }
    await tx.role.update({
      where: { id },
      data: { name, code, description, hierarchyLevel, parentRoleId, requiresDepartment, scopeToDepartment, isActive },
    });
    if (Array.isArray(permissions)) {
      const perms = await tx.permission.findMany({ where: { key: { in: permissions } } });
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({
        data: perms.map((p) => ({ roleId: id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }
  });
  await audit(req, 'update', 'Role', id, {
    name,
    ...(Array.isArray(permissions) ? { permissions } : {}),
  });
  res.json({ ok: true });
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
  if (!existing) throw new HttpError(404, 'Role not found');
  if (existing.isSystem) throw new HttpError(400, 'Cannot delete a system role');
  if (existing._count.users > 0) throw new HttpError(400, `Cannot delete: ${existing._count.users} user(s) are assigned to this role`);
  await prisma.role.delete({ where: { id } });
  await audit(req, 'delete', 'Role', id, { name: existing.name });
  res.json({ ok: true });
}

async function listPermissions(_req, res) {
  const perms = await prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }] });
  // group by module
  const grouped = {};
  for (const p of perms) {
    grouped[p.module] = grouped[p.module] || [];
    grouped[p.module].push({ id: p.id, key: p.key, action: p.action });
  }
  res.json(grouped);
}

module.exports = { list, get, create, update, remove, listPermissions };
