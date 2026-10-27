'use strict';
const prisma = require('../config/prisma');
const HttpError = require('./httpError');

// A user reaches a jobcard they don't own through one of two chains:
//   - the drawing Assignment chain (Department Head -> Operator, per attachment)
//   - a Task Progress item on that jobcard assigned to them
// Being handed work on a project must let you open that project.
async function hasAssignmentAccess(userId, jobcardId, db = prisma) {
  const [viaDrawing, viaTask] = await Promise.all([
    db.assignment.count({
      where: { assignedToId: userId, attachment: { refType: 'JOBCARD', refId: jobcardId } },
    }),
    db.jobcardOperationAssignee.count({
      where: { userId, operation: { jobcardId } },
    }),
  ]);
  return viaDrawing + viaTask > 0;
}

async function assertJobcardAccess(user, jc, db = prisma) {
  if (!user) return;
  if (user.role === 'Project Engineer' && jc.assignedOperatorId !== user.id) {
    throw new HttpError(403, 'This project is not assigned to you');
  }
  if (user.role === 'OPERATOR') {
    if (jc.assignedOperatorId === user.id) return;
    if (!(await hasAssignmentAccess(user.id, jc.id, db))) throw new HttpError(403, 'This project is not assigned to you');
  }
  if (user.scopeToDepartment && !(await hasAssignmentAccess(user.id, jc.id, db))) {
    throw new HttpError(403, 'This project is not assigned to you');
  }
}

async function jobcardIdsAssignedTo(userId) {
  const [drawingRows, taskRows] = await Promise.all([
    prisma.assignment.findMany({
      where: { assignedToId: userId, attachment: { refType: 'JOBCARD' } },
      select: { attachment: { select: { refId: true } } },
    }),
    prisma.jobcardOperationAssignee.findMany({
      where: { userId },
      select: { operation: { select: { jobcardId: true } } },
    }),
  ]);
  return [...new Set([
    ...drawingRows.map((r) => r.attachment.refId),
    ...taskRows.map((r) => r.operation.jobcardId),
  ])];
}

module.exports = { hasAssignmentAccess, assertJobcardAccess, jobcardIdsAssignedTo };
