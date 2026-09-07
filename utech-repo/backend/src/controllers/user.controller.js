'use strict';
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const env = require('../config/env');
const { parseListQuery, paginated } = require('../utils/pagination');
const HttpError = require('../utils/httpError');
const { audit } = require('../utils/audit');

const SAFE_USER = {
  id: true, email: true, name: true, phone: true, isActive: true,
  lastLoginAt: true, createdAt: true, updatedAt: true,
  role: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  departmentSubCategory: { select: { id: true, name: true } },
  reportingTo: { select: { id: true, name: true } },
};

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'createdAt', 'name', 'email',
  ]);
  const where = search
    ? { OR: [{ name: { contains: search } }, { email: { contains: search } }] }
    : {};
  if (req.query.roleId) where.roleId = parseInt(req.query.roleId, 10);
  if (req.query.departmentId) where.departmentId = parseInt(req.query.departmentId, 10);
  if (req.query.departmentSubCategoryId) where.departmentSubCategoryId = parseInt(req.query.departmentSubCategoryId, 10);
  if (req.query.isActive !== undefined) where.isActive = req.query.isActive === 'true';

  // department-scoped roles (Department Head / Supervisor / Team Leader) only
  // ever see users in their own department, regardless of other filters
  if (req.user.scopeToDepartment) where.departmentId = req.user.departmentId;

  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, skip, take, orderBy: { [sortBy]: sortDir }, select: SAFE_USER }),
    prisma.user.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

// candidates for the "Reporting To" dropdown: active users whose role outranks
// (lower hierarchyLevel than) the target role — data-driven, no hardcoded
// role-name-to-role-name map, so a newly added role just needs a level.
async function reportingCandidates(req, res) {
  const roleId = parseInt(req.query.roleId, 10);
  if (!roleId) return res.json([]);
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role || role.hierarchyLevel == null) return res.json([]);
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { hierarchyLevel: { lt: role.hierarchyLevel } } },
    select: { id: true, name: true, role: { select: { id: true, name: true, hierarchyLevel: true } } },
    orderBy: { role: { hierarchyLevel: 'desc' } },
  });
  res.json(users);
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const user = await prisma.user.findUnique({ where: { id }, select: SAFE_USER });
  if (!user) throw new HttpError(404, 'User not found');
  if (req.user.scopeToDepartment && user.department?.id !== req.user.departmentId) {
    throw new HttpError(403, 'This user is not in your department');
  }
  res.json(user);
}

// Department Head / Supervisor / Team Leader roles require a departmentId —
// enforced here (not in zod) since it depends on a DB lookup of the target Role.
async function assertDepartmentRequirement(roleId, departmentId) {
  if (!roleId) return;
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (role && role.requiresDepartment && !departmentId) {
    throw new HttpError(400, 'Department is required for this role');
  }
}

// a sub category must belong to the department actually selected on the user —
// prevents e.g. picking "CNC Operator" (under CNC/VMC) while Department is set
// to Fabrication.
async function assertSubCategoryBelongsToDepartment(departmentId, departmentSubCategoryId) {
  if (!departmentSubCategoryId) return;
  const sc = await prisma.departmentSubCategory.findUnique({ where: { id: departmentSubCategoryId } });
  if (!sc) throw new HttpError(400, 'Sub category not found');
  if (sc.departmentId !== departmentId) {
    throw new HttpError(400, 'Selected subcategory does not belong to the selected department.');
  }
}

// --- privilege guards -------------------------------------------------------
// Only SUPERADMIN / top-level callers (hierarchyLevel <= 1) may hand out
// roles, reset passwords or toggle active state — without this, a Department
// Head with user.update could promote anyone to SUPERADMIN or take over the
// Super Admin account.
function isPrivilegedCaller(req) {
  return req.user.role === 'SUPERADMIN' ||
    (req.user.hierarchyLevel != null && req.user.hierarchyLevel <= 1);
}

const PRIVILEGED_FIELDS = ['roleId', 'password', 'isActive'];

function assertNoPrivilegedFields(req, data) {
  if (isPrivilegedCaller(req)) return;
  const attempted = PRIVILEGED_FIELDS.filter((f) => data[f] !== undefined);
  if (attempted.length) {
    throw new HttpError(403, `Only administrators can change: ${attempted.join(', ')}`);
  }
}

// a caller can never assign a role that outranks or equals their own (a
// Department Head must not mint another Department Head), unless SUPERADMIN
async function assertRoleHierarchy(req, roleId) {
  if (!roleId) return;
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw new HttpError(400, 'Role not found');
  if (req.user.role === 'SUPERADMIN') return;
  const callerLevel = req.user.hierarchyLevel;
  if (callerLevel != null && role.hierarchyLevel != null && role.hierarchyLevel <= callerLevel) {
    throw new HttpError(403, `You cannot assign the "${role.name}" role`);
  }
}

// "Reporting To" must follow the hierarchy: the chosen user's role has to
// outrank the target user's role (same rule the reporting-candidates
// dropdown applies), otherwise the chain can be pointed at a subordinate.
async function assertReportingToHierarchy(targetRoleId, reportingToId) {
  if (reportingToId == null) return;
  const boss = await prisma.user.findUnique({
    where: { id: reportingToId },
    select: { id: true, role: { select: { hierarchyLevel: true } } },
  });
  if (!boss) throw new HttpError(400, 'Reporting-to user not found');
  const targetRole = targetRoleId
    ? await prisma.role.findUnique({ where: { id: targetRoleId }, select: { hierarchyLevel: true } })
    : null;
  if (boss.role && targetRole && boss.role.hierarchyLevel != null && targetRole.hierarchyLevel != null) {
    if (boss.role.hierarchyLevel >= targetRole.hierarchyLevel) {
      throw new HttpError(400, 'Reporting-to user must have a role senior to the target user\'s role');
    }
  }
}

