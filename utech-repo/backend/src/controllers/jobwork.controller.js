'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const stockService = require('../services/stockService');

const INCLUDE = {
  party: { select: { id: true, name: true } },
  lines: { include: { item: true, process: true } },
  customerMaterialLot: { select: { id: true, inwardNumber: true, materialDescription: true, customerId: true } },
};

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'date', 'createdAt', 'number',
  ]);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.partyId) where.partyId = parseInt(req.query.partyId, 10);
  if (search) where.OR = [{ number: { contains: search } }, { party: { name: { contains: search } } }];
  const [items, total] = await Promise.all([
    prisma.jobworkChallan.findMany({ where, skip, take, orderBy: { [sortBy]: sortDir }, include: { party: true } }),
    prisma.jobworkChallan.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const jw = await prisma.jobworkChallan.findUnique({ where: { id }, include: INCLUDE });
  if (!jw) throw new HttpError(404, 'Jobwork challan not found');
  res.json(jw);
}

async function create(req, res) {
  const { lines, ...rest } = req.body;
  const isCustomerOwned = rest.materialOwnerType === 'CUSTOMER';
  const number = await nextNumber('jobworkChallan', 'jobwork');

  const jw = await prisma.$transaction(async (tx) => {
    let lot = null;
    if (isCustomerOwned) {
      if (!rest.customerMaterialLotId) throw new HttpError(400, 'customerMaterialLotId is required for customer-owned material');
      lot = await tx.customerMaterialLot.findUnique({ where: { id: rest.customerMaterialLotId } });
      if (!lot) throw new HttpError(404, 'Customer material lot not found');
      if (!['RECEIVED', 'IN_PROCESS'].includes(lot.status)) {
        throw new HttpError(400, `Lot ${lot.inwardNumber} is not available to send out (status ${lot.status})`);
      }
    }

    // company-owned material must map to a catalog item — the stock movement
    // at issue/receipt/reversal is keyed on it. Customer material lines may be
    // description-only (tracked on the lot ledger instead).
    if (!isCustomerOwned) {
      for (const l of lines) {
        if (!l.itemId) throw new HttpError(400, 'itemId is required on every line of a company-owned challan');
      }
    }

    const created = await tx.jobworkChallan.create({
      data: {
        ...rest,
        date: new Date(rest.date),
        number,
        lines: { create: lines },
      },
      include: INCLUDE,
    });

    // log stock OUT — company items go through Item.currentStock, customer
    // material goes through its own lot ledger; the two never share a path.
    for (const l of lines) {
      if (isCustomerOwned) {
        await stockService.moveCustomerMaterial({
          tx, lotId: rest.customerMaterialLotId, date: new Date(rest.date),
          refType: 'JOBWORK_OUT', refId: created.id, qtyOut: l.qtySent,
        });
      } else {
        await stockService.moveCompanyStock({
          tx, itemId: l.itemId, date: new Date(rest.date),
          refType: 'JOBWORK_OUT', refId: created.id, qtyOut: l.qtySent,
          req, auditAction: 'create', auditEntity: 'JobworkChallan',
        });
      }
    }

    if (isCustomerOwned) {
      await tx.customerMaterialLot.update({ where: { id: lot.id }, data: { status: 'AT_VENDOR' } });
      await audit(req, 'create', 'JobworkChallan', created.id, { number, customerMaterialLotId: lot.id });
    }

    return created;
  });
  res.status(201).json(jw);
}

async function receive(req, res) {
  const id = parseInt(req.params.id, 10);
  const { lines } = req.body;
  const jw = await prisma.$transaction(async (tx) => {
    const challan = await tx.jobworkChallan.findUnique({ where: { id }, include: { lines: true } });
    if (!challan) throw new HttpError(404, 'Jobwork challan not found');
    if (!['ISSUED', 'PARTIAL_RECEIVED'].includes(challan.status)) {
      throw new HttpError(400, `Cannot receive against a challan in ${challan.status} status`);
    }
    const isCustomerOwned = challan.materialOwnerType === 'CUSTOMER';

    // reject payload lines that do not belong to this challan outright —
    // silently skipping them used to hide frontend bugs
    for (const upd of lines) {
      if (!challan.lines.some((l) => l.id === upd.id)) {
        throw new HttpError(400, `Line ${upd.id} does not belong to challan ${challan.number}`);
      }
    }

    // cap each line at what was actually sent: received + rejected (existing +
    // this batch) can never exceed qtySent, otherwise the vendor is inventing
    // material and company stock inflates out of thin air
    for (const upd of lines) {
      const line = challan.lines.find((l) => l.id === upd.id);
      const newReceived = Number(line.qtyReceived) + Number(upd.qtyReceived || 0);
      const newRejected = Number(line.qtyRejected) + Number(upd.qtyRejected || 0);
      if (newReceived + newRejected > Number(line.qtySent)) {
        throw new HttpError(400, `Line ${line.id}: received (${newReceived}) + rejected (${newRejected}) exceeds the qty sent (${Number(line.qtySent)})`);
      }
    }

    let allResolved = true;
    let anyRejected = false;
    const applied = new Map(); // lineId -> { qtyReceived, qtyRejected } after this batch
    for (const upd of lines) {
      const line = challan.lines.find((l) => l.id === upd.id);
      const qtyReceived = Number(upd.qtyReceived || 0);
      const qtyRejected = Number(upd.qtyRejected || 0);
      const newReceived = Number(line.qtyReceived) + qtyReceived;
      const newRejected = Number(line.qtyRejected) + qtyRejected;
      await tx.jobworkLine.update({
        where: { id: line.id },
        data: { qtyReceived: newReceived, qtyRejected: newRejected },
      });
      applied.set(line.id, { qtyReceived: newReceived, qtyRejected: newRejected });

      if (qtyReceived > 0) {
        if (isCustomerOwned) {
          await stockService.moveCustomerMaterial({
            tx, lotId: challan.customerMaterialLotId, date: new Date(),
            refType: 'JOBWORK_IN', refId: id, qtyIn: qtyReceived,
          });
        } else {
          // a company-owned line without an item cannot move stock — the old
          // code crashed here with findUnique({ id: null })
          if (!line.itemId) throw new HttpError(400, `Line ${line.id} has no catalog item to receive stock against`);
          await stockService.moveCompanyStock({
            tx, itemId: line.itemId, date: new Date(),
            refType: 'JOBWORK_IN', refId: id, qtyIn: qtyReceived,
            notes: `Jobwork ${challan.number} line ${line.id} received`,
            allowNegative: true, req, auditAction: 'receive', auditEntity: 'JobworkChallan',
          });
        }
      }
      // rejected qty physically comes back to the company too — it left with
      // the challan and must be restored, just flagged as rejected
      if (qtyRejected > 0) {
        anyRejected = true;
        if (!isCustomerOwned) {
          if (!line.itemId) throw new HttpError(400, `Line ${line.id} has no catalog item to receive stock against`);
          await stockService.moveCompanyStock({
            tx, itemId: line.itemId, date: new Date(),
            refType: 'JOBWORK_IN', refId: id, qtyIn: qtyRejected,
            notes: `Jobwork ${challan.number} line ${line.id} rejected by vendor`,
            allowNegative: true, req, auditAction: 'receive', auditEntity: 'JobworkChallan',
          });
        }
      }
    }

    // resolution is judged over ALL challan lines — a payload that only
    // settles some of them must never flip the challan to RECEIVED. Lines
    // touched by this batch use their just-written totals; the rest use the
    // stored values.
    allResolved = challan.lines.every((l) => {
      const a = applied.get(l.id);
      const received = a ? a.qtyReceived : Number(l.qtyReceived);
      const rejected = a ? a.qtyRejected : Number(l.qtyRejected);
      return received + rejected >= Number(l.qtySent);
    });

    const newStatus = allResolved ? (anyRejected ? 'REJECTED' : 'RECEIVED') : 'PARTIAL_RECEIVED';
    const updated = await tx.jobworkChallan.update({
      where: { id },
      data: { status: newStatus, ...(allResolved ? { actualReturnDate: new Date() } : {}) },
      include: INCLUDE,
    });

    if (isCustomerOwned && challan.customerMaterialLotId) {
      await tx.customerMaterialLot.update({
        where: { id: challan.customerMaterialLotId },
        data: { status: allResolved ? 'IN_PROCESS' : 'AT_VENDOR' },
      });
    }
    await audit(req, 'receive', 'JobworkChallan', id, { status: newStatus });
    return updated;
  });
  res.json(jw);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  const jw = await prisma.$transaction(async (tx) => {
    const challan = await tx.jobworkChallan.findUnique({ where: { id }, include: { lines: true } });
    if (!challan) throw new HttpError(404, 'Jobwork challan not found');
    if (['RECEIVED', 'REJECTED', 'CANCELLED'].includes(challan.status)) {
      throw new HttpError(400, `Cannot cancel a challan in ${challan.status} status`);
    }
    const isCustomerOwned = challan.materialOwnerType === 'CUSTOMER';

    // reverse whatever is still outstanding (sent but not yet received/rejected)
    for (const line of challan.lines) {
      const outstanding = Number(line.qtySent) - Number(line.qtyReceived) - Number(line.qtyRejected);
      if (outstanding <= 0) continue;
      if (isCustomerOwned) {
        await stockService.moveCustomerMaterial({
          tx, lotId: challan.customerMaterialLotId, refType: 'JOBWORK_CANCEL', refId: id, qtyIn: outstanding,
        });
      } else {
        // legacy description-only company lines never moved any stock out, so
        // there is nothing to give back (and moveCompanyStock would crash)
        if (!line.itemId) continue;
        await stockService.moveCompanyStock({
          tx, itemId: line.itemId, refType: 'JOBWORK_CANCEL', refId: id, qtyIn: outstanding,
          req, auditAction: 'cancel', auditEntity: 'JobworkChallan',
        });
      }
    }

    if (isCustomerOwned && challan.customerMaterialLotId) {
      await tx.customerMaterialLot.update({ where: { id: challan.customerMaterialLotId }, data: { status: 'IN_PROCESS' } });
    }

    const updated = await tx.jobworkChallan.update({ where: { id }, data: { status: 'CANCELLED' } });
    await audit(req, 'cancel', 'JobworkChallan', id);
    return updated;
  });
  res.json({ ok: true, jobwork: jw });
}

module.exports = { list, get, create, receive, remove };
