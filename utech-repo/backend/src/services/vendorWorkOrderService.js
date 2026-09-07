'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { notifyUsers } = require('../utils/notify');

const REF_TYPE = 'VENDOR_WORK_ORDER';
// statuses a work order can still move out of on its own
const OPEN_STATUSES = ['DRAFT', 'SENT', 'PARTIAL_RECEIVED'];
// statuses that are final — quantity changes must never silently reopen them
const CLOSED_STATUSES = ['RECEIVED', 'SHORT_CLOSED', 'CANCELLED'];

function outstanding(line) {
  return Number(line.qtySent) - Number(line.qtyReceived) - Number(line.qtyRejected);
}

// The single place that derives VendorWorkOrder.status from its line
// quantities, so the direct "record return" action and the GRN auto-sync can
// never disagree about where a work order stands.
async function recomputeStatus(tx, vendorWorkOrderId) {
  const vwo = await tx.vendorWorkOrder.findUnique({
    where: { id: vendorWorkOrderId },
    include: { lines: true },
  });
  if (!vwo) throw new HttpError(404, 'Vendor work order not found');
  // SHORT_CLOSED/CANCELLED are deliberate human decisions — a late quantity
  // correction must not undo them
  if (['SHORT_CLOSED', 'CANCELLED'].includes(vwo.status)) return vwo;

  const anyMovement = vwo.lines.some((l) => Number(l.qtyReceived) > 0 || Number(l.qtyRejected) > 0);
  const allResolved = vwo.lines.length > 0 && vwo.lines.every((l) => outstanding(l) <= 0);

  let status;
  if (allResolved) status = 'RECEIVED';
  else if (anyMovement) status = 'PARTIAL_RECEIVED';
  else if (vwo.sentDate) status = 'SENT';
  else status = 'DRAFT';

  return tx.vendorWorkOrder.update({
    where: { id: vendorWorkOrderId },
    data: {
      status,
      // keep the first full-return date; clear it if a reversal reopened the order
      actualReturnDate: status === 'RECEIVED' ? vwo.actualReturnDate || new Date() : null,
    },
    include: { lines: true, party: { select: { id: true, name: true } } },
  });
}

// Applies a GRN's accepted/rejected quantities onto the work order lines it
// received against. sign = +1 when the receipt is booked, -1 when it is
// reversed, which is what makes a cancelled GRN put the work order back to
// where it was.
async function applyGrnDelta({ tx, grn, sign }) {
  let vendorWorkOrderId = null;
  for (const l of grn.lines) {
    if (!l.vendorWorkOrderLineId) continue;
    const vwoLine = await tx.vendorWorkOrderLine.findUnique({ where: { id: l.vendorWorkOrderLineId } });
    if (!vwoLine) continue;
    await tx.vendorWorkOrderLine.update({
      where: { id: vwoLine.id },
      data: {
        qtyReceived: Math.max(0, Number(vwoLine.qtyReceived) + sign * Number(l.qtyAccepted)),
        qtyRejected: Math.max(0, Number(vwoLine.qtyRejected) + sign * Number(l.qtyRejected)),
      },
    });
    vendorWorkOrderId = vwoLine.vendorWorkOrderId;
  }
  if (!vendorWorkOrderId) return null;
  return recomputeStatus(tx, vendorWorkOrderId);
}

// Everyone who should hear about an outsourced scope moving: whoever raised it,
// both ends of the originating assignment, and the project's engineer/creator.
async function stakeholderIds(vwo, excludeUserId) {
  const ids = new Set();
  if (vwo.createdById) ids.add(vwo.createdById);
  if (vwo.sentById) ids.add(vwo.sentById);

  if (vwo.assignmentId) {
    const a = await prisma.assignment.findUnique({
      where: { id: vwo.assignmentId },
      select: { assignedById: true, assignedToId: true },
    });
    if (a) {
      ids.add(a.assignedById);
      ids.add(a.assignedToId);
    }
  }
  if (vwo.jobcardId) {
    const jc = await prisma.jobcard.findUnique({
      where: { id: vwo.jobcardId },
      select: { projectEngineerId: true, createdById: true },
    });
    if (jc) {
      if (jc.projectEngineerId) ids.add(jc.projectEngineerId);
      if (jc.createdById) ids.add(jc.createdById);
    }
  }
  if (excludeUserId) ids.delete(excludeUserId);
  return [...ids];
}

// Notifications must never break the action that triggered them (same contract
// as utils/notify and utils/audit).
async function notifyStakeholders(req, vwo, { type, title, body }) {
  try {
    const ids = await stakeholderIds(vwo, req.user && req.user.id);
    if (ids.length) {
      await prisma.notification.createMany({
        data: ids.map((userId) => ({ userId, type, title, body, refType: REF_TYPE, refId: vwo.id })),
      });
    }
    await notifyUsers(['Admin', 'Plant Head'], { type, title, body, refType: REF_TYPE, refId: vwo.id });
  } catch (e) {
    console.error('[vendorWorkOrder] notify failed:', e.message);
  }
}

function projectLabel(vwo) {
  if (vwo.jobcard) return vwo.jobcard.projectNumber || vwo.jobcard.number;
  if (vwo.assignment && vwo.assignment.attachment) return vwo.assignment.attachment.filename;
  return vwo.number;
}

async function notifySent(req, vwo) {
  const due = vwo.expectedReturnDate
    ? ` Expected back by ${new Date(vwo.expectedReturnDate).toLocaleDateString('en-IN')}.`
    : '';
  return notifyStakeholders(req, vwo, {
    type: 'VENDOR_WORK_ORDER_SENT',
    title: `Sent to vendor: ${projectLabel(vwo)}`,
    body: `${vwo.number} was sent to ${vwo.party.name}.${due}`,
  });
}

async function notifyReturn(req, vwo, grn) {
  const via = grn ? ` (GRN ${grn.number})` : '';
  const full = vwo.status === 'RECEIVED';
  return notifyStakeholders(req, vwo, {
    type: full ? 'VENDOR_WORK_ORDER_RECEIVED' : 'VENDOR_WORK_ORDER_PARTIAL',
    title: `${full ? 'Returned by vendor' : 'Partial return from vendor'}: ${projectLabel(vwo)}`,
    body: `${vwo.party.name} returned work under ${vwo.number}${via}.`,
  });
}

async function notifyClosed(req, vwo) {
  return notifyStakeholders(req, vwo, {
    type: 'VENDOR_WORK_ORDER_CLOSED',
    title: `Vendor work order ${vwo.status === 'CANCELLED' ? 'cancelled' : 'short closed'}: ${projectLabel(vwo)}`,
    body: `${vwo.number} (${vwo.party.name})${vwo.closureRemarks ? `: ${vwo.closureRemarks}` : ''}`,
  });
}

module.exports = {
  REF_TYPE,
  OPEN_STATUSES,
  CLOSED_STATUSES,
  outstanding,
  recomputeStatus,
  applyGrnDelta,
  notifySent,
  notifyReturn,
  notifyClosed,
};
