'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { audit } = require('../utils/audit');

// Task Progress / Task Assignment module — the "task" here is a JobcardOperation
// row (see schema.prisma). Reuses Jobcard (=project/work-order context),
// Process (=stage/sub-process master), Department, User, Attachment, AuditLog
// and JobcardNote instead of a parallel task schema.

const TASK_INCLUDE = {
  jobcard: { select: { id: true, number: true, projectId: true, project: { select: { id: true, code: true, name: true } }, party: { select: { id: true, name: true } } } },
  process: { select: { id: true, code: true, name: true, stage: true } },
  machine: { select: { id: true, code: true, name: true } },
  department: { select: { id: true, name: true, code: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  assignedBy: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  parentOperation: { select: { id: true, title: true, status: true } },
  dependsOnOperation: { select: { id: true, title: true, status: true, process: { select: { name: true } } } },
  reworkTasks: { select: { id: true, title: true, status: true } },
};

const OPEN_STATUSES = ['NOT_STARTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'];
const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED', 'REJECTED'];

function withComputed(t) {
  const overdue = OPEN_STATUSES.includes(t.status) && t.dueDate && new Date(t.dueDate) < new Date();
  const displayTitle = t.title || t.process?.name || `Task #${t.id}`;
  return { ...t, overdue: !!overdue, displayTitle };
}

// A scoped user (Department Head / Supervisor / Team Leader) only ever
// operates within their own department. An Operator only ever operates on
// tasks assigned to them. Everyone else (task.update/task.create holders
// without scopeToDepartment — Admin, Manager, SUPERADMIN) is unrestricted.
function scopeWhere(req) {
  if (req.user.role === 'SUPERADMIN') return {};
  if (req.user.scopeToDepartment) return { departmentId: req.user.departmentId };
  if (req.user.role === 'OPERATOR') return { assignedToId: req.user.id };
  return {};
}

async function assertTaskAccess(req, task) {
  if (req.user.role === 'SUPERADMIN') return;
  if (req.user.scopeToDepartment) {
    if (task.departmentId !== req.user.departmentId) throw new HttpError(403, 'This task is outside your department');
    return;
  }
  if (req.user.role === 'OPERATOR') {
    if (task.assignedToId !== req.user.id) throw new HttpError(403, 'This task is not assigned to you');
    return;
  }
  // unscoped roles with task.update/task.read (Admin, Manager, Project Engineer) fall through
}

async function loadTask(id) {
  const t = await prisma.jobcardOperation.findUnique({ where: { id }, include: TASK_INCLUDE });
  if (!t) throw new HttpError(404, 'Task not found');
  return t;
}

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'createdAt', 'dueDate', 'plannedStartAt', 'priority', 'progressPercent',
  ]);
  const where = { AND: [scopeWhere(req)] };
  const q = req.query;
  if (q.jobcardId) where.AND.push({ jobcardId: parseInt(q.jobcardId, 10) });
  if (q.projectId) where.AND.push({ jobcard: { projectId: parseInt(q.projectId, 10) } });
  if (q.departmentId) where.AND.push({ departmentId: parseInt(q.departmentId, 10) });
  if (q.processId) where.AND.push({ processId: parseInt(q.processId, 10) });
  if (q.stage) where.AND.push({ process: { stage: q.stage } });
  if (q.assignedToId) where.AND.push({ assignedToId: parseInt(q.assignedToId, 10) });
  if (q.priority) where.AND.push({ priority: q.priority });
  if (q.status) {
    const statuses = q.status.split(',').map((s) => s.trim());
    where.AND.push({ status: statuses.length === 1 ? statuses[0] : { in: statuses } });
  }
  if (q.overdue === '1') {
    where.AND.push({ status: { in: OPEN_STATUSES }, dueDate: { lt: new Date() } });
  }
  if (q.unassigned === '1') where.AND.push({ assignedToId: null });
  if (search) {
    where.AND.push({
      OR: [
        { title: { contains: search } },
        { notes: { contains: search } },
        { process: { name: { contains: search } } },
        { jobcard: { number: { contains: search } } },
      ],
    });
  }
  const [items, total] = await Promise.all([
    prisma.jobcardOperation.findMany({
      where, skip, take, orderBy: { [sortBy]: sortDir }, include: TASK_INCLUDE,
    }),
    prisma.jobcardOperation.count({ where }),
  ]);
  res.json(paginated(items.map(withComputed), total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const t = await loadTask(id);
  await assertTaskAccess(req, t);
  res.json(withComputed(t));
}

// Summary cards + per-stage breakdown for the Department Head Task Progress
// dashboard. Scoped exactly like list().
async function dashboard(req, res) {
  const where = { AND: [scopeWhere(req)] };
  if (req.query.departmentId) where.AND.push({ departmentId: parseInt(req.query.departmentId, 10) });

  const rows = await prisma.jobcardOperation.findMany({
    where,
    select: { status: true, dueDate: true, process: { select: { stage: true, name: true } } },
  });
  const now = new Date();
  const summary = {
    total: rows.length, notStarted: 0, assigned: 0, inProgress: 0, onHold: 0,
    completed: 0, cancelled: 0, overdue: 0,
  };
  const byStage = {};
  for (const r of rows) {
    const stage = r.process?.stage || 'Unassigned Stage';
    byStage[stage] ||= { stage, total: 0, completed: 0, inProgress: 0, pending: 0, overdue: 0 };
    byStage[stage].total += 1;
    if (r.status === 'NOT_STARTED') summary.notStarted += 1;
    else if (r.status === 'ASSIGNED') summary.assigned += 1;
    else if (['ACCEPTED', 'IN_PROGRESS', 'REOPENED'].includes(r.status)) { summary.inProgress += 1; byStage[stage].inProgress += 1; }
    else if (r.status === 'ON_HOLD') summary.onHold += 1;
    else if (r.status === 'COMPLETED') { summary.completed += 1; byStage[stage].completed += 1; }
    else if (['CANCELLED', 'REJECTED'].includes(r.status)) summary.cancelled += 1;
    if (['NOT_STARTED', 'ASSIGNED'].includes(r.status)) byStage[stage].pending += 1;
    if (OPEN_STATUSES.includes(r.status) && r.dueDate && new Date(r.dueDate) < now) {
      summary.overdue += 1;
      byStage[stage].overdue += 1;
    }
  }
  res.json({ summary, byStage: Object.values(byStage) });
}

// Per-employee workload — shown before assigning so a Department Head doesn't
// overload one person.
async function workload(req, res) {
  const departmentId = req.query.departmentId
    ? parseInt(req.query.departmentId, 10)
    : req.user.scopeToDepartment ? req.user.departmentId : null;
  const userWhere = { isActive: true };
  if (departmentId) userWhere.departmentId = departmentId;

  const users = await prisma.user.findMany({
    where: userWhere,
    select: { id: true, name: true, email: true, departmentId: true },
    orderBy: { name: 'asc' },
  });
  const tasks = await prisma.jobcardOperation.findMany({
    where: { assignedToId: { in: users.map((u) => u.id) } },
    select: { assignedToId: true, status: true, dueDate: true },
  });
  const now = new Date();
  const byUser = Object.fromEntries(users.map((u) => [u.id, {
    ...u, activeTasks: 0, pendingTasks: 0, overdueTasks: 0,
  }]));
  for (const t of tasks) {
    const row = byUser[t.assignedToId];
    if (!row) continue;
    if (['ACCEPTED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'].includes(t.status)) row.activeTasks += 1;
    if (['NOT_STARTED', 'ASSIGNED'].includes(t.status)) row.pendingTasks += 1;
    if (OPEN_STATUSES.includes(t.status) && t.dueDate && new Date(t.dueDate) < now) row.overdueTasks += 1;
  }
  res.json(Object.values(byUser));
}

async function assertDepartmentUser(departmentId, userId, label) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, departmentId: true, isActive: true } });
  if (!u || !u.isActive) throw new HttpError(400, `${label} is not a valid active user`);
  if (departmentId && u.departmentId !== departmentId) {
    throw new HttpError(400, `${label} does not belong to this task's department`);
  }
}

