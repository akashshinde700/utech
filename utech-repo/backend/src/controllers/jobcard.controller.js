'use strict';
const fs = require('fs');
const path = require('path');
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const { notifyUsers } = require('../utils/notify');
const { effectiveChecklist, computeProgress, validateChecklistPayload } = require('../utils/jobcardProgress');
const env = require('../config/env');
const { hasAssignmentAccess, assertJobcardAccess, jobcardIdsAssignedTo } = require('../utils/jobcardAccess');
const { lockJobcard } = require('../utils/transactionLocks');
const productionOutput = require('../services/productionOutput');

const uploadBaseDir = path.resolve(env.UPLOAD_DIR);

const INCLUDE = {
  party: { select: { id: true, name: true } },
  lines: { include: { item: true }, orderBy: { id: 'asc' } },
  operations: { include: { process: true, machine: true }, orderBy: { sequence: 'asc' } },
  reverts: true,
  createdBy: { select: { id: true, name: true } },
  assignedOperator: { select: { id: true, name: true } },
  projectEngineer: { select: { id: true, name: true } },
};

// Project Engineers only ever see/act on jobcards assigned to them via
// "Assigned Engineer" (assignedOperatorId). Operators AND department-scoped
// roles can additionally reach a jobcard through the drawing Assignment chain
// or a Task Progress item assigned to them (utils/jobcardAccess.js). Every
// other role is unrestricted.
async function assertOwnership(req, jc) {
  if (!req.user) return;
  if (req.user.role === 'Project Engineer' && jc.assignedOperatorId !== req.user.id) {
    throw new HttpError(403, 'This project is not assigned to you');
  }
  if (req.user.role === 'OPERATOR') {
    if (jc.assignedOperatorId === req.user.id) return;
    if (!(await hasAssignmentAccess(req.user.id, jc.id))) {
      throw new HttpError(403, 'This project is not assigned to you');
    }
  }
  if (req.user.scopeToDepartment && !(await hasAssignmentAccess(req.user.id, jc.id))) {
    throw new HttpError(403, 'This project is not assigned to you');
  }
}

function withProgress(jc) {
  return { ...jc, checklist: effectiveChecklist(jc), progressPercent: computeProgress(jc) };
}

