'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextNumber } = require('../utils/numbering');
const { calcLineAmount, calcTaxes, round2 } = require('../utils/gst');
const { audit } = require('../utils/audit');
const stockService = require('../services/stockService');

const PURCHASE_RETURN_INCLUDE = {
  party: true,
  grn: { include: { lines: true } },
  po: { select: { id: true, number: true } },
  lines: { include: { item: true } },
};

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'date', 'createdAt', 'number', 'total',
  ]);
  const where = {};
  if (req.query.status) {
    const statuses = req.query.status.split(',').map(s => s.trim());
    where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
  }
  if (req.query.partyId) where.partyId = parseInt(req.query.partyId, 10);
  if (req.query.grnId) where.grnId = parseInt(req.query.grnId, 10);
  if (req.query.poId) where.poId = parseInt(req.query.poId, 10);
  if (req.query.from || req.query.to) {
    where.date = {};
    if (req.query.from) where.date.gte = new Date(req.query.from);
    if (req.query.to) where.date.lte = new Date(req.query.to);
  }
  if (search) {
    where.OR = [
      { number: { contains: search } },
      { party: { name: { contains: search } } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.purchaseReturn.findMany({
      where, skip, take, orderBy: { [sortBy]: sortDir },
      include: { 
        party: { select: { id: true, name: true } }, 
        grn: { select: { id: true, number: true } },
        po: { select: { id: true, number: true } }
      },
    }),
    prisma.purchaseReturn.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const purchaseReturn = await prisma.purchaseReturn.findUnique({ where: { id }, include: PURCHASE_RETURN_INCLUDE });
  if (!purchaseReturn) throw new HttpError(404, 'Purchase return not found');
  res.json(purchaseReturn);
}

function buildLines(lines) {
  return lines.map((l) => ({
    grnLineId: l.grnLineId,
    itemId: l.itemId,
    description: l.description,
    qty: l.qty,
    rate: l.rate,
    gstRate: l.gstRate,
    amount: calcLineAmount(l.qty, l.rate),
    reason: l.reason,
  }));
}

async function create(req, res) {
  const { lines, isIntraState, ...rest } = req.body;

  // a return must be anchored to a real document — an unanchored return for
  // any party would let stock walk out of the company with no paper trail
  if (!rest.grnId && !rest.poId) {
    throw new HttpError(400, 'A purchase return requires a grnId or a poId to return against');
  }

  let partyId = rest.partyId;
  let grn = null;
  let po = null;
  if (rest.grnId) {
    grn = await prisma.gRN.findUnique({ where: { id: rest.grnId }, include: { party: true, lines: true } });
    if (!grn) throw new HttpError(404, 'GRN not found');
    partyId = grn.partyId;
  } else {
    po = await prisma.purchaseOrder.findUnique({ where: { id: rest.poId }, include: { party: true, grns: { select: { id: true } } } });
    if (!po) throw new HttpError(404, 'Purchase Order not found');
    partyId = po.partyId;
  }

  // every returned line must belong to the anchored document, and the
  // cumulative quantity returned for that GRN line (this + prior returns,
  // ignoring cancelled drafts) can never exceed what was accepted in
  for (const l of lines) {
    if (!l.grnLineId) {
      throw new HttpError(400, 'Every purchase return line must reference a grnLineId');
    }
    const grnLine = await prisma.grnLine.findUnique({ where: { id: Number(l.grnLineId) } });
    if (!grnLine) throw new HttpError(404, `GRN line ${l.grnLineId} not found`);
    if (grn) {
      if (grnLine.grnId !== grn.id) {
        throw new HttpError(400, `Line ${l.grnLineId} does not belong to GRN ${grn.number}`);
      }
    } else {
      // poId-anchored return: the GRN line must come from a GRN of this PO
      const lineGrn = await prisma.gRN.findUnique({ where: { id: grnLine.grnId }, select: { poId: true, number: true } });
      if (!lineGrn || lineGrn.poId !== po.id) {
        throw new HttpError(400, `Line ${l.grnLineId} does not belong to a GRN of purchase order ${po.number}`);
      }
    }
    const priorAgg = await prisma.purchaseReturnLine.aggregate({
      where: {
        grnLineId: grnLine.id,
        purchaseReturn: { status: { not: 'CANCELLED' } },
      },
      _sum: { qty: true },
    });
    const priorReturned = Number(priorAgg._sum.qty || 0);
    if (priorReturned + Number(l.qty) > Number(grnLine.qtyAccepted)) {
      throw new HttpError(400, `Return quantity exceeds the accepted quantity for GRN line ${grnLine.id} (accepted ${Number(grnLine.qtyAccepted)}, already returned ${priorReturned})`);
    }
  }
  
  const computedLines = buildLines(lines);
  const taxes = calcTaxes(lines, isIntraState);
  const total = round2(taxes.total);
  const number = await nextNumber('purchaseReturn', 'purchaseReturn');

  // explicit whitelist — the body never reaches computed money fields, status,
  // number or partyId
  const safe = {};
  for (const key of ['reason', 'notes']) if (rest[key] !== undefined) safe[key] = rest[key];

  const purchaseReturn = await prisma.$transaction(async (tx) => {
    const created = await tx.purchaseReturn.create({
      data: {
        ...safe,
        grnId: grn ? grn.id : null,
        poId: po ? po.id : (grn ? grn.poId : null),
        date: new Date(rest.date),
        partyId,
        number,
        subtotal: taxes.subtotal,
        cgst: taxes.cgst,
        sgst: taxes.sgst,
        igst: taxes.igst,
        total,
        status: 'DRAFT',
        lines: { create: computedLines },
      },
      include: PURCHASE_RETURN_INCLUDE,
    });
    
    await audit(req, 'create', 'PurchaseReturn', created.id, { number: created.number });
    return created;
  });
  
  res.status(201).json(purchaseReturn);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const { lines, isIntraState, ...rest } = req.body;

  const existing = await prisma.purchaseReturn.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Purchase return not found');
  if (existing.status !== 'DRAFT') {
    throw new HttpError(400, 'Cannot update purchase return in ' + existing.status + ' status');
  }

  // explicit whitelist — a generic edit must never reach id/number/status/
  // grnId/poId/partyId or the computed totals
  const editable = {};
  for (const key of ['date', 'reason', 'notes', 'creditNoteNo']) {
    if (rest[key] !== undefined) editable[key] = rest[key];
  }
  if (editable.date) {
    editable.date = new Date(editable.date);
  }

  if (lines) {
    const taxes = calcTaxes(lines, isIntraState !== false);
    Object.assign(editable, {
      subtotal: taxes.subtotal,
      cgst: taxes.cgst,
      sgst: taxes.sgst,
      igst: taxes.igst,
      total: round2(taxes.total),
    });
  }

  const purchaseReturn = await prisma.$transaction(async (tx) => {
    if (lines) {
      await tx.purchaseReturnLine.deleteMany({ where: { purchaseReturnId: id } });
    }
    const updated = await tx.purchaseReturn.update({
      where: { id },
      data: lines
        ? { ...editable, lines: { create: buildLines(lines) } }
        : editable,
      include: PURCHASE_RETURN_INCLUDE,
    });
    
    await audit(req, 'update', 'PurchaseReturn', id, { number: updated.number });
    return updated;
  });
  res.json(purchaseReturn);
}

async function approve(req, res) {
  const id = parseInt(req.params.id, 10);
  const purchaseReturn = await prisma.$transaction(async (tx) => {
    const existing = await tx.purchaseReturn.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Purchase return not found');
    if (existing.status !== 'DRAFT' && existing.status !== 'PENDING_APPROVAL') {
      throw new HttpError(400, 'Cannot approve purchase return in ' + existing.status + ' status');
    }

    const updated = await tx.purchaseReturn.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: req.user ? req.user.id : null,
        approvedAt: new Date(),
      },
      include: PURCHASE_RETURN_INCLUDE,
    });
    
    await audit(req, 'approve', 'PurchaseReturn', id, { number: updated.number });
    return updated;
  });
  res.json(purchaseReturn);
}

