'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const stockService = require('../services/stockService');
const vendorWorkOrderService = require('../services/vendorWorkOrderService');

const INCLUDE = {
  po: { select: { id: true, number: true } },
  party: { select: { id: true, name: true } },
  vendorWorkOrder: { select: { id: true, number: true, status: true } },
  lines: { include: { item: true } },
};

// PO statuses that a receipt (or the reversal of one) is allowed to move. A
// cancelled or rejected PO must never be resurrected by GRN activity.
const RECEIVABLE_PO_STATUSES = ['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED'];

async function rollUpPoStatus(tx, poId) {
  const po = await tx.purchaseOrder.findUnique({ where: { id: poId }, select: { status: true } });
  if (!po || !RECEIVABLE_PO_STATUSES.includes(po.status)) return;
  const allLines = await tx.purchaseOrderLine.findMany({ where: { poId } });
  const fullyReceived = allLines.length > 0 && allLines.every((line) => Number(line.qtyReceived) >= Number(line.qty));
  const anyReceived = allLines.some((line) => Number(line.qtyReceived) > 0);
  const newStatus = fullyReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : 'APPROVED';
  await tx.purchaseOrder.update({ where: { id: poId }, data: { status: newStatus } });
}

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'date', 'createdAt', 'number',
  ]);
  const where = {};
  if (req.query.status) {
    const statuses = req.query.status.split(',').map(s => s.trim());
    where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
  }
  if (req.query.poId) where.poId = parseInt(req.query.poId, 10);
  if (req.query.vendorWorkOrderId) where.vendorWorkOrderId = parseInt(req.query.vendorWorkOrderId, 10);
  if (search) where.OR = [{ number: { contains: search } }];
  const [items, total] = await Promise.all([
    prisma.gRN.findMany({
      where, skip, take, orderBy: { [sortBy]: sortDir },
      include: { po: true, party: true, vendorWorkOrder: { select: { id: true, number: true } } },
    }),
    prisma.gRN.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const grn = await prisma.gRN.findUnique({ where: { id }, include: INCLUDE });
  if (!grn) throw new HttpError(404, 'GRN not found');
  res.json(grn);
}

async function create(req, res) {
  const { lines, poId, vendorWorkOrderId, ...rest } = req.body;
  const number = await nextNumber('gRN', 'GRN');

  // a receipt may only land on a PO that is open for receiving — never a
  // draft proposal, a rejected one, or a cancelled order
  let po = null;
  if (poId) {
    po = await prisma.purchaseOrder.findUnique({ where: { id: Number(poId) } });
    if (!po) throw new HttpError(404, 'Purchase order not found');
    if (!RECEIVABLE_PO_STATUSES.includes(po.status)) {
      throw new HttpError(400, `Cannot receive against a purchase order in ${po.status} status`);
    }
    // the receipt books stock into the company against the PO's vendor — a
    // mismatched party would corrupt both party ledgers
    if (rest.partyId && Number(rest.partyId) !== po.partyId) {
      throw new HttpError(400, 'GRN party does not match the purchase order party');
    }
  }
  const poLineIds = po ? new Set((await prisma.purchaseOrderLine.findMany({ where: { poId: po.id }, select: { id: true } })).map((l) => l.id)) : null;
  for (const l of lines) {
    if (l.poLineId && poLineIds && !poLineIds.has(Number(l.poLineId))) {
      throw new HttpError(400, `Line ${l.poLineId} does not belong to purchase order ${po.number}`);
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    // A receipt against a PO that was itself raised from a vendor work order
    // belongs to that work order. Resolving it here is what makes the
    // outsourcing tracker advance on its own, with nothing to link by hand.
    let vwoId = vendorWorkOrderId ? Number(vendorWorkOrderId) : null;
    if (!vwoId && poId) {
      const linked = await tx.vendorWorkOrder.findUnique({ where: { poId: Number(poId) }, select: { id: true } });
      if (linked) vwoId = linked.id;
    }
    let vwoLineByPoLine = new Map();
    if (vwoId) {
      const vwoLines = await tx.vendorWorkOrderLine.findMany({ where: { vendorWorkOrderId: vwoId } });
      vwoLineByPoLine = new Map(vwoLines.filter((l) => l.poLineId).map((l) => [l.poLineId, l.id]));
    }

    const created = await tx.gRN.create({
      data: {
        ...rest,
        date: new Date(rest.date),
        number,
        poId: poId ? Number(poId) : null,
        partyId: rest.partyId ? Number(rest.partyId) : (po ? po.partyId : null),
        vendorWorkOrderId: vwoId,
        status: 'ACCEPTED',
        lines: {
          create: lines.map((l) => ({
            itemId: l.itemId ? Number(l.itemId) : null,
            description: l.description || null,
            poLineId: l.poLineId ? Number(l.poLineId) : null,
            vendorWorkOrderLineId: l.vendorWorkOrderLineId
              ? Number(l.vendorWorkOrderLineId)
              : (l.poLineId ? vwoLineByPoLine.get(Number(l.poLineId)) || null : null),
            qty: Number(l.qty),
            qtyAccepted: Number(l.qtyAccepted ?? l.qty),
            qtyRejected: Number(l.qtyRejected ?? 0),
            rate: l.rate ? Number(l.rate) : null,
            notes: l.notes || null,
          })),
        },
      },
      include: INCLUDE,
    });

    // stock IN for accepted qty + update PO line received qty
    for (const l of created.lines) {
      const accepted = Number(l.qtyAccepted);
      // a non-catalog, vendor-made part has no Item master row and therefore no
      // stock position to move — it is tracked on its work order line instead
      if (accepted > 0 && l.itemId) {
        await stockService.moveCompanyStock({
          tx, itemId: l.itemId, date: new Date(rest.date),
          refType: 'GRN', refId: created.id, qtyIn: accepted,
          skipAudit: true, // GRN already audits the whole document once, below
        });
      }
      if (l.poLineId) {
        const line = await tx.purchaseOrderLine.findUnique({ where: { id: l.poLineId } });
        if (line) {
          const newReceived = Number(line.qtyReceived) + accepted;
          await tx.purchaseOrderLine.update({
            where: { id: l.poLineId },
            data: { qtyReceived: newReceived },
          });
        }
      }
    }

    if (created.poId) await rollUpPoStatus(tx, created.poId);

    const vwo = vwoId
      ? await vendorWorkOrderService.applyGrnDelta({ tx, grn: created, sign: 1 })
      : null;

    return { grn: created, vwo };
  });

  audit(req, 'create', 'GRN', result.grn.id, {
    number, poId: result.grn.poId, vendorWorkOrderId: result.grn.vendorWorkOrderId,
  });
  if (result.vwo) await vendorWorkOrderService.notifyReturn(req, result.vwo, result.grn);
  res.status(201).json(result.grn);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.gRN.findUnique({ where: { id }, select: { status: true } });
  if (!existing) throw new HttpError(404, 'GRN not found');
  if (existing.status === 'CANCELLED') throw new HttpError(400, 'Cannot edit a cancelled GRN');
  // status is a guarded transition (cancel reverses stock) — it must never be
  // settable through a generic edit, or a REJECTED flip would strand the stock
  const { status, ...rest } = req.body || {};
  const grn = await prisma.gRN.update({
    where: { id }, data: rest, include: INCLUDE,
  });
  audit(req, 'update', 'GRN', id);
  res.json(grn);
}

// Reverse a wrongly booked receipt. Without this a mistyped GRN left company
// stock permanently inflated with no way back.
async function cancel(req, res) {
  const id = parseInt(req.params.id, 10);
  const reason = req.body.reason || null;

  const result = await prisma.$transaction(async (tx) => {
    const grn = await tx.gRN.findUnique({ where: { id }, include: { lines: true } });
    if (!grn) throw new HttpError(404, 'GRN not found');
    if (grn.status === 'CANCELLED') throw new HttpError(400, 'This GRN is already cancelled');

    const returns = await tx.purchaseReturn.count({ where: { grnId: id } });
    if (returns > 0) {
      throw new HttpError(400, 'Cannot cancel: a purchase return already exists against this GRN');
    }

    for (const l of grn.lines) {
      const accepted = Number(l.qtyAccepted);
      if (accepted > 0 && l.itemId) {
        // allowNegative: the goods may already have been consumed or dispatched
        // since, and refusing to reverse would be worse than a negative balance
        // the stock ledger makes plainly visible
        await stockService.moveCompanyStock({
          tx, itemId: l.itemId, date: new Date(),
          refType: 'GRN_CANCEL', refId: id, qtyOut: accepted,
          notes: `GRN ${grn.number} cancelled`, allowNegative: true, skipAudit: true,
        });
      }
      if (l.poLineId) {
        const line = await tx.purchaseOrderLine.findUnique({ where: { id: l.poLineId } });
        if (line) {
          await tx.purchaseOrderLine.update({
            where: { id: l.poLineId },
            data: { qtyReceived: Math.max(0, Number(line.qtyReceived) - accepted) },
          });
        }
      }
    }

    if (grn.poId) await rollUpPoStatus(tx, grn.poId);

    const vwo = grn.vendorWorkOrderId
      ? await vendorWorkOrderService.applyGrnDelta({ tx, grn, sign: -1 })
      : null;

    const updated = await tx.gRN.update({
      where: { id },
      data: { status: 'CANCELLED', cancelReason: reason },
      include: INCLUDE,
    });
    return { grn: updated, vwo };
  });

  audit(req, 'cancel', 'GRN', id, { reason });
  res.json({ ok: true, grn: result.grn });
}

module.exports = { list, get, create, update, cancel };