async function list(req, res) {
  // default sort = createdAt (newest first) so a just-created project always
  // appears at the top, regardless of its business `date` field
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'createdAt', 'date', 'number',
  ]);
  const andConditions = [];
  if (req.query.status) andConditions.push({ status: req.query.status });
  if (req.query.partyId) andConditions.push({ partyId: parseInt(req.query.partyId, 10) });
  if (search) andConditions.push({ OR: [{ number: { contains: search } }, { itemDescription: { contains: search } }] });

  if (req.user.role === 'Project Engineer') {
    andConditions.push({ assignedOperatorId: req.user.id });
  } else if (req.user.role === 'OPERATOR') {
    const assignedIds = await jobcardIdsAssignedTo(req.user.id);
    andConditions.push({
      OR: [{ assignedOperatorId: req.user.id }, ...(assignedIds.length ? [{ id: { in: assignedIds } }] : [])],
    });
  } else if (req.user.scopeToDepartment) {
    const assignedIds = await jobcardIdsAssignedTo(req.user.id);
    andConditions.push({ id: { in: assignedIds.length ? assignedIds : [-1] } });
  }

  const where = andConditions.length ? { AND: andConditions } : {};
  const [items, total] = await Promise.all([
    prisma.jobcard.findMany({
      where, skip, take, orderBy: { [sortBy]: sortDir },
      include: {
        party: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        assignedOperator: { select: { id: true, name: true } },
        projectEngineer: { select: { id: true, name: true } },
        // just enough for computeProgress to use Task Progress on the cards
        operations: { select: { status: true } },
      },
    }),
    prisma.jobcard.count({ where }),
  ]);
  res.json(paginated(items.map(withProgress), total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const jc = await prisma.jobcard.findUnique({ where: { id }, include: INCLUDE });
  if (!jc) throw new HttpError(404, 'Jobcard not found');
  await assertOwnership(req,jc);
  res.json(withProgress(jc));
}

async function create(req, res) {
  const { lines, operations, ...rest } = req.body;
  const number = await nextNumber('jobcard', 'jobcard');
  // a create may not pin primary keys: drop any client-supplied task id
  const newOperations = (operations || []).map(({ id, ...op }) => op);
  const jc = await prisma.jobcard.create({
    data: {
      ...rest,
      date: new Date(rest.date),
      number,
      createdById: req.user ? req.user.id : null,
      lines: { create: lines },
      operations: { create: newOperations },
    },
    include: INCLUDE,
  });
  await audit(req, 'create', 'Jobcard', jc.id, { number });
  res.status(201).json(jc);
}


// A job card's `operations` array is the Task Progress module's task list — not
// throw-away form rows. The previous implementation deleted every operation and
// re-created the array, which (a) destroyed each task's id, so an operator's
// assignment, acceptance, progress, approval and comment thread (all cascading
// children) vanished on an unrelated job-card edit, and (b) silently reset a
// completed task back to NOT_STARTED. AUD-214 keeps the replace-all contract but
// makes it id-preserving and refuses to discard work that has history.
function operationHasHistory(op) {
  // a row with no status column value is a never-started task, not history
  return (op.status && op.status !== 'NOT_STARTED')
    || Number(op.progressPercent || 0) > 0
    || op.assignedToId != null
    || op.approvedAt != null
    || op.submittedAt != null
    || op.startAt != null
    || op.endAt != null
    || op.acceptedAt != null
    || (op.assignees && op.assignees.length > 0)
    || (op.comments && op.comments.length > 0);
}

async function applyOperationSet(tx, jobcardId, incoming) {
  const existing = await tx.jobcardOperation.findMany({
    where: { jobcardId },
    select: {
      id: true, title: true, status: true, progressPercent: true, assignedToId: true,
      approvedAt: true, submittedAt: true, startAt: true, endAt: true, acceptedAt: true,
      assignees: { select: { id: true } },
      comments: { select: { id: true } },
    },
  });
  const byId = new Map(existing.map((op) => [op.id, op]));

  const incomingIds = [];
  for (const op of incoming) {
    if (op.id == null) continue;
    if (!byId.has(op.id)) {
      throw new HttpError(400, `Task ${op.id} does not belong to this job card`);
    }
    if (incomingIds.includes(op.id)) {
      throw new HttpError(400, `Task ${op.id} appears more than once in this request`);
    }
    incomingIds.push(op.id);
  }

  // Tasks the caller dropped from the array: only removable while they carry no
  // work. Anything with progress, an assignee, an approval or comments is
  // history the Task Progress module owns — deleting it is a data loss, so the
  // whole update is refused and the user is told which task is the blocker.
  const dropped = existing.filter((op) => !incomingIds.includes(op.id));
  const blocked = dropped.filter(operationHasHistory);
  if (blocked.length) {
    const names = blocked.map((op) => op.title || `Task #${op.id}`).join(', ');
    throw new HttpError(
      400,
      `Cannot remove ${blocked.length} task(s) that already have history (${names}). ` +
      'Cancel or complete them in Task Progress instead of editing the job card.'
    );
  }
  const blockedIds = new Set(blocked.map((op) => op.id));

  // refs that would dangle if a dependent task were deleted
  const referenced = await tx.jobcardOperation.findMany({
    where: {
      OR: [
        { parentOperationId: { in: dropped.map((op) => op.id) } },
        { dependsOnOperationId: { in: dropped.map((op) => op.id) } },
      ],
    },
    select: { id: true, parentOperationId: true, dependsOnOperationId: true },
  });
  const referencedIds = new Set(referenced.flatMap((r) => [r.parentOperationId, r.dependsOnOperationId]).filter(Boolean));

  for (const op of dropped) {
    if (blockedIds.has(op.id) || referencedIds.has(op.id)) continue;
    await tx.jobcardOperation.delete({ where: { id: op.id } });
  }

  for (const op of incoming) {
    const { id, ...data } = op;
    if (id != null && byId.has(id)) {
      // in-place update; status/progress stay owned by the task endpoints
      await tx.jobcardOperation.update({ where: { id }, data });
    } else {
      await tx.jobcardOperation.create({ data: { ...data, jobcardId } });
    }
  }
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.jobcard.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Jobcard not found');
  await assertOwnership(req,existing);
  const { lines, operations, ...rest } = req.body;
  let orphanedAttachments = [];
  const jc = await prisma.$transaction(async (tx) => {
    await lockJobcard(tx, id);
    const current = await tx.jobcard.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, 'Jobcard not found');
    await assertJobcardAccess(req.user, current, tx);
    const closes = ['CANCELLED', 'COMPLETED'].includes(rest.status);
    if (closes && rest.status !== current.status) {
      throw new HttpError(400, 'Use the dedicated complete or cancel action for this job card');
    }
    if (['COMPLETED', 'CANCELLED'].includes(current.status) && rest.status && rest.status !== current.status) {
      throw new HttpError(400, 'Cannot change a closed job card status here; use revert for completed cards');
    }
    const changesCustomer = rest.partyId !== undefined && rest.partyId !== current.partyId;
    if ((closes || changesCustomer) && await tx.customerMaterialAllocation.count({ where: { jobcardId: id, releasedAt: null } })) {
      throw new HttpError(400, 'Release customer-material reservations before closing or changing this job card');
    }
    if (lines) {
      // preserve line ids (instead of delete-all-recreate) so attachments
      // uploaded against a specific line stay attached across edits
      const existingLines = await tx.jobcardLine.findMany({ where: { jobcardId: id }, select: { id: true } });
      const existingIds = existingLines.map((l) => l.id);
      const incomingIds = lines.filter((l) => l.id).map((l) => l.id);
      const toDelete = existingIds.filter((eid) => !incomingIds.includes(eid));
      if (toDelete.length) {
        orphanedAttachments = await tx.attachment.findMany({ where: { refType: 'JOBCARD', lineId: { in: toDelete } } });
        if (orphanedAttachments.length && await tx.assignment.count({ where: { attachmentId: { in: orphanedAttachments.map((a) => a.id) } } })) {
          throw new HttpError(400, 'Remove or resolve drawing assignments before removing a job-card line');
        }
        await tx.attachment.deleteMany({ where: { refType: 'JOBCARD', lineId: { in: toDelete } } });
        await tx.jobcardLine.deleteMany({ where: { id: { in: toDelete } } });
      }
      for (const l of lines) {
        const { id: lineId, ...data } = l;
        if (lineId && existingIds.includes(lineId)) {
          await tx.jobcardLine.update({ where: { id: lineId }, data });
        } else {
          await tx.jobcardLine.create({ data: { ...data, jobcardId: id } });
        }
      }
    }
    if (operations) {
      await applyOperationSet(tx, id, operations);
    }
    // operations were already written by applyOperationSet() above — passing
    // them again here would re-create them (and collide on their ids)
    return tx.jobcard.update({
      where: { id },
      data: { ...rest },
      include: INCLUDE,
    });
  }, { isolationLevel: 'ReadCommitted' });
  for (const a of orphanedAttachments) {
    try { fs.unlinkSync(path.join(uploadBaseDir, a.storedName)); } catch (_) { /* file may already be gone */ }
  }
  await audit(req, 'update', 'Jobcard', id);
  if (rest.assignedOperatorId !== undefined) await audit(req, 'assign', 'Jobcard', id, { assignedOperatorId: rest.assignedOperatorId });
  if (rest.status !== undefined) await audit(req, 'statusChange', 'Jobcard', id, { status: rest.status });
  res.json(withProgress(jc));
}

