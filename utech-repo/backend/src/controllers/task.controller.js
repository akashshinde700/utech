'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { audit } = require('../utils/audit');
const { hasAssignmentAccess } = require('../utils/jobcardAccess');

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
  approvedBy: { select: { id: true, name: true } },
  parentOperation: { select: { id: true, title: true, status: true } },
  dependsOnOperation: { select: { id: true, title: true, status: true, process: { select: { name: true } } } },
  reworkTasks: { select: { id: true, title: true, status: true } },
  assignees: {
    include: { user: { select: { id: true, name: true, email: true } }, assignedBy: { select: { id: true, name: true } } },
    orderBy: { id: 'asc' },
  },
};

const OPEN_STATUSES = ['NOT_STARTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'ON_HOLD', 'SUBMITTED', 'REOPENED'];
const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED', 'REJECTED'];

// `userId` (the caller) drives `myAssignment`/`canTick`, which is what the
// operator's checkbox binds to. Omit it for contexts with no single viewer.
function withComputed(t, userId = null) {
  const overdue = OPEN_STATUSES.includes(t.status) && t.dueDate && new Date(t.dueDate) < new Date();
  const displayTitle = t.title || t.process?.name || `Task #${t.id}`;
  const assignees = t.assignees || [];
  const myAssignment = userId ? assignees.find((a) => a.userId === userId) || null : null;
  return {
    ...t,
    overdue: !!overdue,
    displayTitle,
    assigneeTotal: assignees.length,
    assigneeDoneCount: assignees.filter((a) => a.status === 'COMPLETED').length,
    myAssignment,
    // live while the task is open; after it closes the operator may still
    // withdraw their own tick, unless a reviewer has already signed it off
    canTick: !!myAssignment && !['CANCELLED', 'REJECTED'].includes(t.status)
      && !(t.status === 'COMPLETED' && t.approvedAt),
  };
}

// True when `userId` is on the hook for this task — either as the (legacy,
// kept-in-sync) primary assignee or as one of the multi-operator assignees.
function isAssigneeOf(task, userId) {
  if (task.assignedToId === userId) return true;
  return (task.assignees || []).some((a) => a.userId === userId);
}

// Normalizes the assignee list a client may send as `assigneeIds` (new,
// multi-operator) or `assignedToId` (existing single-assignee callers).
function requestedAssigneeIds(body) {
  const ids = [];
  if (Array.isArray(body.assigneeIds)) ids.push(...body.assigneeIds);
  if (body.assignedToId) ids.push(body.assignedToId);
  return [...new Set(ids.map((n) => parseInt(n, 10)).filter(Boolean))];
}

// A scoped user (Department Head / Supervisor / Team Leader) only ever
// operates within their own department. An Operator only ever operates on
// tasks assigned to them. Everyone else (task.update/task.create holders
// without scopeToDepartment — Admin, Manager, SUPERADMIN) is unrestricted.
function scopeWhere(req) {
  if (req.user.role === 'SUPERADMIN') return {};
  if (req.user.scopeToDepartment) return { departmentId: req.user.departmentId };
  if (req.user.role === 'OPERATOR') {
    return { OR: [{ assignedToId: req.user.id }, { assignees: { some: { userId: req.user.id } } }] };
  }
  return {};
}

async function assertTaskAccess(req, task) {
  if (req.user.role === 'SUPERADMIN') return;
  if (req.user.scopeToDepartment) {
    if (task.departmentId !== req.user.departmentId) throw new HttpError(403, 'This task is outside your department');
    return;
  }
  if (req.user.role === 'OPERATOR') {
    if (!isAssigneeOf(task, req.user.id)) throw new HttpError(403, 'This task is not assigned to you');
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
  if (q.assignedToId) {
    // matches the primary assignee or anyone on the multi-operator list
    const uid = parseInt(q.assignedToId, 10);
    where.AND.push({ OR: [{ assignedToId: uid }, { assignees: { some: { userId: uid } } }] });
  }
  if (q.priority) where.AND.push({ priority: q.priority });
  if (q.status) {
    const statuses = q.status.split(',').map((s) => s.trim());
    where.AND.push({ status: statuses.length === 1 ? statuses[0] : { in: statuses } });
  }
  if (q.overdue === '1') {
    where.AND.push({ status: { in: OPEN_STATUSES }, dueDate: { lt: new Date() } });
  }
  if (q.unassigned === '1') where.AND.push({ assignedToId: null, assignees: { none: {} } });
  // completion filter, independent of the workflow status
  if (q.completion === 'done') where.AND.push({ status: 'COMPLETED' });
  if (q.completion === 'pending') where.AND.push({ status: { in: OPEN_STATUSES } });
  if (search) {
    where.AND.push({
      OR: [
        { title: { contains: search } },
        { notes: { contains: search } },
        { process: { name: { contains: search } } },
        { jobcard: { number: { contains: search } } },
        { jobcard: { project: { name: { contains: search } } } },
        // search by the operator doing the work, not just the task text
        { assignees: { some: { user: { name: { contains: search } } } } },
      ],
    });
  }
  const [items, total] = await Promise.all([
    prisma.jobcardOperation.findMany({
      where, skip, take, orderBy: { [sortBy]: sortDir }, include: TASK_INCLUDE,
    }),
    prisma.jobcardOperation.count({ where }),
  ]);
  res.json(paginated(items.map((t) => withComputed(t, req.user.id)), total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const t = await loadTask(id);
  await assertTaskAccess(req, t);
  res.json(withComputed(t, req.user.id));
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
    submitted: 0, completed: 0, cancelled: 0, overdue: 0,
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
    else if (r.status === 'SUBMITTED') summary.submitted += 1;
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
    select: { id: true, name: true, email: true, departmentId: true, role: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  const tasks = await prisma.jobcardOperation.findMany({
    where: { assignedToId: { in: users.map((u) => u.id) } },
    select: { assignedToId: true, status: true, dueDate: true },
  });
  const now = new Date();
  const byUser = Object.fromEntries(users.map(({ role, ...u }) => [u.id, {
    ...u, roleName: role?.name || null, activeTasks: 0, pendingTasks: 0, overdueTasks: 0,
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

// A department-scoped creator may only put work on a project they can
// actually reach (drawing Assignment chain or an existing task there), exactly
// as the project page itself is gated. Unscoped managers are unrestricted.
async function assertProjectAccess(req, jobcardId) {
  const jc = await prisma.jobcard.findUnique({ where: { id: jobcardId }, select: { id: true } });
  if (!jc) throw new HttpError(400, 'Project not found');
  if (req.user.role === 'SUPERADMIN' || !req.user.scopeToDepartment) return;
  if (!(await hasAssignmentAccess(req.user.id, jobcardId))) {
    throw new HttpError(403, 'This project is not assigned to you');
  }
}

// Task Progress items come from the Process Master. A department-scoped
// creator picks only from their own department's items (stage mapping lives
// on Process.departmentId); nobody may file a department's item under another
// department.
async function resolveProcess(req, processId, departmentId) {
  if (!processId) {
    if (req.user.scopeToDepartment) throw new HttpError(400, "Pick a Task Progress item from your department's list");
    return null;
  }
  const proc = await prisma.process.findUnique({
    where: { id: processId },
    select: { id: true, name: true, stage: true, departmentId: true, isActive: true },
  });
  if (!proc || !proc.isActive) throw new HttpError(400, 'Task Progress item not found');
  if (req.user.scopeToDepartment && proc.departmentId !== req.user.departmentId) {
    throw new HttpError(403, `"${proc.name}" is not one of your department's Task Progress items`);
  }
  if (proc.departmentId && proc.departmentId !== departmentId) {
    throw new HttpError(400, `"${proc.name}" belongs to another department`);
  }
  return proc;
}

// The same item may be on a project only once while it is live; a cancelled
// one can be re-added, and rework tasks are deliberately repeats.
async function assertNotDuplicate(jobcardId, processId, excludeId = null) {
  if (!processId) return;
  const clash = await prisma.jobcardOperation.findFirst({
    where: {
      jobcardId, processId, parentOperationId: null,
      status: { not: 'CANCELLED' },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, process: { select: { name: true } } },
  });
  if (clash) throw new HttpError(409, `"${clash.process.name}" is already on this project`);
}

// Fan a task assignment out to every assigned operator's notification inbox.
async function notifyAssignees(task, userIds, title, body) {
  if (!userIds.length) return;
  await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId, type: 'TASK_ASSIGNED', title, body,
      refType: 'JOBCARD_OPERATION', refId: task.id,
    })),
  }).catch(() => {});
}

async function create(req, res) {
  const { assignedToId, assigneeIds: _ignored, departmentId, parentOperationId, ...rest } = req.body;
  if (req.user.scopeToDepartment && departmentId !== req.user.departmentId) {
    throw new HttpError(403, 'You can only create tasks for your own department');
  }
  await assertProjectAccess(req, rest.jobcardId);
  const proc = await resolveProcess(req, rest.processId, departmentId);
  if (!proc && !(rest.title || '').trim()) throw new HttpError(400, 'Task name is required');
  if (!parentOperationId) await assertNotDuplicate(rest.jobcardId, rest.processId);

  const ids = requestedAssigneeIds(req.body);
  for (const uid of ids) await assertDepartmentUser(departmentId, uid, 'Assigned operator');

  if (parentOperationId) {
    const parent = await loadTask(parentOperationId);
    if (parent.status !== 'COMPLETED') throw new HttpError(400, 'Rework can only be created from a completed task — use POST /tasks/:id/rework instead');
  }

  const task = await prisma.jobcardOperation.create({
    data: {
      ...rest,
      departmentId,
      // kept in sync with the first assignee so every existing single-assignee
      // query (My Tasks filter, dashboards, notifications) keeps working
      assignedToId: ids[0] || null,
      assignedById: ids.length ? req.user.id : null,
      createdById: req.user.id,
      parentOperationId: parentOperationId || null,
      status: ids.length ? 'ASSIGNED' : 'NOT_STARTED',
      assignees: { create: ids.map((userId) => ({ userId, assignedById: req.user.id })) },
    },
    include: TASK_INCLUDE,
  });
  await audit(req, 'create', 'JobcardOperation', task.id, { title: task.title, jobcardId: task.jobcardId, assigneeIds: ids });
  await notifyAssignees(
    task, ids,
    `New task assigned: ${task.title || task.process?.name || 'Task'}`,
    `On project ${task.jobcard.number}${task.dueDate ? ` — due ${new Date(task.dueDate).toLocaleDateString('en-IN')}` : ''}`,
  );
  res.status(201).json(withComputed(task, req.user.id));
}

// Add several of a department's Task Progress items to a project in one go,
// all given to the same operators. All-or-nothing: one invalid or duplicate
// item rejects the whole request, so a half-applied selection never lands.
async function createBulk(req, res) {
  const { jobcardId, departmentId, priority, dueDate, notes, requiresApproval } = req.body;
  if (req.user.scopeToDepartment && departmentId !== req.user.departmentId) {
    throw new HttpError(403, 'You can only create tasks for your own department');
  }
  await assertProjectAccess(req, jobcardId);

  // `items` gives each item its own operators; the older `processIds` form
  // gives every item the same `assigneeIds`
  const shared = requestedAssigneeIds(req.body);
  const requested = req.body.items
    ? req.body.items.map((i) => ({ processId: i.processId, ids: requestedAssigneeIds(i) }))
    : req.body.processIds.map((processId) => ({ processId, ids: shared }));
  const seen = new Set();
  const plan = [];
  for (const r of requested) {
    if (seen.has(r.processId)) continue;
    seen.add(r.processId);
    const proc = await resolveProcess(req, r.processId, departmentId);
    await assertNotDuplicate(jobcardId, r.processId);
    for (const uid of r.ids) await assertDepartmentUser(departmentId, uid, 'Assigned operator');
    plan.push({ proc, ids: r.ids });
  }

  const created = await prisma.$transaction((tx) => Promise.all(plan.map(({ proc, ids }, i) => tx.jobcardOperation.create({
    data: {
      jobcardId, departmentId, processId: proc.id, title: proc.name, sequence: i,
      notes: notes || null, priority: priority || 'MEDIUM', dueDate: dueDate || null,
      requiresApproval: !!requiresApproval,
      assignedToId: ids[0] || null,
      assignedById: ids.length ? req.user.id : null,
      createdById: req.user.id,
      status: ids.length ? 'ASSIGNED' : 'NOT_STARTED',
      assignees: { create: ids.map((userId) => ({ userId, assignedById: req.user.id })) },
    },
    include: TASK_INCLUDE,
  }))));

  for (const t of created) {
    await audit(req, 'create', 'JobcardOperation', t.id, {
      title: t.title, jobcardId, processId: t.processId, assigneeIds: t.assignees.map((a) => a.userId),
    });
  }
  // one notification per operator, listing only the items that are theirs
  const perUser = {};
  for (const t of created) for (const a of t.assignees) (perUser[a.userId] ||= []).push(t.title);
  if (created.length && Object.keys(perUser).length) {
    const jcNumber = created[0].jobcard.number;
    await prisma.notification.createMany({
      data: Object.entries(perUser).map(([userId, titles]) => ({
        userId: Number(userId), type: 'TASK_ASSIGNED',
        title: titles.length === 1 ? `New task assigned: ${titles[0]}` : `${titles.length} new tasks assigned on ${jcNumber}`,
        body: `${titles.join(', ')} — project ${jcNumber}${dueDate ? `, due ${new Date(dueDate).toLocaleDateString('en-IN')}` : ''}`,
        refType: 'JOBCARD', refId: jobcardId,
      })),
    }).catch(() => {});
  }
  res.status(201).json(created.map((t) => withComputed(t, req.user.id)));
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await loadTask(id);
  await assertTaskAccess(req, existing);
  if (TERMINAL_STATUSES.includes(existing.status)) {
    throw new HttpError(400, `Cannot edit a ${existing.status.toLowerCase()} task`);
  }
  // reassignment goes through POST /:id/assign so it gets its own history entry
  const { assignedToId, assigneeIds, departmentId, ...rest } = req.body;
  if (departmentId && req.user.scopeToDepartment && departmentId !== req.user.departmentId) {
    throw new HttpError(403, 'You can only move a task within your own department');
  }
  const data = { ...rest };
  if (departmentId !== undefined) data.departmentId = departmentId;
  const processChanged = rest.processId !== undefined && (rest.processId || null) !== existing.processId;
  const deptChanged = departmentId !== undefined && departmentId !== existing.departmentId;
  if (processChanged || deptChanged) {
    const nextProcessId = rest.processId !== undefined ? rest.processId : existing.processId;
    const nextDept = departmentId !== undefined ? departmentId : existing.departmentId;
    await resolveProcess(req, nextProcessId, nextDept);
    if (!existing.parentOperationId) await assertNotDuplicate(existing.jobcardId, nextProcessId, id);
  }
  const task = await prisma.jobcardOperation.update({ where: { id }, data, include: TASK_INCLUDE });
  await audit(req, 'update', 'JobcardOperation', id);
  res.json(withComputed(task, req.user.id));
}

// Set the exact operator list for a task. Adds/removes are diffed so an
// existing operator's own completion tick and assignment timestamp survive a
// reassignment that merely adds a colleague.
async function assign(req, res) {
  const id = parseInt(req.params.id, 10);
  const { notes: reassignNote } = req.body;
  const existing = await loadTask(id);
  await assertTaskAccess(req, existing);
  if (TERMINAL_STATUSES.includes(existing.status)) {
    throw new HttpError(400, `Cannot assign a ${existing.status.toLowerCase()} task`);
  }
  const ids = requestedAssigneeIds(req.body);
  if (!ids.length) throw new HttpError(400, 'Select at least one operator');
  for (const uid of ids) await assertDepartmentUser(existing.departmentId, uid, 'Assigned operator');

  const current = (existing.assignees || []).map((a) => a.userId);
  const added = ids.filter((u) => !current.includes(u));
  const removed = current.filter((u) => !ids.includes(u));
  if (!added.length && !removed.length && existing.assignedToId === ids[0]) {
    return res.json(withComputed(existing, req.user.id));
  }
  const removedNames = (existing.assignees || [])
    .filter((a) => removed.includes(a.userId))
    .map((a) => `${a.user.name}${a.status === 'COMPLETED' ? ' (had completed)' : ''}`);

  const task = await prisma.$transaction(async (tx) => {
    if (removed.length) {
      await tx.jobcardOperationAssignee.deleteMany({ where: { operationId: id, userId: { in: removed } } });
    }
    if (added.length) {
      await tx.jobcardOperationAssignee.createMany({
        data: added.map((userId) => ({ operationId: id, userId, assignedById: req.user.id })),
        skipDuplicates: true,
      });
    }
    // anyone still pending means the task is back to being outstanding work
    const rows = await tx.jobcardOperationAssignee.findMany({ where: { operationId: id } });
    const allDone = rows.length > 0 && rows.every((r) => r.status === 'COMPLETED');
    const data = {
      assignedToId: ids[0],
      assignedById: req.user.id,
      progressPercent: rows.length ? Math.round((rows.filter((r) => r.status === 'COMPLETED').length / rows.length) * 100) : 0,
    };
    if (allDone) {
      // dropping the last outstanding operator finishes the task, exactly as
      // that operator ticking their own checkbox would have
      const now = new Date();
      if (existing.requiresApproval) {
        data.status = 'SUBMITTED';
        data.submittedAt = existing.submittedAt || now;
      } else {
        data.status = 'COMPLETED';
        data.endAt = existing.endAt || now;
      }
    } else {
      // someone still owes work, so the task is open again: it goes back to
      // ASSIGNED only when nothing has actually been started yet
      const anyProgress = rows.some((r) => r.status === 'COMPLETED') || !!existing.acceptedAt || !!existing.startAt;
      data.status = anyProgress ? 'IN_PROGRESS' : 'ASSIGNED';
      data.submittedAt = null;
      data.approvedAt = null;
      data.approvedById = null;
      data.endAt = null;
      if (!anyProgress) { data.acceptedAt = null; data.startAt = null; }
    }
    const updated = await tx.jobcardOperation.update({ where: { id }, data, include: TASK_INCLUDE });
    const parts = [];
    if (added.length) parts.push(`Assigned to ${updated.assignees.filter((a) => added.includes(a.userId)).map((a) => a.user.name).join(', ')}.`);
    if (removedNames.length) parts.push(`Removed ${removedNames.join(', ')}.`);
    if (reassignNote) parts.push(reassignNote);
    await tx.jobcardNote.create({
      data: {
        jobcardId: existing.jobcardId, operationId: id, kind: 'COMMENT', authorId: req.user.id,
        body: parts.join(' '),
      },
    });
    return updated;
  });
  await audit(req, 'assign', 'JobcardOperation', id, { added, removed, assigneeIds: ids });
  await notifyAssignees(
    task, added,
    `Task assigned: ${task.title || task.process?.name || 'Task'}`,
    `On project ${task.jobcard.number}`,
  );
  res.json(withComputed(task, req.user.id));
}

// guarded state machine — {from: [allowed to states]}
const TRANSITIONS = {
  NOT_STARTED: ['CANCELLED'],
  ASSIGNED: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'SUBMITTED', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
  // review gate — the assignee hands it in, the manager closes it or sends
  // it back for rework (REOPENED puts it back in the assignee's hands)
  SUBMITTED: ['COMPLETED', 'REOPENED', 'CANCELLED'],
  COMPLETED: ['REOPENED'],
  REOPENED: ['IN_PROGRESS', 'ON_HOLD', 'SUBMITTED', 'COMPLETED'],
  REJECTED: ['ASSIGNED', 'CANCELLED'],
  CANCELLED: [],
};
const REASON_REQUIRED = new Set(['ON_HOLD', 'REJECTED', 'CANCELLED', 'REOPENED']);

async function setStatus(req, res) {
  const id = parseInt(req.params.id, 10);
  const { status, reason } = req.body;
  const existing = await loadTask(id);
  await assertTaskAccess(req, existing);

  const allowed = TRANSITIONS[existing.status] || [];
  if (!allowed.includes(status)) {
    throw new HttpError(400, `Cannot move a ${existing.status} task to ${status}`);
  }
  const isAssignee = isAssigneeOf(existing, req.user.id);
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
  if (status === 'SUBMITTED' && !isAssignee) {
    throw new HttpError(403, 'Only the assignee can submit this task for review');
  }
  // a task created with a review gate can only be closed by the reviewer
  if (status === 'COMPLETED' && existing.requiresApproval && !isManager) {
    throw new HttpError(400, 'This task needs review — submit it instead, and a manager will approve it');
  }
  if (REASON_REQUIRED.has(status) && !reason) {
    throw new HttpError(400, `A reason is required to set status to ${status}`);
  }
  // With several operators on one task, an assignee closing it outright would
  // silently discard their colleagues' outstanding work. They tick their own
  // checkbox instead (PATCH /:id/my-completion); a manager may still override.
  const pendingOthers = (existing.assignees || []).filter((a) => a.status !== 'COMPLETED' && a.userId !== req.user.id);
  if (['COMPLETED', 'SUBMITTED'].includes(status) && !isManager && pendingOthers.length) {
    throw new HttpError(400, `${pendingOthers.length} other operator(s) still have this task open — tick your own checkbox instead`);
  }

  const data = { status };
  const now = new Date();
  if (status === 'ACCEPTED') data.acceptedAt = now;
  if (status === 'IN_PROGRESS' && !existing.startAt) data.startAt = now;
  if (status === 'SUBMITTED') { data.submittedAt = now; data.progressPercent = 100; }
  if (status === 'COMPLETED') {
    data.endAt = now;
    data.progressPercent = 100;
    if (existing.requiresApproval) { data.approvedAt = now; data.approvedById = req.user.id; }
  }
  if (status === 'REOPENED') { data.endAt = null; data.submittedAt = null; data.approvedAt = null; data.approvedById = null; data.progressPercent = 0; }

  const task = await prisma.$transaction(async (tx) => {
    if (status === 'COMPLETED') {
      await tx.jobcardOperationAssignee.updateMany({
        where: { operationId: id, status: 'PENDING' },
        data: { status: 'COMPLETED', completedAt: now },
      });
    }
    if (status === 'REOPENED') {
      await tx.jobcardOperationAssignee.updateMany({
        where: { operationId: id },
        data: { status: 'PENDING', completedAt: null },
      });
    }
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
  if (status === 'SUBMITTED' && existing.assignedById) notify.push([existing.assignedById, `Task submitted for review: ${task.title || task.process?.name}`]);
  if (status === 'REOPENED' && existing.assignedToId) notify.push([existing.assignedToId, `Rework requested: ${task.title || task.process?.name} — ${reason}`]);
  for (const [userId, title] of notify) {
    await prisma.notification.create({
      data: { userId, type: 'TASK_STATUS', title, refType: 'JOBCARD_OPERATION', refId: id },
    }).catch(() => {});
  }
  res.json(withComputed(task, req.user.id));
}

// The operator's checkbox. Ticks (or un-ticks) only the caller's own row, then
// derives the parent task's state from the full assignee set: the task closes
// only once every assigned operator has ticked — or goes to review first when
// the task was created with a review gate.
async function setMyCompletion(req, res) {
  const id = parseInt(req.params.id, 10);
  const { done, remarks } = req.body;
  const existing = await loadTask(id);
  await assertTaskAccess(req, existing);

  const mine = (existing.assignees || []).find((a) => a.userId === req.user.id);
  if (!mine) throw new HttpError(403, 'This task is not assigned to you');
  if (['CANCELLED', 'REJECTED'].includes(existing.status)) {
    throw new HttpError(400, `This task is ${existing.status.toLowerCase()}`);
  }
  if (existing.status === 'COMPLETED') {
    // un-ticking reopens the operator's share; a reviewed sign-off or a rework
    // already raised against the result is final
    if (done) return res.json(withComputed(existing, req.user.id));
    if (existing.approvedAt) throw new HttpError(400, 'This task was approved — ask your Department Head to reopen it');
    if ((existing.reworkTasks || []).length) throw new HttpError(400, 'A rework task exists for this item — ask your Department Head to reopen it');
  }
  // idempotent: a double tap/double submit is a no-op, never a second record
  if (done === (mine.status === 'COMPLETED')) {
    return res.json(withComputed(existing, req.user.id));
  }

  const now = new Date();
  const task = await prisma.$transaction(async (tx) => {
    await tx.jobcardOperationAssignee.update({
      where: { id: mine.id },
      data: {
        status: done ? 'COMPLETED' : 'PENDING',
        completedAt: done ? now : null,
        remarks: remarks || mine.remarks,
      },
    });
    const rows = await tx.jobcardOperationAssignee.findMany({ where: { operationId: id } });
    const doneCount = rows.filter((r) => r.status === 'COMPLETED').length;
    const allDone = rows.length > 0 && doneCount === rows.length;

    const data = { progressPercent: rows.length ? Math.round((doneCount / rows.length) * 100) : 0 };
    if (allDone) {
      if (existing.requiresApproval) {
        data.status = 'SUBMITTED';
        data.submittedAt = now;
      } else {
        data.status = 'COMPLETED';
        data.endAt = now;
      }
    } else {
      // partially done (or just un-ticked) — the task is live work again
      data.status = 'IN_PROGRESS';
      data.submittedAt = null;
      data.endAt = null;
      if (!existing.startAt) data.startAt = now;
      if (!existing.acceptedAt) data.acceptedAt = now;
    }
    const updated = await tx.jobcardOperation.update({ where: { id }, data, include: TASK_INCLUDE });
    await tx.jobcardNote.create({
      data: {
        jobcardId: existing.jobcardId, operationId: id, kind: 'COMMENT', authorId: req.user.id,
        body: done
          ? `Marked complete by ${req.user.name || 'operator'} (${doneCount}/${rows.length} done).${remarks ? ` ${remarks}` : ''}`
          : `Completion withdrawn by ${req.user.name || 'operator'} (${doneCount}/${rows.length} done).`,
      },
    });
    return updated;
  });

  await audit(req, done ? 'taskCompleted' : 'taskCompletionUndone', 'JobcardOperation', id, {
    assigneeId: mine.id, doneCount: task.assignees.filter((a) => a.status === 'COMPLETED').length, total: task.assignees.length,
  });

  // tell whoever handed the work out
  const manager = existing.assignedById || existing.createdById;
  if (done && manager && manager !== req.user.id) {
    const label = task.title || task.process?.name || 'Task';
    await prisma.notification.create({
      data: {
        userId: manager, type: 'TASK_STATUS',
        title: task.status === 'SUBMITTED'
          ? `Task submitted for review: ${label}`
          : task.status === 'COMPLETED'
            ? `Task completed: ${label}`
            : `${req.user.name || 'Operator'} completed their part of: ${label}`,
        body: `Project ${task.jobcard.number} — ${task.assignees.filter((a) => a.status === 'COMPLETED').length}/${task.assignees.length} operators done`,
        refType: 'JOBCARD_OPERATION', refId: id,
      },
    }).catch(() => {});
  }
  res.json(withComputed(task, req.user.id));
}

// Delete a Task Progress item. Anything that carries completion history is
// refused outright — cancelling preserves the record, deleting would erase it
// from project reporting.
async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await loadTask(id);
  await assertTaskAccess(req, existing);

  const hasHistory =
    existing.status === 'COMPLETED' ||
    !!existing.endAt ||
    !!existing.submittedAt ||
    (existing.assignees || []).some((a) => a.status === 'COMPLETED') ||
    (existing.reworkTasks || []).length > 0;
  if (hasHistory) {
    throw new HttpError(400, 'This task has completion history — cancel it instead so the record stays in project reporting');
  }
  const label = existing.title || existing.process?.name || `Task #${id}`;
  const assigneeIds = (existing.assignees || []).map((a) => a.userId);

  // assignee rows and the task's own comment thread cascade with it
  await prisma.jobcardOperation.delete({ where: { id } });
  await audit(req, 'delete', 'JobcardOperation', id, { title: label, jobcardId: existing.jobcardId, assigneeIds });

  if (assigneeIds.length) {
    await prisma.notification.createMany({
      data: assigneeIds.map((userId) => ({
        userId, type: 'TASK_STATUS',
        title: `Task removed: ${label}`,
        body: `On project ${existing.jobcard.number}`,
        refType: 'JOBCARD', refId: existing.jobcardId,
      })),
    }).catch(() => {});
  }
  res.json({ ok: true, deletedId: id });
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
  res.json(withComputed(task, req.user.id));
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
  res.status(201).json(withComputed(task, req.user.id));
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
  list, get, dashboard, workload, create, createBulk, update, assign, remove,
  setStatus, setProgress, setMyCompletion, rework, listNotes, addNote, activity,
};
