'use strict';
const prisma = require('../config/prisma');

// A user reaches a jobcard they don't own through one of two chains:
//   - the drawing Assignment chain (Department Head -> Operator, per attachment)
//   - a Task Progress item on that jobcard assigned to them
// Being handed work on a project must let you open that project.
async function hasAssignmentAccess(userId, jobcardId) {
  const [viaDrawing, viaTask] = await Promise.all([
    prisma.assignment.count({
      where: { assignedToId: userId, attachment: { refType: 'JOBCARD', refId: jobcardId } },
    }),
    prisma.jobcardOperationAssignee.count({
      where: { userId, operation: { jobcardId } },
    }),
  ]);
  return viaDrawing + viaTask > 0;
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

module.exports = { hasAssignmentAccess, jobcardIdsAssignedTo };