async function revert(req, res) {
  const id = parseInt(req.params.id, 10);
  const { reason } = req.body;
  const jc = await prisma.$transaction(async (tx) => {
    await lockJobcard(tx, id);
    const existing = await tx.jobcard.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Jobcard not found');
    await assertJobcardAccess(req.user, existing, tx);
    if (['CANCELLED', 'REVERTED'].includes(existing.status)) {
      throw new HttpError(400, `Cannot revert a jobcard that is ${existing.status}`);
    }
    await tx.jobcardRevert.create({
      data: { jobcardId: id, reason, revertedById: req.user ? req.user.id : null },
    });
    return tx.jobcard.update({
      where: { id },
      data: { status: 'REVERTED' },
      include: INCLUDE,
    });
  }, { isolationLevel: 'ReadCommitted' });
  await audit(req, 'revert', 'Jobcard', id, { reason });
  res.json(jc);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  let attachments = [];
  const result = await prisma.$transaction(async (tx) => {
    await lockJobcard(tx, id);
    const jc = await tx.jobcard.findUnique({ where: { id } });
    if (!jc) throw new HttpError(404, 'Jobcard not found');
    await assertJobcardAccess(req.user, jc, tx);
    if (await tx.customerMaterialAllocation.count({ where: { jobcardId: id, releasedAt: null } })) {
      throw new HttpError(400, 'Release customer-material reservations before cancelling this job card');
    }
    if (await tx.assignment.count({ where: {
      status: { notIn: ['COMPLETED', 'CANCELLED'] }, attachment: { refType: 'JOBCARD', refId: id },
    } })) throw new HttpError(400, 'Finish or cancel open drawing assignments before cancelling this job card');
    if (jc.status === 'CANCELLED') {
      if (await tx.customerMaterialAllocation.count({ where: { jobcardId: id } })) {
        throw new HttpError(400, 'Job card has allocation history and cannot be permanently deleted');
      }
      attachments = await tx.attachment.findMany({ where: { refType: 'JOBCARD', refId: id } });
      const attachmentIds = attachments.map((a) => a.id);
      await tx.productionBatch.updateMany({ where: { jobcardId: id }, data: { jobcardId: null } });
      await tx.customerMaterialLot.updateMany({ where: { jobcardId: id }, data: { jobcardId: null } });
      if (attachmentIds.length) {
        await tx.assignment.deleteMany({ where: { attachmentId: { in: attachmentIds } } });
        await tx.attachment.deleteMany({ where: { id: { in: attachmentIds } } });
      }
      await tx.jobcard.delete({ where: { id } });
      return { deleted: true, number: jc.number };
    }
    await tx.jobcard.update({ where: { id }, data: { status: 'CANCELLED' } });
    return { deleted: false, number: jc.number };
  }, { isolationLevel: 'ReadCommitted' });
  for (const a of attachments) {
    try { fs.unlinkSync(path.join(uploadBaseDir, a.storedName)); } catch (_) { /* file may already be gone */ }
  }
  await audit(req, result.deleted ? 'delete' : 'cancel', 'Jobcard', id, { number: result.number });
  res.json({ ok: true, deleted: result.deleted });
}

