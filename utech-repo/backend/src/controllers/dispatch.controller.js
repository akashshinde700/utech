'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const stockService = require('../services/stockService');

const INCLUDE = {
  party: { select: { id: true, name: true } },
  lines: { include: { item: true } },
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
    prisma.dispatchChallan.findMany({ where, skip, take, orderBy: { [sortBy]: sortDir }, include: { party: true } }),
    prisma.dispatchChallan.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const d = await prisma.dispatchChallan.findUnique({ where: { id }, include: INCLUDE });
  if (!d) throw new HttpError(404, 'Dispatch not found');
  res.json(d);
}

async function create(req, res) {
  const { lines, ...rest } = req.body;
  const number = await nextNumber('dispatchChallan', 'dispatch');
  const d = await prisma.$transaction(async (tx) => {
    const created = await tx.dispatchChallan.create({
      data: {
        ...rest,
        date: new Date(rest.date),
        number,
        lines: { create: lines },
      },
      include: INCLUDE,
    });
    for (const l of lines) {
      await stockService.moveCompanyStock({
        tx, itemId: l.itemId, date: new Date(rest.date),
        refType: 'DISPATCH', refId: created.id, qtyOut: l.qty,
        req, auditAction: 'create', auditEntity: 'DispatchChallan',
      });
    }
    return created;
  });
  res.status(201).json(d);
}

async function markStatus(req, res) {
  const id = parseInt(req.params.id, 10);
  const status = req.params.status.toUpperCase();
  const allowed = ['DISPATCHED', 'DELIVERED', 'CANCELLED'];
  if (!allowed.includes(status)) throw new HttpError(400, 'Invalid status');

  const d = await prisma.$transaction(async (tx) => {
    const challan = await tx.dispatchChallan.findUnique({ where: { id }, include: { lines: true } });
    if (!challan) throw new HttpError(404, 'Dispatch not found');
    if (challan.status === 'CANCELLED') {
      throw new HttpError(400, `Cannot change status of a cancelled dispatch`);
    }
    if (status === 'CANCELLED' && challan.status === 'DELIVERED') {
      throw new HttpError(400, 'Cannot cancel a delivered dispatch');
    }

    // cancelling gives the goods back: every line's qty was moved OUT of
    // company stock at creation (a draft reserves stock), so a cancel moves
    // each line back IN — otherwise cancelled dispatches permanently destroy
    // inventory that never left the building
    if (status === 'CANCELLED') {
      for (const line of challan.lines) {
        const qty = Number(line.qty);
        if (qty <= 0) continue;
        await stockService.moveCompanyStock({
          tx, itemId: line.itemId, date: new Date(),
          refType: 'DISPATCH_CANCEL', refId: id, qtyIn: qty,
          notes: `Dispatch ${challan.number} cancelled`, skipAudit: true,
        });
      }
    }

    return tx.dispatchChallan.update({ where: { id }, data: { status }, include: INCLUDE });
  });

  if (status === 'CANCELLED') {
    await audit(req, 'dispatch.cancel', 'DispatchChallan', id, {
      number: d.number, linesRestored: d.lines.length,
    });
  }
  res.json(d);
}

module.exports = { list, get, create, markStatus };
