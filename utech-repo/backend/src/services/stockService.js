'use strict';
const HttpError = require('../utils/httpError');
const { audit } = require('../utils/audit');

// The single place that reads/writes Item.currentStock and writes StockLedger
// rows for company-owned stock. Every company-stock movement in the app must
// go through here — this is what makes "company stock never mixes with
// customer stock" a structural guarantee rather than an app-level check:
// customer material only ever moves through moveCustomerMaterial() below,
// which never touches Item.currentStock.
async function moveCompanyStock({
  tx, itemId, date = new Date(), refType, refId = null, qtyIn = 0, qtyOut = 0,
  notes = null, allowNegative = false, req = null, auditAction = null, auditEntity = null, skipAudit = false,
}) {
  const inQty = Number(qtyIn) || 0;
  const outQty = Number(qtyOut) || 0;

  // The pre-read is only for the 404 / error message — the stock mutation below
  // is a conditional atomic updateMany, so two concurrent moves can never both
  // pass a stale balance check (the old read-modify-write could).
  const item = await tx.item.findUnique({
    where: { id: itemId },
    select: { id: true, name: true, currentStock: true },
  });
  if (!item) throw new HttpError(404, `Item ${itemId} not found`);

  if (outQty > 0) {
    const dec = await tx.item.updateMany({
      // conditional decrement: the row only changes if it still holds enough
      // stock; count === 0 means we lost the race or stock ran out
      where: allowNegative ? { id: itemId } : { id: itemId, currentStock: { gte: outQty } },
      data: { currentStock: { decrement: outQty } },
    });
    if (dec.count === 0 && !allowNegative) {
      throw new HttpError(400, `Insufficient stock for ${item.name} (available ${item.currentStock}, needed ${outQty})`);
    }
  }
  if (inQty > 0) {
    await tx.item.update({ where: { id: itemId }, data: { currentStock: { increment: inQty } } });
  }

  // Authoritative post-move balance — never derived from the stale pre-read.
  const fresh = inQty > 0 || outQty > 0
    ? await tx.item.findUnique({ where: { id: itemId }, select: { currentStock: true } })
    : item;
  const balance = Number(fresh.currentStock);

  const ledger = await tx.stockLedger.create({
    data: {
      itemId, date, refType, refId, qtyIn: inQty, qtyOut: outQty, balance, notes,
      ownerType: 'COMPANY',
    },
  });

  if (!skipAudit && auditAction && auditEntity) {
    await audit(req, auditAction, auditEntity, refId, { itemId, qtyIn, qtyOut, balance });
  }

  return ledger;
}

// Current on-hand qty for a customer material lot, derived from its ledger
// (not cached — lot volume is far lower than item volume, so an extra SUM per
// mutation is cheap and keeps a single source of truth).
async function getCustomerLotAvailableQty(tx, lotId) {
  const agg = await tx.stockLedger.aggregate({
    where: { customerMaterialLotId: lotId },
    _sum: { qtyIn: true, qtyOut: true },
  });
  return Number(agg._sum.qtyIn || 0) - Number(agg._sum.qtyOut || 0);
}

// The customer-material analog of moveCompanyStock — never touches
// Item.currentStock, only the lot and its own StockLedger rows.
async function moveCustomerMaterial({
  tx, lotId, date = new Date(), refType, refId = null, qtyIn = 0, qtyOut = 0, notes = null,
}) {
  const lot = await tx.customerMaterialLot.findUnique({ where: { id: lotId } });
  if (!lot) throw new HttpError(404, `Customer material lot ${lotId} not found`);

  const available = await getCustomerLotAvailableQty(tx, lotId);
  const balance = available + Number(qtyIn) - Number(qtyOut);
  if (balance < 0) {
    throw new HttpError(400, `Insufficient quantity on lot ${lot.inwardNumber} (available ${available}, needed ${qtyOut})`);
  }

  return tx.stockLedger.create({
    data: {
      itemId: lot.itemId || null, date, refType, refId, qtyIn, qtyOut, balance, notes,
      ownerType: 'CUSTOMER', customerMaterialLotId: lotId,
    },
  });
}

// Comparator shared by the Items list "low stock" filter and the dashboard
// widget — Prisma can't compare two columns of the same row in a where-clause,
// so both read the (small) active-item set and filter in JS.
async function getLowStockItems(db, { take } = {}) {
  const rows = await db.item.findMany({
    where: { isActive: true },
    select: { id: true, name: true, code: true, currentStock: true, minStock: true },
  });
  const low = rows.filter((r) => Number(r.currentStock) < Number(r.minStock));
  return take ? low.slice(0, take) : low;
}

module.exports = { moveCompanyStock, moveCustomerMaterial, getCustomerLotAvailableQty, getLowStockItems };