async function updateProgress(req, res) {
  const id = parseInt(req.params.id, 10);
  const jc = await prisma.jobcard.findUnique({ where: { id } });
  if (!jc) throw new HttpError(404, 'Jobcard not found');
  await assertOwnership(req,jc);

  const { workStatus, checklist } = req.body;
  const data = {};
  if (workStatus !== undefined) data.workStatus = workStatus;
  if (checklist !== undefined) {
    if (!validateChecklistPayload(checklist)) throw new HttpError(400, 'Invalid checklist payload');
    data.checklist = checklist;
  }
  if (!Object.keys(data).length) throw new HttpError(400, 'Nothing to update');

  const updated = await prisma.jobcard.update({ where: { id }, data, include: INCLUDE });
  await audit(req, 'progress', 'Jobcard', id, data);
  res.json(withProgress(updated));
}

async function complete(req, res) {
  const id = parseInt(req.params.id, 10);
  const jc = await prisma.jobcard.findUnique({ where: { id }, include: { assignedOperator: true } });
  if (!jc) throw new HttpError(404, 'Jobcard not found');
  await assertOwnership(req,jc);
  const updated = await prisma.$transaction(async (tx) => {
    await lockJobcard(tx, id);
    const current = await tx.jobcard.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, 'Jobcard not found');
    await assertJobcardAccess(req.user, current, tx);
    if (['CANCELLED', 'COMPLETED'].includes(current.status)) throw new HttpError(400, `Jobcard is already ${current.status}`);
    if (await tx.customerMaterialAllocation.count({ where: { jobcardId: id, releasedAt: null } })) {
      throw new HttpError(400, 'Release customer-material reservations before completing this job card');
    }
    // Open department assignments still block completion as before.
    const openAssignments = await tx.assignment.findMany({
      where: {
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        attachment: { refType: 'JOBCARD', refId: id },
      },
      select: { department: { select: { name: true } } },
    });
    if (openAssignments.length) {
      const byDept = {};
      for (const a of openAssignments) {
        const name = a.department?.name || 'Unassigned department';
        byDept[name] = (byDept[name] || 0) + 1;
      }
      const detail = Object.entries(byDept).map(([name, n]) => `${name} (${n})`).join(', ');
      throw new HttpError(400, `${openAssignments.length} assignment(s) are still open — ${detail}. Every department must finish its pages before the project can be completed.`);
    }
    // MFG-04: a project is finished only once something was actually produced.
    // The figure comes from its completed production batches, never typed in.
    if (!(Number(current.qtyProduced || 0) > 0)) {
      throw new HttpError(400, 'No production recorded yet — complete at least one production batch for this project before closing it');
    }
    // QC-02: ...and once every quality check on it has passed
    await productionOutput.assertQualityPassed(tx, id);

    return tx.jobcard.update({ where: { id }, data: { status: 'COMPLETED', workStatus: 'COMPLETED' }, include: INCLUDE });
  }, { isolationLevel: 'ReadCommitted' });
  await audit(req, 'complete', 'Jobcard', id);
  await notifyUsers(['SUPERADMIN', 'MANAGER'], {
    type: 'JOBCARD_COMPLETED',
    title: `Project ${jc.number} marked completed`,
    body: `${jc.assignedOperator ? jc.assignedOperator.name : 'An operator'} marked ${jc.projectNumber || jc.number} as completed.`,
    refType: 'JOBCARD',
    refId: id,
  });
  res.json(withProgress(updated));
}