async function create(req, res) {
  const { assignedToId, departmentId, parentOperationId, ...rest } = req.body;
  if (req.user.scopeToDepartment && departmentId !== req.user.departmentId) {
    throw new HttpError(403, 'You can only create tasks for your own department');
  }
  const jc = await prisma.jobcard.findUnique({ where: { id: rest.jobcardId }, select: { id: true } });
  if (!jc) throw new HttpError(400, 'Jobcard not found');
  if (assignedToId) await assertDepartmentUser(departmentId, assignedToId, 'Assigned To');
  if (parentOperationId) {
    const parent = await loadTask(parentOperationId);
    if (parent.status !== 'COMPLETED') throw new HttpError(400, 'Rework can only be created from a completed task — use POST /tasks/:id/rework instead');
  }

  const task = await prisma.jobcardOperation.create({
    data: {
      ...rest,
      departmentId,
      assignedToId: assignedToId || null,
      assignedById: assignedToId ? req.user.id : null,
      createdById: req.user.id,
      parentOperationId: parentOperationId || null,
      status: assignedToId ? 'ASSIGNED' : 'NOT_STARTED',
    },
    include: TASK_INCLUDE,
  });
  await audit(req, 'create', 'JobcardOperation', task.id, { title: task.title, jobcardId: task.jobcardId });
  if (task.assignedToId) {
    await prisma.notification.create({
      data: {
        userId: task.assignedToId, type: 'TASK_ASSIGNED',
        title: `New task assigned: ${task.title || task.process?.name || 'Task'}`,
        body: `On jobcard ${task.jobcard.number}${task.dueDate ? ` — due ${new Date(task.dueDate).toLocaleDateString('en-IN')}` : ''}`,
        refType: 'JOBCARD_OPERATION', refId: task.id,
      },
    }).catch(() => {});
  }
  res.status(201).json(withComputed(task));
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await loadTask(id);
  await assertTaskAccess(req, existing);
  if (TERMINAL_STATUSES.includes(existing.status)) {
    throw new HttpError(400, `Cannot edit a ${existing.status.toLowerCase()} task`);
  }
  // reassignment goes through POST /:id/assign so it gets its own history entry
  const { assignedToId, departmentId, ...rest } = req.body;
  if (departmentId && req.user.scopeToDepartment && departmentId !== req.user.departmentId) {
    throw new HttpError(403, 'You can only move a task within your own department');
  }
  const data = { ...rest };
  if (departmentId !== undefined) data.departmentId = departmentId;
  const task = await prisma.jobcardOperation.update({ where: { id }, data, include: TASK_INCLUDE });
  await audit(req, 'update', 'JobcardOperation', id);
  res.json(withComputed(task));
}

