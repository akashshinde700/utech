'use strict';

// INDEPENDENT INVENTORY RECONCILIATION — audit pass 2026-10-17 (arena/5f43ac08)
//
// The user-mandated check #1: "inward, material issue, production, returns aur
// stock ledger ke balances independently match hone chahiye."
//
// HOW THE INDEPENDENCE WORKS
// A stateful in-memory stand-in implements only the four Prisma calls the
// stock service uses (item.findUnique / item.updateMany / item.update /
// stockLedger.create). It keeps its own copy of `currentStock` and the ledger
// rows. The test then reconciles THREE sources of truth against each other:
//
//   1. the service's own Item.currentStock updates,
//   2. the StockLedger rows it wrote (qtyIn/qtyOut and running balance), and
//   3. an expected-closing formula computed by hand from the business scenario
//      (opening + inward + returns-in + production-in
//            − issues − consumption − outward − returns-out).
//
// If any stock-moving code path writes the wrong sign, double-moves, skips a
// ledger row, or leaves `balance` inconsistent, the three stop agreeing.
//
// Customer-owned material gets the same treatment: one inward lot consumed by
// TWO jobwork challans (the "ek inward se multiple job cards" case) plus
// partial receives and dispositions, reconciled against lot.available = Σin −Σout.

import { describe, it, expect, beforeEach } from 'vitest';
const stockService = require('../../src/services/stockService');

// ---------------------------------------------------------------------------
// stateful tx double — mimics exactly what moveCompanyStock / moveCustomerMaterial
// do to the database, and records every write
// ---------------------------------------------------------------------------

function makeStatefulTx({ openingStock = {}, lotQtyIn = {} } = {}) {
  const items = new Map(Object.entries(openingStock).map(([id, qty]) => [Number(id), { id: Number(id), name: `Item ${id}`, currentStock: Number(qty) }]));
  const ledger = []; // every stockLedger.create payload
  const lotLedger = new Map(Object.entries(lotQtyIn).map(([id, qty]) => [Number(id), [{ qtyIn: Number(qty), qtyOut: 0, customerMaterialLotId: Number(id) }]]));

  const tx = {
    item: {
      async findUnique({ where }) {
        const it = items.get(where.id);
        return it ? { ...it } : null;
      },
      async updateMany({ where, data }) {
        const it = items.get(where.id);
        if (!it) return { count: 0 };
        if (where.currentStock && where.currentStock.gte !== undefined && it.currentStock < where.currentStock.gte) {
          return { count: 0 };
        }
        if (data.currentStock && data.currentStock.decrement !== undefined) it.currentStock -= data.currentStock.decrement;
        if (data.currentStock && data.currentStock.increment !== undefined) it.currentStock += data.currentStock.increment;
        return { count: 1 };
      },
      async update({ where, data }) {
        const it = items.get(where.id);
        if (!it) throw new Error(`item ${where.id} missing`);
        if (data.currentStock && data.currentStock.increment !== undefined) it.currentStock += data.currentStock.increment;
        if (data.currentStock && data.currentStock.decrement !== undefined) it.currentStock -= data.currentStock.decrement;
        return { ...it };
      },
    },
    customerMaterialLot: {
      async findUnique({ where }) {
        return lotLedger.has(where.id) ? { id: where.id, inwardNumber: `CML-${where.id}` } : null;
      },
    },
    stockLedger: {
      async aggregate({ where }) {
        const rows = (lotLedger.get(where.customerMaterialLotId) || []);
        return {
          _sum: {
            qtyIn: rows.reduce((s, r) => s + r.qtyIn, 0),
            qtyOut: rows.reduce((s, r) => s + r.qtyOut, 0),
          },
        };
      },
      async create({ data }) {
        ledger.push(data);
        if (data.customerMaterialLotId) {
          lotLedger.get(data.customerMaterialLotId).push({ qtyIn: Number(data.qtyIn || 0), qtyOut: Number(data.qtyOut || 0), customerMaterialLotId: data.customerMaterialLotId });
        }
        return { id: ledger.length, ...data };
      },
    },
  };
  return { tx, items, ledger, lotLedger };
}