async function listNotes(req, res) {
  const id = parseInt(req.params.id, 10);
  const jc = await prisma.jobcard.findUnique({ where: { id } });
  if (!jc) throw new HttpError(404, 'Jobcard not found');
  await assertOwnership(req,jc);
  const notes = await prisma.jobcardNote.findMany({
    where: { jobcardId: id },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(notes);
}

async function addNote(req, res) {
  const id = parseInt(req.params.id, 10);
  const jc = await prisma.jobcard.findUnique({ where: { id } });
  if (!jc) throw new HttpError(404, 'Jobcard not found');
  await assertOwnership(req,jc);
  const { kind, body } = req.body;
  const note = await prisma.jobcardNote.create({
    data: { jobcardId: id, kind, body, authorId: req.user ? req.user.id : null },
    include: { author: { select: { id: true, name: true } } },
  });
  res.status(201).json(note);
}

async function activity(req, res) {
  const id = parseInt(req.params.id, 10);
  const jc = await prisma.jobcard.findUnique({ where: { id } });
  if (!jc) throw new HttpError(404, 'Jobcard not found');
  await assertOwnership(req,jc);

  const [logs, notes] = await Promise.all([
    prisma.auditLog.findMany({
      where: { entity: { in: ['Jobcard', 'Attachment:JOBCARD'] }, entityId: id },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.jobcardNote.findMany({
      where: { jobcardId: id },
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const events = [
    ...logs.map((l) => ({
      source: 'audit', id: `audit-${l.id}`, action: l.action, payload: l.payload,
      by: l.user ? l.user.name : null, createdAt: l.createdAt,
    })),
    ...notes.map((n) => ({
      source: 'note', id: `note-${n.id}`, kind: n.kind, body: n.body,
      by: n.author ? n.author.name : null, createdAt: n.createdAt,
    })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json(events);
}

module.exports = {
  list, get, create, update, revert, remove,
  updateProgress, complete, listNotes, addNote, activity,
};