async function assign(req, res) {
  const id = parseInt(req.params.id, 10);
  const { assignedToId, notes: reassignNote } = req.body;
  const existing = await loadTask(id);
  await assertTaskAccess(req, existing);
  if (TERMINAL_STATUSES.includes(existing.status)) {
    throw new HttpError(400, `Cannot assign a ${existing.status.toLowerCase()} task`);
  }
  await assertDepartmentUser(existing.departmentId, assignedToId, 'Assigned To');

  const wasAssignedToSomeoneElse = existing.assignedToId && existing.assignedToId !== assignedToId;
  const task = await prisma.$transaction(async (tx) => {
    const updated = await tx.jobcardOperation.update({
      where: { id },
      data: {
        assignedToId,
        assignedById: req.user.id,
        status: 'ASSIGNED',
        acceptedAt: null,
        startAt: null,
      },
      include: TASK_INCLUDE,
    });
    await tx.jobcardNote.create({
      data: {
        jobcardId: existing.jobcardId, operationId: id, kind: 'COMMENT', authorId: req.user.id,
        body: wasAssignedToSomeoneElse
          ? `Reassigned from ${existing.assignedTo?.name || 'unassigned'} to ${updated.assignedTo.name}.${reassignNote ? ` ${reassignNote}` : ''}`
          : `Assigned to ${updated.assignedTo.name}.${reassignNote ? ` ${reassignNote}` : ''}`,
      },
    });
    return updated;
  });
  await audit(req, 'assign', 'JobcardOperation', id, { assignedToId, reassigned: !!wasAssignedToSomeoneElse });
  await prisma.notification.create({
    data: {
      userId: assignedToId, type: 'TASK_ASSIGNED',
      title: `Task assigned: ${task.title || task.process?.name || 'Task'}`,
      body: `On jobcard ${task.jobcard.number}`,
      refType: 'JOBCARD_OPERATION', refId: id,
    },
  }).catch(() => {});
  res.json(withComputed(task));
}

