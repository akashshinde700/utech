'use strict';
const HttpError = require('../utils/httpError');
const { audit } = require('../utils/audit');

// Stock columns store three decimal places. Use scaled rounding to avoid binary
// floating-point artifacts in derived balances (e.g. 0.3 - 0.1).
const roundQuantity = (n) => Math.round(Number(n) * 1000) / 1000;

// Stock columns store three decimal places. Reject silent database rounding or
// malformed quantities rather than making the ledger disagree with the action.
function validateMovement(qtyIn, qtyOut) {
  for (const qty of [qtyIn, qtyOut]) {
    if (!Number.isFinite(qty) || qty < 0 || Math.abs(qty * 1000 - Math.round(qty * 1000)) > 1e-7) {
      throw new HttpError(400, 'Stock quantities must be non-negative and have at most three decimal places');
    }
  }
}

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
  const inQty = Number(qtyIn);
  const outQty = Number(qtyOut);
  validateMovement(inQty, outQty);

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
  const balance = roundQuantity(fresh.currentStock);

  const ledger = await tx.stockLedger.create({
    data: {
      itemId, date, refType, refId, qtyIn: inQty, qtyOut: outQty, balance, notes,
      ownerType: 'COMPANY',
    },
  });

  if (!skipAudit && auditAction && auditEntity) {
    await audit(req, auditAction, auditEntity, refId, { itemId, qtyIn, qtyOut, balance }, tx);
  }

  return ledger;
}

// Read-only pre-check used by reversal flows (GRN cancel) that must not drive
// company stock below zero. `moveCompanyStock({ allowNegative: true })` still
// exists — it is the deliberate, audited escape hatch — but a reversal should
// never reach for it by default: the goods may have been consumed or shipped
// since the receipt, and a silent negative balance hides that.
//
// Returns one entry per item that cannot cover the requested quantity:
//   [{ itemId, name, available, needed, short }]
// The caller decides whether to refuse or to proceed with an override; the
// conditional decrement inside moveCompanyStock remains the concurrency guard.
async function findStockShortfalls(tx, requirements) {
  const neededByItem = new Map();
  for (const req of requirements || []) {
    if (!req || req.itemId == null) continue;
    const qty = Number(req.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const key = Number(req.itemId);
    neededByItem.set(key, roundQuantity((neededByItem.get(key) || 0) + qty));
  }
  if (neededByItem.size === 0) return [];

  const items = await tx.item.findMany({
    where: { id: { in: [...neededByItem.keys()] } },
    select: { id: true, name: true, currentStock: true },
  });
  const shortfalls = [];
  for (const item of items) {
    const available = roundQuantity(item.currentStock);
    const needed = neededByItem.get(Number(item.id));
    if (needed === undefined) continue;
    if (available < needed) {
      shortfalls.push({
        itemId: item.id,
        name: item.name,
        available,
        needed,
        short: roundQuantity(needed - available),
      });
    }
  }
  // An item row that does not exist is NOT reported as a shortfall: the
  // subsequent moveCompanyStock throws its own 404 and the transaction rolls
  // back, so inventing a shortfall here would only change the error message.
  return shortfalls;
}

// Human-readable one-liner for a refusal message.
function describeShortfalls(shortfalls) {
  return shortfalls
    .map((s) => `${s.name}: needed ${s.needed}, available ${s.available} (short ${s.short})`)
    .join('; ');
}

// Current on-hand qty for a customer material lot, derived from its ledger
// (not cached — lot volume is far lower than item volume, so an extra SUM per
// mutation is cheap and keeps a single source of truth).
async function getCustomerLotAvailableQty(tx, lotId) {
  const agg = await tx.stockLedger.aggregate({
    where: { customerMaterialLotId: lotId },
    _sum: { qtyIn: true, qtyOut: true },
  });
  return roundQuantity(Number(agg._sum.qtyIn || 0) - Number(agg._sum.qtyOut || 0));
}

// The customer-material analog of moveCompanyStock — never touches
// Item.currentStock, only the lot and its own StockLedger rows.
async function moveCustomerMaterial({
  tx, lotId, date = new Date(), refType, refId = null, qtyIn = 0, qtyOut = 0, notes = null,
}) {
  validateMovement(Number(qtyIn), Number(qtyOut));
  const lot = await tx.customerMaterialLot.findUnique({ where: { id: lotId } });
  if (!lot) throw new HttpError(404, `Customer material lot ${lotId} not found`);

  const available = await getCustomerLotAvailableQty(tx, lotId);
  const balance = roundQuantity(available + Number(qtyIn) - Number(qtyOut));
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

module.exports = {
  moveCompanyStock, moveCustomerMaterial, getCustomerLotAvailableQty, getLowStockItems,
  roundQuantity, findStockShortfalls, describeShortfalls,
};
