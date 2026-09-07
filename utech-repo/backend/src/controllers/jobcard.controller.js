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
// roles (Department Head and anyone under them) can additionally receive
// work document-by-document via the Assignment chain, so their access is
// also keyed off having at least one Assignment pointing at this jobcard's
// attachments. Every other role is unrestricted.
async function hasAssignmentAccess(userId, jobcardId) {
  const count = await prisma.assignment.count({
    where: { assignedToId: userId, attachment: { refType: 'JOBCARD', refId: jobcardId } },
  });
  return count > 0;
}

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

async function jobcardIdsAssignedTo(userId) {
  const rows = await prisma.assignment.findMany({
    where: { assignedToId: userId, attachment: { refType: 'JOBCARD' } },
    select: { attachment: { select: { refId: true } } },
  });
  return [...new Set(rows.map((r) => r.attachment.refId))];
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
  const jc = await prisma.jobcard.create({
    data: {
      ...rest,
      date: new Date(rest.date),
      number,
      createdById: req.user ? req.user.id : null,
      lines: { create: lines },
      operations: { create: operations },
    },
    include: INCLUDE,
  });
  await audit(req, 'create', 'Jobcard', jc.id, { number });
  res.status(201).json(jc);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.jobcard.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Jobcard not found');
  await assertOwnership(req,existing);
  const { lines, operations, ...rest } = req.body;
  let orphanedAttachments = [];
  const jc = await prisma.$transaction(async (tx) => {
    if (lines) {
      // preserve line ids (instead of delete-all-recreate) so attachments
      // uploaded against a specific line stay attached across edits
      const existingLines = await tx.jobcardLine.findMany({ where: { jobcardId: id }, select: { id: true } });
      const existingIds = existingLines.map((l) => l.id);
      const incomingIds = lines.filter((l) => l.id).map((l) => l.id);
      const toDelete = existingIds.filter((eid) => !incomingIds.includes(eid));
      if (toDelete.length) {
        orphanedAttachments = await tx.attachment.findMany({ where: { refType: 'JOBCARD', lineId: { in: toDelete } } });
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
      await tx.jobcardOperation.deleteMany({ where: { jobcardId: id } });
    }
    return tx.jobcard.update({
      where: { id },
      data: {
        ...rest,
        ...(operations ? { operations: { create: operations } } : {}),
      },
      include: INCLUDE,
    });
  });
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
    const existing = await tx.jobcard.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Jobcard not found');
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
  });
  await audit(req, 'revert', 'Jobcard', id, { reason });
  res.json(jc);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  const jc = await prisma.jobcard.findUnique({ where: { id } });
  if (!jc) throw new HttpError(404, 'Jobcard not found');

  // first delete = cancel; deleting an already-cancelled project removes it for good
  if (jc.status === 'CANCELLED') {
    const attachments = await prisma.attachment.findMany({ where: { refType: 'JOBCARD', refId: id } });
    const attachmentIds = attachments.map((a) => a.id);
    await prisma.$transaction(async (tx) => {
      // these are optional historical links — drop them rather than block deletion
      await tx.productionBatch.updateMany({ where: { jobcardId: id }, data: { jobcardId: null } });
      await tx.customerMaterialLot.updateMany({ where: { jobcardId: id }, data: { jobcardId: null } });
      if (attachmentIds.length) {
        await tx.assignment.deleteMany({ where: { attachmentId: { in: attachmentIds } } });
        await tx.attachment.deleteMany({ where: { id: { in: attachmentIds } } });
      }
      // JobcardLine/JobcardOperation/JobcardRevert/JobcardNote cascade automatically
      await tx.jobcard.delete({ where: { id } });
    });
    for (const a of attachments) {
      try { fs.unlinkSync(path.join(uploadBaseDir, a.storedName)); } catch (_) { /* file may already be gone */ }
    }
    await audit(req, 'delete', 'Jobcard', id, { number: jc.number });
    return res.json({ ok: true, deleted: true });
  }

  await prisma.jobcard.update({ where: { id }, data: { status: 'CANCELLED' } });
  await audit(req, 'cancel', 'Jobcard', id, { number: jc.number });
  res.json({ ok: true, deleted: false });
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
  if (['CANCELLED', 'COMPLETED'].includes(jc.status)) {
    throw new HttpError(400, `Jobcard is already ${jc.status}`);
  }

  const updated = await prisma.jobcard.update({
    where: { id },
    data: { status: 'COMPLETED', workStatus: 'COMPLETED' },
    include: INCLUDE,
  });
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