// guarded state machine — {from: [allowed to states]}
const TRANSITIONS = {
  NOT_STARTED: ['CANCELLED'],
  ASSIGNED: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['REOPENED'],
  REOPENED: ['IN_PROGRESS', 'ON_HOLD', 'COMPLETED'],
  REJECTED: ['ASSIGNED', 'CANCELLED'],
  CANCELLED: [],
};
const REASON_REQUIRED = new Set(['ON_HOLD', 'REJECTED', 'CANCELLED']);

async function setStatus(req, res) {
  const id = parseInt(req.params.id, 10);
  const { status, reason } = req.body;
  const existing = await loadTask(id);
  await assertTaskAccess(req, existing);

  const allowed = TRANSITIONS[existing.status] || [];
  if (!allowed.includes(status)) {
    throw new HttpError(400, `Cannot move a ${existing.status} task to ${status}`);
  }
  const isAssignee = existing.assignedToId === req.user.id;
  const isManager = req.user.role === 'SUPERADMIN' || req.user.permissions.includes('task.update');
  // acceptance/starting the work is the assignee's own action; a manager can
  // still hold/cancel/reopen/reassign-after-reject
  if (['ACCEPTED'].includes(status) && !isAssignee) {
    throw new HttpError(403, 'Only the assignee can accept this task');
  }
  if (status === 'REJECTED' && !isAssignee) {
    throw new HttpError(403, 'Only the assignee can reject this task');
  }
  if (status === 'REOPENED' && !isManager) {
    throw new HttpError(403, 'Only a manager can reopen a completed task');
  }
  if (status === 'CANCELLED' && !isManager) {
    throw new HttpError(403, 'Only a manager can cancel a task');
  }
  if (REASON_REQUIRED.has(status) && !reason) {
    throw new HttpError(400, `A reason is required to set status to ${status}`);
  }

  const data = { status };
  const now = new Date();
  if (status === 'ACCEPTED') data.acceptedAt = now;
  if (status === 'IN_PROGRESS' && !existing.startAt) data.startAt = now;
  if (status === 'COMPLETED') { data.endAt = now; data.progressPercent = 100; }
  if (status === 'REOPENED') { data.endAt = null; }

  const task = await prisma.$transaction(async (tx) => {
    const updated = await tx.jobcardOperation.update({ where: { id }, data, include: TASK_INCLUDE });
    if (reason) {
      await tx.jobcardNote.create({
        data: { jobcardId: existing.jobcardId, operationId: id, kind: 'COMMENT', authorId: req.user.id, body: `${status}: ${reason}` },
      });
    }
    return updated;
  });
  await audit(req, 'statusChange', 'JobcardOperation', id, { from: existing.status, to: status, reason });

  // notify the other side of the relationship
  const notify = [];
  if (status === 'COMPLETED' && existing.assignedById) notify.push([existing.assignedById, `Task completed: ${task.title || task.process?.name}`]);
  if (status === 'ON_HOLD' && existing.assignedById) notify.push([existing.assignedById, `Task on hold: ${task.title || task.process?.name} — ${reason}`]);
  if (status === 'REJECTED' && existing.assignedById) notify.push([existing.assignedById, `Task rejected: ${task.title || task.process?.name} — ${reason}`]);
  if (status === 'REOPENED' && existing.assignedToId) notify.push([existing.assignedToId, `Task reopened: ${task.title || task.process?.name}`]);
  for (const [userId, title] of notify) {
    await prisma.notification.create({
      data: { userId, type: 'TASK_STATUS', title, refType: 'JOBCARD_OPERATION', refId: id },
    }).catch(() => {});
  }
  res.json(withComputed(task));
}

