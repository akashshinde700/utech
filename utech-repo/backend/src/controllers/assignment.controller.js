'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { audit } = require('../utils/audit');
const { notifyUsers } = require('../utils/notify');

const INCLUDE = {
  attachment: { select: { id: true, filename: true, category: true, refType: true, refId: true } },
  department: { select: { id: true, name: true } },
  departmentSubCategory: { select: { id: true, name: true } },
  assignedBy: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
  completedBy: { select: { id: true, name: true } },
  // work on this assignment that was handed to an external vendor — this is
  // what turns the old free-text "sent to X" note into real, queryable data
  vendorWorkOrders: {
    select: {
      id: true, number: true, status: true,
      sentDate: true, expectedReturnDate: true, actualReturnDate: true,
      party: { select: { id: true, name: true } },
      po: { select: { id: true, number: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
  },
};

// Admin/Plant Head/Superadmin tier — the "Sub Admin + Plant Head" oversight
// audience from the brief maps onto the same hierarchyLevel<=2 tier already
// used for Department/User oversight visibility elsewhere in the app. The
// Project Engineer also gets full cross-department visibility here — they
// initiate every assignment chain, so they see it all the way through.
function isElevated(user) {
  return (user.hierarchyLevel != null && user.hierarchyLevel <= 2) || user.role === 'Project Engineer';
}

function assertParticipant(a, user) {
  if (isElevated(user)) return;
  if (a.assignedById !== user.id && a.assignedToId !== user.id) {
    throw new HttpError(403, 'This assignment is not visible to you');
  }
}

async function notifyUser(userId, payload) {
  await prisma.notification.create({ data: { userId, ...payload } });
}

async function list(req, res) {
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.attachmentId) where.attachmentId = parseInt(req.query.attachmentId, 10);
  if (req.query.departmentId) where.departmentId = parseInt(req.query.departmentId, 10);
  if (req.query.departmentSubCategoryId) where.departmentSubCategoryId = parseInt(req.query.departmentSubCategoryId, 10);

  let elevated = isElevated(req.user);

  // whoever owns this jobcard (the "Assigned Engineer" — usually the Project
  // Engineer) sees every assignment on their own project's documents, even
  // ones a Department Head sub-delegated further without them being a direct
  // participant — otherwise they'd never see how far the chain actually got
  if (!elevated && where.attachmentId) {
    const attachment = await prisma.attachment.findUnique({ where: { id: where.attachmentId }, select: { refType: true, refId: true } });
    if (attachment && attachment.refType === 'JOBCARD') {
      const jc = await prisma.jobcard.findUnique({ where: { id: attachment.refId }, select: { assignedOperatorId: true } });
      if (jc && jc.assignedOperatorId === req.user.id) elevated = true;
    }
  }
  let assignedToId = req.query.assignedToId === 'me' ? req.user.id : req.query.assignedToId ? parseInt(req.query.assignedToId, 10) : undefined;
  let assignedById = req.query.assignedById === 'me' ? req.user.id : req.query.assignedById ? parseInt(req.query.assignedById, 10) : undefined;
  if (!elevated) {
    if (assignedToId && assignedToId !== req.user.id) assignedToId = req.user.id;
    if (assignedById && assignedById !== req.user.id) assignedById = req.user.id;
  }
  if (assignedToId) where.assignedToId = assignedToId;
  if (assignedById) where.assignedById = assignedById;
  if (!assignedToId && !assignedById && !elevated) {
    where.OR = [{ assignedToId: req.user.id }, { assignedById: req.user.id }];
  }

  const items = await prisma.assignment.findMany({ where, include: INCLUDE, orderBy: { createdAt: 'desc' } });
  res.json(items);
}

// candidates for the "Assigned User" dropdown: active users belonging to the
// selected department (sub category, if also picked, narrows it further —
// it is not required), excluding the caller themselves.
// - A Project Engineer only ever hands work to the Department Head of that
//   department — the Head is the one who then delegates further down.
// - A Department Head (or any other scopeToDepartment management role) only
//   ever hands work to their own department's operators/employees, never to
//   another management-tier peer.
async function eligibleUsers(req, res) {
  const departmentId = req.query.departmentId ? parseInt(req.query.departmentId, 10) : null;
  const departmentSubCategoryId = req.query.departmentSubCategoryId ? parseInt(req.query.departmentSubCategoryId, 10) : null;
  if (!departmentId) return res.json([]);
  const users = await prisma.user.findMany({
    where: {
      isActive: true, departmentId,
      id: { not: req.user.id },
      ...(departmentSubCategoryId ? { departmentSubCategoryId } : {}),
      ...(req.user.role === 'Project Engineer' ? { role: { name: 'Department Head' } } : {}),
      ...(req.user.scopeToDepartment ? { role: { scopeToDepartment: false } } : {}),
    },
    select: { id: true, name: true, role: { select: { id: true, name: true } } },
    orderBy: { name: 'asc' },
  });
  res.json(users);
}

// dashboard counts — Project Engineer sees only what they assigned; the
// oversight tier (Sub Admin / Plant Head / Superadmin) sees everything,
// optionally broken down by department/sub category/user.
async function stats(req, res) {
  const where = {};
  if (!isElevated(req.user)) where.assignedById = req.user.id;
  if (req.query.departmentId) where.departmentId = parseInt(req.query.departmentId, 10);
  if (req.query.attachmentId) where.attachmentId = parseInt(req.query.attachmentId, 10);

  const rows = await prisma.assignment.findMany({
    where,
    select: {
      status: true, dueDate: true,
      departmentId: true, department: { select: { name: true } },
      departmentSubCategoryId: true, departmentSubCategory: { select: { name: true } },
      assignedToId: true, assignedTo: { select: { name: true } },
    },
  });

  const now = new Date();
  const counts = { total: rows.length, assigned: 0, inProgress: 0, completed: 0, reopened: 0, cancelled: 0, overdue: 0 };
  for (const r of rows) {
    if (r.status === 'ASSIGNED') counts.assigned++;
    else if (r.status === 'IN_PROGRESS') counts.inProgress++;
    else if (r.status === 'COMPLETED') counts.completed++;
    else if (r.status === 'REOPENED') counts.reopened++;
    else if (r.status === 'CANCELLED') counts.cancelled++;
    if (r.dueDate && new Date(r.dueDate) < now && !['COMPLETED', 'CANCELLED'].includes(r.status)) counts.overdue++;
  }
  counts.completionPercentage = counts.total ? Math.round((counts.completed / counts.total) * 100) : 0;

  let breakdown = null;
  const groupBy = req.query.groupBy;
  if (['department', 'subCategory', 'user'].includes(groupBy)) {
    const map = new Map();
    for (const r of rows) {
      let key, label;
      if (groupBy === 'department') { key = r.departmentId; label = r.department?.name || 'Unassigned'; }
      else if (groupBy === 'subCategory') { key = r.departmentSubCategoryId; label = r.departmentSubCategory?.name || 'Unassigned'; }
      else { key = r.assignedToId; label = r.assignedTo?.name || 'Unassigned'; }
      if (!map.has(key)) map.set(key, { label, total: 0, completed: 0 });
      const g = map.get(key);
      g.total += 1;
      if (r.status === 'COMPLETED') g.completed += 1;
    }
    breakdown = [...map.values()];
  }

  res.json({ ...counts, breakdown });
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const a = await prisma.assignment.findUnique({ where: { id }, include: INCLUDE });
  if (!a) throw new HttpError(404, 'Assignment not found');
  assertParticipant(a, req.user);
  res.json(a);
}

async function create(req, res) {
  const { attachmentId, assignedToId, pageNumbers, departmentId, departmentSubCategoryId, instructions, priority, dueDate } = req.body;
  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment) throw new HttpError(404, 'Attachment not found');

  if (departmentSubCategoryId) {
    const sc = await prisma.departmentSubCategory.findUnique({ where: { id: departmentSubCategoryId } });
    if (!sc) throw new HttpError(400, 'Sub category not found');
    if (departmentId && sc.departmentId !== departmentId) {
      throw new HttpError(400, 'Selected subcategory does not belong to the selected department.');
    }
  }

  const assignee = await prisma.user.findUnique({ where: { id: assignedToId } });
  if (!assignee || !assignee.isActive) throw new HttpError(400, 'Assignee not found or inactive');
  if (departmentId && assignee.departmentId !== departmentId) {
    throw new HttpError(400, 'Assigned user does not belong to the selected department.');
  }
  if (departmentSubCategoryId && assignee.departmentSubCategoryId !== departmentSubCategoryId) {
    throw new HttpError(400, 'Assigned user does not belong to the selected sub category.');
  }

  const cleanPages = pageNumbers && pageNumbers.length ? [...new Set(pageNumbers)].sort((x, y) => x - y) : null;

  // guard against accidental double-submits (e.g. a double click) creating
  // the exact same assignment twice
  const existing = await prisma.assignment.findMany({
    where: { attachmentId, assignedToId, status: { not: 'CANCELLED' } },
    select: { pageNumbers: true },
  });
  const dup = existing.some((e) => {
    const ep = e.pageNumbers || null;
    if (!ep && !cleanPages) return true;
    if (!ep || !cleanPages || ep.length !== cleanPages.length) return false;
    return ep.every((p, i) => p === cleanPages[i]);
  });
  if (dup) throw new HttpError(409, 'This exact page range is already assigned to this user.');

  const a = await prisma.assignment.create({
    data: {
      attachmentId, assignedToId, pageNumbers: cleanPages,
      departmentId: departmentId || null,
      departmentSubCategoryId: departmentSubCategoryId || null,
      instructions: instructions || null,
      priority: priority || 'MEDIUM',
      dueDate: dueDate || null,
      assignedById: req.user.id,
      status: 'ASSIGNED',
    },
    include: INCLUDE,
  });
  await audit(req, 'create', 'Assignment', a.id, { attachmentId, assignedToId, departmentId, departmentSubCategoryId, pageNumbers: cleanPages });
  await notifyUser(assignedToId, {
    type: 'ASSIGNMENT_ASSIGNED', title: `New work assigned: ${attachment.filename}`,
    body: `${req.user.name} assigned you "${attachment.filename}"${cleanPages ? ` (page ${cleanPages.join(', ')})` : ''}.`,
    refType: 'ASSIGNMENT', refId: a.id,
  });
  res.status(201).json(a);
}

function transition(action, fromStatuses, toStatus, timestampField) {
  return async function (req, res) {
    const id = parseInt(req.params.id, 10);
    const a = await prisma.assignment.findUnique({ where: { id }, include: INCLUDE });
    if (!a) throw new HttpError(404, 'Assignment not found');
    if (a.assignedToId !== req.user.id) throw new HttpError(403, 'This assignment is not assigned to you');
    if (!fromStatuses.includes(a.status)) {
      throw new HttpError(400, `Cannot ${action} an assignment in ${a.status} status`);
    }
    const data = { status: toStatus };
    if (timestampField) data[timestampField] = new Date();
    if (action === 'start') {
      data.startNotes = req.body.startNotes || null;
    }
    if (action === 'complete') {
      data.completedById = req.user.id;
      data.completionRemarks = req.body.completionRemarks || null;
    }
    const updated = await prisma.assignment.update({ where: { id }, data, include: INCLUDE });
    await audit(req, action, 'Assignment', id, { status: toStatus, startNotes: data.startNotes, completionRemarks: data.completionRemarks });

    if (action === 'start') {
      await notifyUser(a.assignedById, {
        type: 'ASSIGNMENT_STARTED', title: `Work started: ${a.attachment.filename}`,
        body: `${req.user.name} started work on "${a.attachment.filename}".`,
        refType: 'ASSIGNMENT', refId: id,
      });
    }
    if (action === 'complete') {
      await notifyUser(a.assignedById, {
        type: 'ASSIGNMENT_COMPLETED', title: `Work completed: ${a.attachment.filename}`,
        body: `${req.user.name} completed "${a.attachment.filename}".`,
        refType: 'ASSIGNMENT', refId: id,
      });
      // this assignment may itself be a hand-down of an earlier one (e.g. a
      // Department Head re-delegating what a Project Engineer gave them) —
      // walk one level up so whoever started that chain also hears about it
      const parent = await prisma.assignment.findFirst({
        where: { attachmentId: a.attachmentId, assignedToId: a.assignedById },
        orderBy: { createdAt: 'desc' },
      });
      if (parent && parent.assignedById !== a.assignedById && parent.assignedById !== req.user.id) {
        await notifyUser(parent.assignedById, {
          type: 'ASSIGNMENT_COMPLETED', title: `Work completed: ${a.attachment.filename}`,
          body: `${req.user.name} completed "${a.attachment.filename}" (delegated via ${a.assignedBy.name}).`,
          refType: 'ASSIGNMENT', refId: id,
        });
      }
      await notifyUsers(['Admin', 'Plant Head'], {
        type: 'ASSIGNMENT_COMPLETED', title: `Work completed: ${a.attachment.filename}`,
        body: `${req.user.name} completed "${a.attachment.filename}" assigned by ${a.assignedBy.name}.`,
        refType: 'ASSIGNMENT', refId: id,
      });
    }
    res.json(updated);
  };
}

const start = transition('start', ['ASSIGNED', 'REOPENED'], 'IN_PROGRESS', 'startedAt');
const complete = transition('complete', ['IN_PROGRESS'], 'COMPLETED', 'completedAt');

async function reopen(req, res) {
  const id = parseInt(req.params.id, 10);
  const a = await prisma.assignment.findUnique({ where: { id }, include: INCLUDE });
  if (!a) throw new HttpError(404, 'Assignment not found');
  if (a.assignedById !== req.user.id) throw new HttpError(403, 'Only the person who assigned this can reopen it');
  if (a.status !== 'COMPLETED') throw new HttpError(400, `Cannot reopen an assignment in ${a.status} status`);

  const updated = await prisma.assignment.update({
    where: { id },
    data: { status: 'REOPENED', completedAt: null, completedById: null },
    include: INCLUDE,
  });
  await audit(req, 'reopen', 'Assignment', id, { reason: req.body.reason || null });
  await notifyUser(a.assignedToId, {
    type: 'ASSIGNMENT_REOPENED', title: `Work reopened: ${a.attachment.filename}`,
    body: `${req.user.name} reopened "${a.attachment.filename}"${req.body.reason ? `: ${req.body.reason}` : ''}.`,
    refType: 'ASSIGNMENT', refId: id,
  });
  res.json(updated);
}

async function cancel(req, res) {
  const id = parseInt(req.params.id, 10);
  const a = await prisma.assignment.findUnique({ where: { id } });
  if (!a) throw new HttpError(404, 'Assignment not found');
  if (a.assignedById !== req.user.id) throw new HttpError(403, 'Only the person who assigned this can cancel it');
  if (a.status !== 'ASSIGNED') throw new HttpError(400, `Cannot cancel an assignment in ${a.status} status`);
  const updated = await prisma.assignment.update({ where: { id }, data: { status: 'CANCELLED' } });
  await audit(req, 'cancel', 'Assignment', id);
  res.json(updated);
}

async function activity(req, res) {
  const id = parseInt(req.params.id, 10);
  const a = await prisma.assignment.findUnique({ where: { id } });
  if (!a) throw new HttpError(404, 'Assignment not found');
  assertParticipant(a, req.user);
  const rows = await prisma.auditLog.findMany({
    where: { entity: 'Assignment', entityId: id },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true } } },
  });
  res.json(rows);
}

module.exports = { list, eligibleUsers, stats, get, create, start, complete, reopen, cancel, activity };