// department-scoped callers (Department Head / Supervisor / Team Leader) may
// only touch users inside their own department
function assertSameDepartment(req, targetDepartmentId) {
  if (req.user.hierarchyLevel != null && req.user.hierarchyLevel <= 1) return;
  if (req.user.departmentId != null && targetDepartmentId !== req.user.departmentId) {
    throw new HttpError(403, 'This user is not in your department');
  }
}

async function create(req, res) {
  const { password, ...data } = req.body;
  assertNoPrivilegedFields(req, { ...data, password }); // password is required to create an account, but only admins hold user.create anyway
  if (data.departmentId !== undefined) {
    assertSameDepartment(req, data.departmentId);
  } else if (req.user.departmentId != null && !(req.user.hierarchyLevel != null && req.user.hierarchyLevel <= 1)) {
    // department-scoped callers create users in their own department
    data.departmentId = req.user.departmentId;
  }
  await assertRoleHierarchy(req, data.roleId);
  await assertDepartmentRequirement(data.roleId, data.departmentId);
  await assertSubCategoryBelongsToDepartment(data.departmentId, data.departmentSubCategoryId);
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { ...data, passwordHash },
    select: SAFE_USER,
  });
  await audit(req, 'create', 'User', user.id, {
    roleId: user.role ? user.role.id : data.roleId || null,
    departmentId: data.departmentId || null,
    departmentSubCategoryId: data.departmentSubCategoryId || null,
  });
  res.status(201).json(user);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const body = { ...req.body };
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'User not found');

  assertNoPrivilegedFields(req, body);
  assertSameDepartment(req, existing.departmentId);

  if (body.roleId !== undefined) {
    await assertRoleHierarchy(req, body.roleId);
  }
  if (body.reportingToId !== undefined) {
    const targetRoleId = body.roleId !== undefined ? body.roleId : existing.roleId;
    await assertReportingToHierarchy(targetRoleId, body.reportingToId);
  }

  const data = { ...body };
  if (data.roleId !== undefined || data.departmentId !== undefined || data.departmentSubCategoryId !== undefined) {
    const roleId = data.roleId !== undefined ? data.roleId : existing.roleId;
    const departmentId = data.departmentId !== undefined ? data.departmentId : existing.departmentId;
    const departmentSubCategoryId = data.departmentSubCategoryId !== undefined ? data.departmentSubCategoryId : existing.departmentSubCategoryId;
    await assertDepartmentRequirement(roleId, departmentId);
    await assertSubCategoryBelongsToDepartment(departmentId, departmentSubCategoryId);
  }
  if (data.password) {
    data.passwordHash = await bcrypt.hash(data.password, env.BCRYPT_ROUNDS);
    delete data.password;
  }
  const user = await prisma.user.update({ where: { id }, data, select: SAFE_USER });
  await audit(req, 'update', 'User', id, {
    // role changes are audited with the affected role id — role/permission
    // changes must never be silent
    ...(data.roleId !== undefined ? { previousRoleId: existing.roleId, newRoleId: data.roleId } : {}),
    ...(data.isActive !== undefined ? { previousIsActive: existing.isActive, newIsActive: data.isActive } : {}),
    ...(data.departmentId !== undefined ? { previousDepartmentId: existing.departmentId, newDepartmentId: data.departmentId } : {}),
    ...(data.departmentSubCategoryId !== undefined ? { previousSubCategoryId: existing.departmentSubCategoryId, newSubCategoryId: data.departmentSubCategoryId } : {}),
  });
  res.json(user);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new HttpError(404, 'User not found');

  // first delete = deactivate; deleting an already-inactive user removes it for good
  if (user.isActive) {
    await prisma.user.update({ where: { id }, data: { isActive: false } });
    await audit(req, 'deactivate', 'User', id, { email: user.email });
    return res.json({ ok: true, deleted: false });
  }

  const asgCount = await prisma.assignment.count({
    where: { OR: [{ assignedById: id }, { assignedToId: id }, { completedById: id }] },
  });
  if (asgCount > 0) {
    throw new HttpError(400, 'Cannot permanently delete this user — they have assignment history. Reassign or cancel those assignments first.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.updateMany({ where: { reportingToId: id }, data: { reportingToId: null } });
    await tx.department.updateMany({ where: { departmentHeadUserId: id }, data: { departmentHeadUserId: null } });
    await tx.customerMaterialLot.updateMany({ where: { createdById: id }, data: { createdById: null } });
    await tx.invoice.updateMany({ where: { createdById: id }, data: { createdById: null } });
    await tx.jobcard.updateMany({ where: { createdById: id }, data: { createdById: null } });
    await tx.jobcard.updateMany({ where: { assignedOperatorId: id }, data: { assignedOperatorId: null } });
    await tx.jobcard.updateMany({ where: { projectEngineerId: id }, data: { projectEngineerId: null } });
    await tx.jobcardNote.updateMany({ where: { authorId: id }, data: { authorId: null } });
    await tx.jobcardRevert.updateMany({ where: { revertedById: id }, data: { revertedById: null } });
    await tx.expense.updateMany({ where: { createdById: id }, data: { createdById: null } });
    await tx.attachment.updateMany({ where: { uploadedById: id }, data: { uploadedById: null } });
    await tx.auditLog.updateMany({ where: { userId: id }, data: { userId: null } });
    await tx.otp.updateMany({ where: { userId: id }, data: { userId: null } });
    // Notification.userId cascades on delete at the DB level
    await tx.user.delete({ where: { id } });
  });
  await audit(req, 'delete', 'User', id, { email: user.email });
  res.json({ ok: true, deleted: true });
}

module.exports = { list, get, create, update, remove, reportingCandidates };