async function process(req, res) {
  const id = parseInt(req.params.id, 10);
  const purchaseReturn = await prisma.$transaction(async (tx) => {
    const existing = await tx.purchaseReturn.findUnique({ 
      where: { id },
      include: { lines: true }
    });
    if (!existing) throw new HttpError(404, 'Purchase return not found');
    if (existing.status !== 'APPROVED') {
      throw new HttpError(400, 'Cannot process purchase return in ' + existing.status + ' status');
    }

    // Update stock ledger for returned items (stock OUT)
    for (const line of existing.lines) {
      await stockService.moveCompanyStock({
        tx, itemId: line.itemId, date: new Date(),
        refType: 'PURCHASE_RETURN', refId: id, qtyOut: line.qty,
        notes: `Purchase return ${existing.number}`, skipAudit: true,
      });
    }

    // Update party ledger (credit to vendor)
    await tx.partyLedger.create({
      data: {
        partyId: existing.partyId,
        date: new Date(),
        refType: 'PURCHASE_RETURN',
        refId: id,
        debit: existing.total,
        credit: 0,
        notes: `Purchase return ${existing.number}`,
      },
    });

    const updated = await tx.purchaseReturn.update({
      where: { id },
      data: { status: 'PROCESSED' },
      include: PURCHASE_RETURN_INCLUDE,
    });
    
    await audit(req, 'process', 'PurchaseReturn', id, { number: updated.number });
    return updated;
  });
  res.json(purchaseReturn);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.purchaseReturn.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Purchase return not found');
  if (existing.status !== 'DRAFT') {
    throw new HttpError(400, 'Cannot cancel purchase return in ' + existing.status + ' status');
  }
  
  await prisma.purchaseReturn.update({ where: { id }, data: { status: 'CANCELLED' } });
  await audit(req, 'cancel', 'PurchaseReturn', id, { number: existing.number });
  res.json({ ok: true });
}

module.exports = { list, get, create, update, approve, process, remove };