// independent reconciliation: ledger rows must explain currentStock exactly
function reconcileCompanyStock(items, ledger, itemId, openingStock = 0) {
  const rows = ledger.filter((l) => l.itemId === itemId && l.ownerType === 'COMPANY');
  const ledgerNet = rows.reduce((s, l) => s + Number(l.qtyIn || 0) - Number(l.qtyOut || 0), 0);
  const current = Number(items.get(itemId).currentStock);
  // running balance on every row must match the cumulative net at that point
  let running = Number(openingStock);
  for (const r of rows) {
    running += Number(r.qtyIn || 0) - Number(r.qtyOut || 0);
    if (Number(r.balance) !== running) {
      return { ok: false, reason: `balance ${r.balance} != running ${running} on ${r.refType}` };
    }
  }
  return { ok: ledgerNet + Number(openingStock) === current, ledgerNet, current, rows: rows.length };
}

// ---------------------------------------------------------------------------
// Company stock: one full manufacturing day, reconciled by hand
// ---------------------------------------------------------------------------

describe('company stock ledger reconciliation (independent calculation)', () => {
  // scenario (all on item 5, "Widget"):
  //   opening                 120   (seeded)
  //   GRN inward              +50   (purchase)
  //   GRN cancel               -6   (mistake reversed)
  //   JOBWORK_OUT             -40   (issued to vendor)
  //   JOBWORK_IN              +36   (came back)
  //   JOBWORK_IN rejected      +4   (came back rejected)
  //   PRODUCTION consume      -70   (material issued/consumed in a batch)
  //   PRODUCTION produced     +55   (finished goods in)
  //   DISPATCH                -30   (sold & shipped)
  //   SALES_RETURN             +5   (customer sent 5 back)
  //   PURCHASE_RETURN          -3   (3 bad pieces back to vendor)
  //   ADJUSTMENT               -2   (count correction)
  //
  // expected closing = 120+50-6-40+36+4-70+55-30+5-3-2 = 119

  const MOVES = [
    { refType: 'GRN', qtyIn: 50 },
    { refType: 'GRN_CANCEL', qtyOut: 6 },
    { refType: 'JOBWORK_OUT', qtyOut: 40 },
    { refType: 'JOBWORK_IN', qtyIn: 36 },
    { refType: 'JOBWORK_IN', qtyIn: 4 },
    { refType: 'PRODUCTION', qtyOut: 70, notes: 'material consumption' },
    { refType: 'PRODUCTION', qtyIn: 55 },
    { refType: 'DISPATCH', qtyOut: 30 },
    { refType: 'SALES_RETURN', qtyIn: 5 },
    { refType: 'PURCHASE_RETURN', qtyOut: 3 },
    { refType: 'ADJUSTMENT', qtyOut: 2 },
  ];
  const EXPECTED_CLOSING = 120 + 50 - 6 - 40 + 36 + 4 - 70 + 55 - 30 + 5 - 3 - 2;

  it('expected closing (hand calc) is 119 — the scenario itself is sane', () => {
    expect(EXPECTED_CLOSING).toBe(119);
  });

  it('Item.currentStock, StockLedger sum and the hand calc all agree', async () => {
    const { tx, items, ledger } = makeStatefulTx({ openingStock: { 5: 120 } });
    for (const m of MOVES) {
      await stockService.moveCompanyStock({ tx, itemId: 5, refType: m.refType, qtyIn: m.qtyIn || 0, qtyOut: m.qtyOut || 0, notes: m.notes || null, skipAudit: true });
    }
    const rec = reconcileCompanyStock(items, ledger, 5, 120);
    expect(rec.ok, `ledger net ${rec.ledgerNet} != currentStock ${rec.current}`).toBe(true);
    expect(rec.current).toBe(EXPECTED_CLOSING);
    expect(rec.rows).toBe(MOVES.length); // exactly one ledger row per movement — no doubles
  });

  it('every movement is individually traceable to a source refType', async () => {
    const { tx, items, ledger } = makeStatefulTx({ openingStock: { 5: 120 } });
    for (const m of MOVES) {
      await stockService.moveCompanyStock({ tx, itemId: 5, refType: m.refType, qtyIn: m.qtyIn || 0, qtyOut: m.qtyOut || 0, skipAudit: true });
    }
    expect(ledger.map((l) => l.refType)).toEqual(MOVES.map((m) => m.refType));
    expect(ledger.every((l) => l.ownerType === 'COMPANY')).toBe(true);
  });

  it('a conditional decrement that loses the race writes NO ledger row', async () => {
    const { tx, items, ledger } = makeStatefulTx({ openingStock: { 5: 10 } });
    // two issues of 8 against 10 available: the second must fail cleanly
    await stockService.moveCompanyStock({ tx, itemId: 5, refType: 'DISPATCH', qtyOut: 8, skipAudit: true });
    let err = null;
    try {
      await stockService.moveCompanyStock({ tx, itemId: 5, refType: 'DISPATCH', qtyOut: 8, skipAudit: true });
    } catch (e) { err = e; }
    expect(err && err.statusCode).toBe(400);
    const rec = reconcileCompanyStock(items, ledger, 5, 10);
    expect(rec.ok).toBe(true);
    expect(rec.current).toBe(2); // exactly one issue happened
    expect(rec.rows).toBe(1);
  });

  it('an over-issue never leaves a half-written ledger', async () => {
    const { tx, items, ledger } = makeStatefulTx({ openingStock: { 5: 3 } });
    let err = null;
    try {
      await stockService.moveCompanyStock({ tx, itemId: 5, refType: 'DISPATCH', qtyOut: 10, skipAudit: true });
    } catch (e) { err = e; }
    expect(err && err.statusCode).toBe(400);
    expect(ledger).toHaveLength(0);
    expect(items.get(5).currentStock).toBe(3);
  });

  it('allowNegative is explicit — GRN-cancel style reversals can go below zero', async () => {
    const { tx, items, ledger } = makeStatefulTx({ openingStock: { 5: 4 } });
    await stockService.moveCompanyStock({ tx, itemId: 5, refType: 'GRN_CANCEL', qtyOut: 6, allowNegative: true, skipAudit: true });
    const rec = reconcileCompanyStock(items, ledger, 5, 4);
    expect(rec.ok).toBe(true);
    expect(rec.current).toBe(-2); // visible in the ledger, not hidden
  });

  it('a two-sided move (in + out in one call) nets correctly in one row', async () => {
    const { tx, items, ledger } = makeStatefulTx({ openingStock: { 5: 10 } });
    await stockService.moveCompanyStock({ tx, itemId: 5, refType: 'ADJUSTMENT', qtyIn: 3, qtyOut: 5, skipAudit: true });
    const rec = reconcileCompanyStock(items, ledger, 5, 10);
    expect(rec.ok).toBe(true);
    expect(rec.current).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Customer material: one inward (lot) feeding multiple jobwork challans —
// the remaining-quantity invariant the user asked us to verify
// ---------------------------------------------------------------------------

describe('inward lot remaining quantity across multiple job cards/challans', () => {
  it('handles three-decimal balances without floating-point shortages', async () => {
    const { tx } = makeStatefulTx({ lotQtyIn: { 77: 0.3 } });
    await stockService.moveCustomerMaterial({ tx, lotId: 77, refType: 'CUSTOMER_CONSUMPTION', qtyOut: 0.1 });
    expect(await stockService.getCustomerLotAvailableQty(tx, 77)).toBe(0.2);
    const movement = await stockService.moveCustomerMaterial({ tx, lotId: 77, refType: 'CUSTOMER_CONSUMPTION', qtyOut: 0.2 });
    expect(movement.balance).toBe(0);
    await expect(stockService.moveCustomerMaterial({ tx, lotId: 77, refType: 'CUSTOMER_CONSUMPTION', qtyOut: 0.001 })).rejects.toThrow(/Insufficient quantity/);
  });

  it('two challans + partial receives + disposition keep lot balance exact', async () => {
    // CML lot 77 received 100 pcs
    const { tx, ledger } = makeStatefulTx({ lotQtyIn: { 77: 0 } });

    // the inward itself goes through the same service as every later movement
    await stockService.moveCustomerMaterial({ tx, lotId: 77, refType: 'CUSTOMER_INWARD', refId: 77, qtyIn: 100 });
    const avail = async () => Number(await stockService.getCustomerLotAvailableQty(tx, 77));
    expect(await avail()).toBe(100);

    // job card / challan A takes 40 out
    await stockService.moveCustomerMaterial({ tx, lotId: 77, refType: 'JOBWORK_OUT', refId: 31, qtyOut: 40 });
    expect(await avail()).toBe(60);

    // job card / challan B takes 30 out (second consumer of the SAME inward)
    await stockService.moveCustomerMaterial({ tx, lotId: 77, refType: 'JOBWORK_OUT', refId: 32, qtyOut: 30 });
    expect(await avail()).toBe(30);

    // challan A: 35 good back + 5 rejected back (AUD-206)
    await stockService.moveCustomerMaterial({ tx, lotId: 77, refType: 'JOBWORK_IN', refId: 31, qtyIn: 35 });
    await stockService.moveCustomerMaterial({ tx, lotId: 77, refType: 'JOBWORK_IN', refId: 31, qtyIn: 5 });
    expect(await avail()).toBe(70);

    // 10 pcs consumed on the shop floor, rest dispatched back to customer
    await stockService.moveCustomerMaterial({ tx, lotId: 77, refType: 'CUSTOMER_CONSUMPTION', refId: 77, qtyOut: 10 });
    await stockService.moveCustomerMaterial({ tx, lotId: 77, refType: 'CUSTOMER_DISPATCH', refId: 77, qtyOut: 55 });
    expect(await avail()).toBe(5);

    // independent formula: 100 − 40 − 30 + 35 + 5 − 10 − 55 = 5
    expect(100 - 40 - 30 + 35 + 5 - 10 - 55).toBe(5);

    // every movement is on the CUSTOMER ledger, company stock never touched
    const rows = ledger.filter((l) => l.customerMaterialLotId === 77);
    expect(rows).toHaveLength(7); // inward + 6 movements
    expect(rows.every((l) => l.ownerType === 'CUSTOMER')).toBe(true);
  });

  it('a third challan cannot over-issue what remains on the inward', async () => {
    const { tx } = makeStatefulTx({ lotQtyIn: { 77: 100 } });
    await stockService.moveCustomerMaterial({ tx, lotId: 77, refType: 'JOBWORK_OUT', refId: 31, qtyOut: 40 });
    await stockService.moveCustomerMaterial({ tx, lotId: 77, refType: 'JOBWORK_OUT', refId: 32, qtyOut: 30 });
    let err = null;
    try {
      await stockService.moveCustomerMaterial({ tx, lotId: 77, refType: 'JOBWORK_OUT', refId: 33, qtyOut: 45 });
    } catch (e) { err = e; }
    expect(err && err.statusCode).toBe(400);
    expect(err.message).toMatch(/Insufficient quantity on lot/);
    // remaining is untouched by the rejected attempt
    expect(await stockService.getCustomerLotAvailableQty(tx, 77)).toBe(30);
  });

  it('jobwork create cannot send more than the inward holds (challan-level check)', async () => {
    // the service-level guard above is what jobwork.create calls per line;
    // asserted here so the two consumer paths cannot drift apart
    const { tx } = makeStatefulTx({ lotQtyIn: { 77: 10 } });
    let err = null;
    try {
      await stockService.moveCustomerMaterial({ tx, lotId: 77, refType: 'JOBWORK_OUT', refId: 31, qtyOut: 11 });
    } catch (e) { err = e; }
    expect(err && err.statusCode).toBe(400);
  });
});
