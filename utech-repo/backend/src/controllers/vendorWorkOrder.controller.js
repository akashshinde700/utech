'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextNumber } = require('../utils/numbering');
const { calcLineAmount, round2 } = require('../utils/gst');
const { audit } = require('../utils/audit');
const stockService = require('../services/stockService');
const svc = require('../services/vendorWorkOrderService');

const INCLUDE = {
  party: { select: { id: true, code: true, name: true, phone: true, city: true, gstin: true } },
  department: { select: { id: true, name: true } },
  jobcard: { select: { id: true, number: true, projectNumber: true, itemDescription: true } },
  assignment: {
    select: {
      id: true,
      status: true,
      pageNumbers: true,
      attachment: { select: { id: true, filename: true } },
      assignedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  },
  po: { select: { id: true, number: true, status: true, date: true, total: true } },
  jobworkChallan: { select: { id: true, number: true, status: true, date: true } },
  grns: { select: { id: true, number: true, date: true, status: true }, orderBy: { date: 'asc' } },
  lines: { include: { item: true } },
};

// Department-scoped roles (Department Head / Supervisor / Team Leader) only see
// their own department's outsourcing; everyone above that tier — Project
// Engineer included, since they own the project end to end — sees all of it.
function canSeeAll(user) {
  if (user.role === 'SUPERADMIN') return true;
  if (user.hierarchyLevel != null && user.hierarchyLevel <= 3) return true;
  return !user.scopeToDepartment;
}

function applyScope(where, user) {
  if (!canSeeAll(user)) where.departmentId = user.departmentId;
  return where;
}

async function assertVisible(vwo, user) {
  if (canSeeAll(user)) return;
  if (vwo.departmentId !== user.departmentId) {
    throw new HttpError(403, 'This vendor work order belongs to another department');
  }
}

async function loadOr404(id, include = { lines: true }) {
  const vwo = await prisma.vendorWorkOrder.findUnique({ where: { id }, include });
  if (!vwo) throw new HttpError(404, 'Vendor work order not found');
  return vwo;
}

async function assertVendor(partyId) {
  const party = await prisma.party.findUnique({ where: { id: partyId } });
  if (!party) throw new HttpError(404, 'Vendor not found');
  if (!['VENDOR', 'BOTH'].includes(party.type)) {
    throw new HttpError(400, `${party.name} is not marked as a vendor — set its type to Vendor or Both first`);
  }
  if (!party.isActive) throw new HttpError(400, `${party.name} is inactive`);
  return party;
}

function buildLines(lines) {
  return lines.map((l) => ({
    itemId: l.itemId || null,
    description: l.description || null,
    drawingNumber: l.drawingNumber || null,
    partNumber: l.partNumber || null,
    qtySent: l.qtySent,
    uomCode: l.uomCode || null,
    rate: l.rate == null ? null : l.rate,
    gstRate: l.gstRate == null ? 18 : l.gstRate,
    notes: l.notes || null,
  }));
}

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'date', 'createdAt', 'number', 'sentDate', 'expectedReturnDate',
  ]);
  const where = applyScope({}, req.user);
  if (req.query.status) {
    const statuses = req.query.status.split(',').map((s) => s.trim());
    where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
  }
  if (req.query.partyId) where.partyId = parseInt(req.query.partyId, 10);
  if (req.query.jobcardId) where.jobcardId = parseInt(req.query.jobcardId, 10);
  if (req.query.assignmentId) where.assignmentId = parseInt(req.query.assignmentId, 10);
  if (req.query.departmentId) where.departmentId = parseInt(req.query.departmentId, 10);
  if (req.query.open === 'true') where.status = { in: svc.OPEN_STATUSES };
  if (search) {
    where.OR = [
      { number: { contains: search } },
      { party: { name: { contains: search } } },
      { jobcard: { number: { contains: search } } },
      { jobcard: { projectNumber: { contains: search } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.vendorWorkOrder.findMany({ where, skip, take, orderBy: { [sortBy]: sortDir }, include: INCLUDE }),
    prisma.vendorWorkOrder.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

async function get(req, res) {
  const vwo = await loadOr404(parseInt(req.params.id, 10), INCLUDE);
  await assertVisible(vwo, req.user);
  res.json(vwo);
}

async function stats(req, res) {
  const where = applyScope({}, req.user);
  if (req.query.jobcardId) where.jobcardId = parseInt(req.query.jobcardId, 10);
  if (req.query.partyId) where.partyId = parseInt(req.query.partyId, 10);

  const rows = await prisma.vendorWorkOrder.findMany({
    where,
    select: { status: true, expectedReturnDate: true, party: { select: { id: true, name: true } } },
  });

  const now = new Date();
  const counts = {
    total: rows.length, draft: 0, atVendor: 0, partial: 0, received: 0, shortClosed: 0, cancelled: 0, overdue: 0,
  };
  const byVendor = new Map();
  for (const r of rows) {
    if (r.status === 'DRAFT') counts.draft++;
    else if (r.status === 'SENT') counts.atVendor++;
    else if (r.status === 'PARTIAL_RECEIVED') counts.partial++;
    else if (r.status === 'RECEIVED') counts.received++;
    else if (r.status === 'SHORT_CLOSED') counts.shortClosed++;
    else if (r.status === 'CANCELLED') counts.cancelled++;
    // "overdue" = still outside the company past the date it was promised back
    if (r.expectedReturnDate && new Date(r.expectedReturnDate) < now && svc.OPEN_STATUSES.includes(r.status)) {
      counts.overdue++;
    }
    if (!byVendor.has(r.party.id)) byVendor.set(r.party.id, { label: r.party.name, total: 0, open: 0 });
    const g = byVendor.get(r.party.id);
    g.total += 1;
    if (svc.OPEN_STATUSES.includes(r.status)) g.open += 1;
  }
  counts.onTimePercentage = counts.total ? Math.round(((counts.total - counts.overdue) / counts.total) * 100) : 100;
  res.json({ ...counts, byVendor: [...byVendor.values()].sort((a, b) => b.total - a.total) });
}

async function create(req, res) {
  const body = req.body;
  await assertVendor(body.partyId);

  let { jobcardId, departmentId } = body;
  // an outsourcing almost always starts from the assignment the department was
  // given — inherit the project and department from it so the trail is complete
  // without the user retyping what the system already knows
  if (body.assignmentId) {
    const a = await prisma.assignment.findUnique({
      where: { id: body.assignmentId },
      include: { attachment: { select: { refType: true, refId: true } } },
    });
    if (!a) throw new HttpError(404, 'Assignment not found');
    if (!jobcardId && a.attachment && a.attachment.refType === 'JOBCARD') jobcardId = a.attachment.refId;
    if (!departmentId) departmentId = a.departmentId;
  }
  if (jobcardId) {
    const jc = await prisma.jobcard.findUnique({ where: { id: jobcardId }, select: { id: true } });
    if (!jc) throw new HttpError(404, 'Project (jobcard) not found');
  }

  const number = await nextNumber('vendorWorkOrder', 'vendorWorkOrder');
  const vwo = await prisma.vendorWorkOrder.create({
    data: {
      number,
      partyId: body.partyId,
      assignmentId: body.assignmentId || null,
      jobcardId: jobcardId || null,
      departmentId: departmentId || null,
      date: body.date || new Date(),
      expectedReturnDate: body.expectedReturnDate || null,
      scopeDescription: body.scopeDescription || null,
      instructions: body.instructions || null,
      notes: body.notes || null,
      status: 'DRAFT',
      createdById: req.user.id,
      lines: { create: buildLines(body.lines) },
    },
    include: INCLUDE,
  });
  await audit(req, 'create', 'VendorWorkOrder', vwo.id, {
    number, partyId: vwo.partyId, assignmentId: vwo.assignmentId, jobcardId: vwo.jobcardId,
  });
  res.status(201).json(vwo);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await loadOr404(id);
  await assertVisible(existing, req.user);
  // once it is with the vendor the scope is a shared commitment — reopening it
  // for edits would silently change what the vendor was actually asked to do
  if (existing.status !== 'DRAFT') {
    throw new HttpError(400, `Cannot edit a work order in ${existing.status} status`);
  }
  const body = req.body;
  if (body.partyId) await assertVendor(body.partyId);

  const data = {};
  for (const k of ['partyId', 'assignmentId', 'jobcardId', 'departmentId', 'scopeDescription', 'instructions', 'notes']) {
    if (k in body) data[k] = body[k] || null;
  }
  if (body.partyId) data.partyId = body.partyId;
  if ('date' in body && body.date) data.date = body.date;
  if ('expectedReturnDate' in body) data.expectedReturnDate = body.expectedReturnDate || null;

  const vwo = await prisma.$transaction(async (tx) => {
    if (body.lines) {
      await tx.vendorWorkOrderLine.deleteMany({ where: { vendorWorkOrderId: id } });
      data.lines = { create: buildLines(body.lines) };
    }
    return tx.vendorWorkOrder.update({ where: { id }, data, include: INCLUDE });
  });
  await audit(req, 'update', 'VendorWorkOrder', id);
  res.json(vwo);
}

// Hand the scope to the vendor. This is the moment the user asked to capture:
// when it went out, and to whom. If physical material goes along with the
// drawings a JobworkChallan is raised in the same transaction so company stock
// is moved OUT exactly once, by the one document that owns stock.
async function send(req, res) {
  const id = parseInt(req.params.id, 10);
  const { sentDate, expectedReturnDate, notes, materialLines } = req.body;

  const before = await loadOr404(id);
  await assertVisible(before, req.user);

  const out = await prisma.$transaction(async (tx) => {
    const vwo = await tx.vendorWorkOrder.findUnique({ where: { id }, include: { lines: true } });
    if (vwo.status !== 'DRAFT') throw new HttpError(400, `Cannot send a work order in ${vwo.status} status`);

    const when = sentDate || new Date();
    let challan = null;
    if (materialLines && materialLines.length) {
      const challanNumber = await nextNumber('jobworkChallan', 'jobwork');
      challan = await tx.jobworkChallan.create({
        data: {
          number: challanNumber,
          date: when,
          partyId: vwo.partyId,
          status: 'ISSUED',
          materialOwnerType: 'COMPANY',
          expectedReturnDate: expectedReturnDate || vwo.expectedReturnDate,
          notes: `Material issued under vendor work order ${vwo.number}`,
          lines: {
            create: materialLines.map((l) => ({
              itemId: l.itemId,
              processId: l.processId || null,
              qtySent: l.qtySent,
              rate: l.rate == null ? null : l.rate,
              notes: l.notes || null,
            })),
          },
        },
        include: { lines: true },
      });
      for (const l of challan.lines) {
        await stockService.moveCompanyStock({
          tx, itemId: l.itemId, date: when,
          refType: 'JOBWORK_OUT', refId: challan.id, qtyOut: l.qtySent,
          notes: `Vendor work order ${vwo.number}`, skipAudit: true,
        });
      }
    }

    return tx.vendorWorkOrder.update({
      where: { id },
      data: {
        status: 'SENT',
        sentDate: when,
        sentById: req.user.id,
        materialIssued: !!challan,
        jobworkChallanId: challan ? challan.id : null,
        ...(expectedReturnDate ? { expectedReturnDate } : {}),
        ...(notes ? { notes } : {}),
      },
      include: INCLUDE,
    });
  });

  await audit(req, 'send', 'VendorWorkOrder', id, {
    partyId: out.partyId, sentDate: out.sentDate, jobworkChallanId: out.jobworkChallanId,
  });
  await svc.notifySent(req, out);
  res.json(out);
}

// Direct return entry, for scopes that never became a purchase (e.g. only
// drawings went out and came back). Deliberately blocked once a PO exists so
// received quantities always have exactly one owner — see the guard below.
async function receive(req, res) {
  const id = parseInt(req.params.id, 10);
  const { lines, remarks } = req.body;

  const before = await loadOr404(id);
  await assertVisible(before, req.user);

  const out = await prisma.$transaction(async (tx) => {
    const vwo = await tx.vendorWorkOrder.findUnique({
      where: { id },
      include: { lines: true, po: { select: { number: true } } },
    });
    if (!['SENT', 'PARTIAL_RECEIVED'].includes(vwo.status)) {
      throw new HttpError(400, `Cannot record a return against a work order in ${vwo.status} status`);
    }
    if (vwo.poId) {
      throw new HttpError(400, `Returns for this work order are booked through a GRN against PO ${vwo.po.number}. Create the GRN instead.`);
    }

    for (const upd of lines) {
      const line = vwo.lines.find((l) => l.id === upd.id);
      if (!line) throw new HttpError(400, `Line ${upd.id} does not belong to this work order`);
      const qtyReceived = Number(line.qtyReceived) + Number(upd.qtyReceived || 0);
      const qtyRejected = Number(line.qtyRejected) + Number(upd.qtyRejected || 0);
      if (qtyReceived + qtyRejected > Number(line.qtySent)) {
        throw new HttpError(400, `Received + rejected exceeds the ${Number(line.qtySent)} sent out on line "${line.description || line.itemId}"`);
      }
      await tx.vendorWorkOrderLine.update({ where: { id: line.id }, data: { qtyReceived, qtyRejected } });
    }

    await svc.recomputeStatus(tx, id);
    return tx.vendorWorkOrder.findUnique({ where: { id }, include: INCLUDE });
  });

  await audit(req, 'receive', 'VendorWorkOrder', id, { status: out.status, remarks: remarks || null });
  await svc.notifyReturn(req, out, null);
  res.json(out);
}

// Turn the outstanding scope into a real commercial document. Each work order
// line remembers the PO line it was ordered on (poLineId), which is what lets a
// GRN booked against that PO find its way back here on its own.
async function raisePurchaseOrder(req, res) {
  const id = parseInt(req.params.id, 10);
  const { date, expectedDate, notes } = req.body;

  const before = await loadOr404(id);
  await assertVisible(before, req.user);

  const out = await prisma.$transaction(async (tx) => {
    const vwo = await tx.vendorWorkOrder.findUnique({ where: { id }, include: { lines: true } });
    if (vwo.poId) throw new HttpError(400, 'A purchase order has already been raised for this work order');
    if (!svc.OPEN_STATUSES.includes(vwo.status)) {
      throw new HttpError(400, `Cannot raise a purchase order for a work order in ${vwo.status} status`);
    }
    const billable = vwo.lines.filter((l) => svc.outstanding(l) > 0);
    if (!billable.length) throw new HttpError(400, 'Nothing is outstanding on this work order');
    const unpriced = billable.find((l) => l.rate == null);
    if (unpriced) {
      throw new HttpError(400, `Set a rate on "${unpriced.description || 'every outstanding line'}" before raising a purchase order`);
    }

    let subtotal = 0;
    let gstTotal = 0;
    const draft = billable.map((l) => {
      const qty = svc.outstanding(l);
      const amount = calcLineAmount(qty, l.rate);
      subtotal += Number(amount);
      gstTotal += (Number(amount) * Number(l.gstRate || 0)) / 100;
      return {
        sourceLineId: l.id,
        itemId: l.itemId || null,
        description: l.description || l.partNumber || l.drawingNumber || null,
        qty,
        rate: l.rate,
        gstRate: l.gstRate,
        amount,
      };
    });

    const number = await nextNumber('purchaseOrder', 'PO');
    const po = await tx.purchaseOrder.create({
      data: {
        number,
        date: date || new Date(),
        expectedDate: expectedDate || vwo.expectedReturnDate || null,
        partyId: vwo.partyId,
        status: 'PENDING_APPROVAL',
        subtotal: round2(subtotal),
        gstTotal: round2(gstTotal),
        total: round2(subtotal + gstTotal),
        notes: notes || `Raised from vendor work order ${vwo.number}`,
      },
    });
    // created one at a time so each generated id can be tied back to its source
    // line — nested creates give no ordering guarantee
    for (const l of draft) {
      const poLine = await tx.purchaseOrderLine.create({
        data: {
          poId: po.id,
          itemId: l.itemId,
          description: l.description,
          qty: l.qty,
          rate: l.rate,
          gstRate: l.gstRate,
          amount: l.amount,
        },
      });
      await tx.vendorWorkOrderLine.update({ where: { id: l.sourceLineId }, data: { poLineId: poLine.id } });
    }
    await tx.vendorWorkOrder.update({ where: { id }, data: { poId: po.id } });
    return tx.vendorWorkOrder.findUnique({ where: { id }, include: INCLUDE });
  });

  await audit(req, 'raise-po', 'VendorWorkOrder', id, { poId: out.poId, poNumber: out.po.number });
  res.json(out);
}

// Close an order the vendor will never fully deliver, keeping the shortfall
// visible rather than leaving it open forever.
async function shortClose(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await loadOr404(id);
  await assertVisible(existing, req.user);
  if (!['SENT', 'PARTIAL_RECEIVED'].includes(existing.status)) {
    throw new HttpError(400, `Cannot short close a work order in ${existing.status} status`);
  }
  const vwo = await prisma.vendorWorkOrder.update({
    where: { id },
    data: {
      status: 'SHORT_CLOSED',
      closureRemarks: req.body.reason,
      actualReturnDate: existing.actualReturnDate || new Date(),
    },
    include: INCLUDE,
  });
  await audit(req, 'short-close', 'VendorWorkOrder', id, { reason: req.body.reason });
  await svc.notifyClosed(req, vwo);
  res.json(vwo);
}

async function cancel(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await loadOr404(id);
  await assertVisible(existing, req.user);

  const out = await prisma.$transaction(async (tx) => {
    const vwo = await tx.vendorWorkOrder.findUnique({
      where: { id },
      include: { lines: true, jobworkChallan: { include: { lines: true } }, po: { select: { number: true } } },
    });
    if (svc.CLOSED_STATUSES.includes(vwo.status)) {
      throw new HttpError(400, `Cannot cancel a work order in ${vwo.status} status`);
    }
    if (vwo.lines.some((l) => Number(l.qtyReceived) > 0 || Number(l.qtyRejected) > 0)) {
      throw new HttpError(400, 'Parts have already been returned against this work order — short close it instead');
    }
    if (vwo.poId) {
      throw new HttpError(400, `Cancel purchase order ${vwo.po.number} first`);
    }

    // material that went out under this order comes straight back into stock
    if (vwo.jobworkChallan && !['CANCELLED', 'RECEIVED'].includes(vwo.jobworkChallan.status)) {
      for (const l of vwo.jobworkChallan.lines) {
        const open = Number(l.qtySent) - Number(l.qtyReceived) - Number(l.qtyRejected);
        if (open <= 0 || !l.itemId) continue;
        await stockService.moveCompanyStock({
          tx, itemId: l.itemId, refType: 'JOBWORK_CANCEL', refId: vwo.jobworkChallan.id, qtyIn: open,
          notes: `Vendor work order ${vwo.number} cancelled`, skipAudit: true,
        });
      }
      await tx.jobworkChallan.update({ where: { id: vwo.jobworkChallan.id }, data: { status: 'CANCELLED' } });
    }

    return tx.vendorWorkOrder.update({
      where: { id },
      data: { status: 'CANCELLED', closureRemarks: req.body.reason },
      include: INCLUDE,
    });
  });

  await audit(req, 'cancel', 'VendorWorkOrder', id, { reason: req.body.reason });
  await svc.notifyClosed(req, out);
  res.json(out);
}

async function activity(req, res) {
  const id = parseInt(req.params.id, 10);
  const vwo = await loadOr404(id, {});
  await assertVisible(vwo, req.user);
  const rows = await prisma.auditLog.findMany({
    where: { entity: 'VendorWorkOrder', entityId: id },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true } } },
  });
  res.json(rows);
}

module.exports = {
  list, get, stats, create, update, send, receive, raisePurchaseOrder, shortClose, cancel, activity,
};