async function setProgress(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await loadTask(id);
  await assertTaskAccess(req, existing);
  if (!['ACCEPTED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'].includes(existing.status)) {
    throw new HttpError(400, `Cannot update progress on a ${existing.status} task`);
  }
  const { progressPercent, actualHours } = req.body;
  const data = { progressPercent };
  if (actualHours !== undefined) data.actualHours = actualHours;
  const task = await prisma.jobcardOperation.update({ where: { id }, data, include: TASK_INCLUDE });
  await audit(req, 'progress', 'JobcardOperation', id, { progressPercent });
  res.json(withComputed(task));
}

// Rework: spawn a fresh task linked to a completed (failed-inspection) one.
// The original task's own record/history is never modified.
async function rework(req, res) {
  const id = parseInt(req.params.id, 10);
  const original = await loadTask(id);
  await assertTaskAccess(req, original);
  if (original.status !== 'COMPLETED') {
    throw new HttpError(400, 'Rework can only be created from a completed task');
  }
  const { reworkReason, assignedToId, dueDate, priority } = req.body;
  if (assignedToId) await assertDepartmentUser(original.departmentId, assignedToId, 'Assigned To');

  const task = await prisma.jobcardOperation.create({
    data: {
      jobcardId: original.jobcardId,
      processId: original.processId,
      machineId: original.machineId,
      departmentId: original.departmentId,
      title: `Rework: ${original.title || original.process?.name || 'Task'}`,
      parentOperationId: original.id,
      reworkReason,
      assignedToId: assignedToId || null,
      assignedById: assignedToId ? req.user.id : null,
      createdById: req.user.id,
      priority: priority || 'HIGH',
      dueDate: dueDate || null,
      status: assignedToId ? 'ASSIGNED' : 'NOT_STARTED',
    },
    include: TASK_INCLUDE,
  });
  await audit(req, 'rework', 'JobcardOperation', task.id, { parentOperationId: original.id, reworkReason });
  if (assignedToId) {
    await prisma.notification.create({
      data: {
        userId: assignedToId, type: 'TASK_ASSIGNED',
        title: `Rework task assigned: ${task.title}`,
        body: reworkReason,
        refType: 'JOBCARD_OPERATION', refId: task.id,
      },
    }).catch(() => {});
  }
  res.status(201).json(withComputed(task));
}

async function listNotes(req, res) {
  const id = parseInt(req.params.id, 10);
  const t = await loadTask(id);
  await assertTaskAccess(req, t);
  const notes = await prisma.jobcardNote.findMany({
    where: { operationId: id },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(notes);
}

async function addNote(req, res) {
  const id = parseInt(req.params.id, 10);
  const t = await loadTask(id);
  await assertTaskAccess(req, t);
  const { kind, body } = req.body;
  const note = await prisma.jobcardNote.create({
    data: { jobcardId: t.jobcardId, operationId: id, kind, body, authorId: req.user.id },
    include: { author: { select: { id: true, name: true } } },
  });
  res.status(201).json(note);
}

async function activity(req, res) {
  const id = parseInt(req.params.id, 10);
  const t = await loadTask(id);
  await assertTaskAccess(req, t);
  const [logs, notes] = await Promise.all([
    prisma.auditLog.findMany({
      where: { entity: 'JobcardOperation', entityId: id },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.jobcardNote.findMany({
      where: { operationId: id },
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const events = [
    ...logs.map((l) => ({ source: 'audit', id: `audit-${l.id}`, action: l.action, payload: l.payload, by: l.user ? l.user.name : null, createdAt: l.createdAt })),
    ...notes.map((n) => ({ source: 'note', id: `note-${n.id}`, kind: n.kind, body: n.body, by: n.author ? n.author.name : null, createdAt: n.createdAt })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(events);
}

module.exports = {
  list, get, dashboard, workload, create, update, assign,
  setStatus, setProgress, rework, listNotes, addNote, activity,
};
