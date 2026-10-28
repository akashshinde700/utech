'use strict';

/**
 * DATA-INTEGRITY RECONCILIATION
 *
 * Three numbers in this database are caches of a sum that lives somewhere else:
 *
 *   Item.currentStock        = Σ COMPANY StockLedger (qtyIn − qtyOut)
 *   Invoice.amountPaid       = Σ InvoicePayment.amount
 *   CustomerMaterialLot      = Σ its own StockLedger rows
 *
 * Every write path goes through one service and keeps them in step, which is
 * exactly why a drift would be invisible: nothing ever re-derives the cached
 * figure and compares. A bad import, an interrupted migration or a manual SQL
 * fix leaves the ERP quietly reporting a stock figure its own ledger does not
 * support, and the first person to notice is whoever counts the rack.
 *
 * On top of that, several columns hold another table's id without a foreign
 * key behind them (`SalesReturnLine.invoiceLineId`, `Jobcard.itemId`,
 * `Project.partyId`, …). The database cannot refuse an orphan in those
 * columns, so they are checked here instead.
 *
 * These functions are deliberately pure — they take rows and return findings,
 * so they are testable without a database. `prisma/checkIntegrity.js` is the
 * thin CLI that fetches the rows and prints the result.
 */

// Money and quantity are DECIMAL in the database and arrive as strings or
// Prisma Decimals. Compare at the stored scale, not in binary floating point:
// 0.1 + 0.2 must not be reported as a drift.
const scaled = (n, places) => Math.round(Number(n || 0) * 10 ** places) / 10 ** places;
const qty = (n) => scaled(n, 3);
const money = (n) => scaled(n, 2);

/**
 * Item.currentStock against the company stock ledger.
 * Customer-owned material never touches Item.currentStock, so CUSTOMER rows
 * are excluded — including them would report every lot as a drift.
 */
function reconcileStock({ items = [], ledger = [] } = {}) {
  const sums = new Map();
  for (const row of ledger) {
    if ((row.ownerType || 'COMPANY') !== 'COMPANY') continue;
    if (row.itemId == null) continue;
    const key = Number(row.itemId);
    sums.set(key, qty((sums.get(key) || 0) + Number(row.qtyIn || 0) - Number(row.qtyOut || 0)));
  }
  const findings = [];
  for (const item of items) {
    const stored = qty(item.currentStock);
    const derived = sums.get(Number(item.id)) || 0;
    if (stored !== derived) {
      findings.push({
        itemId: item.id,
        code: item.code,
        name: item.name,
        stored,
        derived,
        diff: qty(stored - derived),
      });
    }
  }
  return findings;
}

/** Invoice.amountPaid against the payments actually recorded against it. */
function reconcileInvoicePayments({ invoices = [], payments = [] } = {}) {
  const sums = new Map();
  for (const p of payments) {
    const key = Number(p.invoiceId);
    sums.set(key, money((sums.get(key) || 0) + Number(p.amount || 0)));
  }
  const findings = [];
  for (const inv of invoices) {
    const stored = money(inv.amountPaid);
    const derived = sums.get(Number(inv.id)) || 0;
    if (stored !== derived) {
      findings.push({
        invoiceId: inv.id,
        number: inv.number,
        stored,
        derived,
        diff: money(stored - derived),
      });
    }
  }
  return findings;
}

/**
 * An invoice may never be marked PAID for less than its total, nor hold a
 * payment larger than it (`invoice.controller.js` refuses the overpayment at
 * write time; this catches rows that predate that guard or were written by
 * hand).
 */
function checkInvoiceStatus({ invoices = [] } = {}) {
  const findings = [];
  for (const inv of invoices) {
    const total = money(inv.total);
    const paid = money(inv.amountPaid);
    if (paid > total) {
      findings.push({ invoiceId: inv.id, number: inv.number, issue: 'paid more than total', total, paid });
    } else if (inv.status === 'PAID' && paid < total) {
      findings.push({ invoiceId: inv.id, number: inv.number, issue: 'marked PAID but not fully paid', total, paid });
    } else if (inv.status === 'PARTIALLY_PAID' && paid <= 0) {
      findings.push({ invoiceId: inv.id, number: inv.number, issue: 'marked PARTIALLY_PAID with no payment', total, paid });
    }
  }
  return findings;
}

/**
 * Rows whose id column points at something that is not there.
 * `references` is a list of { label, rows, column, validIds } — the caller
 * decides which logical foreign keys to check, since each one costs a query.
 */
function findOrphans(references = []) {
  const findings = [];
  for (const ref of references) {
    const valid = ref.validIds instanceof Set ? ref.validIds : new Set(ref.validIds || []);
    for (const row of ref.rows || []) {
      const value = row[ref.column];
      if (value == null) continue; // a null reference is "not set", not an orphan
      if (!valid.has(Number(value))) {
        findings.push({ reference: ref.label, rowId: row.id, column: ref.column, value: Number(value) });
      }
    }
  }
  return findings;
}

/** A customer material lot's on-hand quantity against its own ledger rows. */
function reconcileCustomerLots({ lots = [], ledger = [] } = {}) {
  const sums = new Map();
  for (const row of ledger) {
    if (row.customerMaterialLotId == null) continue;
    const key = Number(row.customerMaterialLotId);
    sums.set(key, qty((sums.get(key) || 0) + Number(row.qtyIn || 0) - Number(row.qtyOut || 0)));
  }
  const findings = [];
  for (const lot of lots) {
    const derived = sums.get(Number(lot.id)) || 0;
    if (derived < 0) {
      findings.push({ lotId: lot.id, inwardNumber: lot.inwardNumber, derived, issue: 'ledger sums below zero' });
    }
  }
  return findings;
}

/**
 * Collect the findings into one report. `ok` is what a scheduled job or a
 * deployment check should look at.
 */
function buildReport(sections) {
  const checks = sections.map((s) => ({
    id: s.id,
    label: s.label,
    count: s.findings.length,
    status: s.findings.length === 0 ? 'OK' : 'DRIFT',
    findings: s.findings,
  }));
  return { ok: checks.every((c) => c.status === 'OK'), checks };
}

module.exports = {
  reconcileStock,
  reconcileInvoicePayments,
  checkInvoiceStatus,
  findOrphans,
  reconcileCustomerLots,
  buildReport,
};
