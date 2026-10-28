import { describe, it, expect } from 'vitest';
const {
  reconcileStock,
  reconcileInvoicePayments,
  checkInvoiceStatus,
  findOrphans,
  reconcileCustomerLots,
  buildReport,
} = require('../../src/services/integrityCheck');

// Three totals in this database are caches of a sum stored elsewhere, and
// every write path keeps them in step — which is exactly why a drift would go
// unnoticed. These are the checks that re-derive them.

const item = (id, code, currentStock) => ({ id, code, name: `Item ${code}`, currentStock });
const move = (itemId, qtyIn, qtyOut, extra = {}) => ({ itemId, qtyIn, qtyOut, ownerType: 'COMPANY', ...extra });

describe('Item.currentStock vs the company stock ledger', () => {
  it('passes when the cache equals the ledger sum', () => {
    const findings = reconcileStock({
      items: [item(1, 'IT-0001', 95)],
      ledger: [move(1, 100, 0), move(1, 0, 5)],
    });
    expect(findings).toEqual([]);
  });

  it('reports the item, both figures and the difference', () => {
    const findings = reconcileStock({
      items: [item(1, 'IT-0001', 100), item(2, 'IT-0002', 7)],
      ledger: [move(1, 95, 0), move(2, 7, 0)],
    });
    expect(findings).toEqual([
      { itemId: 1, code: 'IT-0001', name: 'Item IT-0001', stored: 100, derived: 95, diff: 5 },
    ]);
  });

  it('catches an item carrying stock with no ledger history at all', () => {
    // an opening balance written without its OPENING row, or a hand-edited row
    const findings = reconcileStock({ items: [item(9, 'IT-0009', 40)], ledger: [] });
    expect(findings[0]).toMatchObject({ itemId: 9, stored: 40, derived: 0, diff: 40 });
  });

  it('ignores customer-owned material, which never touches Item.currentStock', () => {
    const findings = reconcileStock({
      items: [item(1, 'IT-0001', 10)],
      ledger: [move(1, 10, 0), { itemId: 1, qtyIn: 500, qtyOut: 0, ownerType: 'CUSTOMER', customerMaterialLotId: 3 }],
    });
    expect(findings).toEqual([]);
  });

  it('ignores ledger rows whose item was detached (itemId null)', () => {
    const findings = reconcileStock({
      items: [item(1, 'IT-0001', 10)],
      ledger: [move(1, 10, 0), move(null, 7, 0)],
    });
    expect(findings).toEqual([]);
  });

  it('compares at the stored scale, not in binary floating point', () => {
    // 0.1 + 0.2 === 0.30000000000000004 — a drift report here would be noise
    const findings = reconcileStock({
      items: [item(1, 'IT-0001', 0.3)],
      ledger: [move(1, 0.1, 0), move(1, 0.2, 0)],
    });
    expect(findings).toEqual([]);
  });

  it('still reports a drift smaller than a whole unit', () => {
    const findings = reconcileStock({
      items: [item(1, 'IT-0001', 0.305)],
      ledger: [move(1, 0.3, 0)],
    });
    expect(findings[0].diff).toBe(0.005);
  });
});

describe('Invoice.amountPaid vs the payments recorded against it', () => {
  const inv = (id, number, total, amountPaid, status) => ({ id, number, total, amountPaid, status });

  it('passes when they agree', () => {
    expect(reconcileInvoicePayments({
      invoices: [inv(1, 'INV-1', 12390, 12390, 'PAID')],
      payments: [{ invoiceId: 1, amount: 10000 }, { invoiceId: 1, amount: 2390 }],
    })).toEqual([]);
  });

  it('reports a cached figure no payment supports', () => {
    const findings = reconcileInvoicePayments({
      invoices: [inv(1, 'INV-1', 12390, 12390, 'PAID')],
      payments: [{ invoiceId: 1, amount: 10000 }],
    });
    expect(findings).toEqual([
      { invoiceId: 1, number: 'INV-1', stored: 12390, derived: 10000, diff: 2390 },
    ]);
  });

  it('flags an invoice marked PAID that is not fully paid', () => {
    expect(checkInvoiceStatus({ invoices: [inv(1, 'INV-1', 12390, 5000, 'PAID')] }))
      .toEqual([{ invoiceId: 1, number: 'INV-1', issue: 'marked PAID but not fully paid', total: 12390, paid: 5000 }]);
  });

  it('flags an overpayment', () => {
    expect(checkInvoiceStatus({ invoices: [inv(1, 'INV-1', 100, 150, 'PAID')] })[0].issue)
      .toBe('paid more than total');
  });

  it('flags PARTIALLY_PAID with nothing paid', () => {
    expect(checkInvoiceStatus({ invoices: [inv(1, 'INV-1', 100, 0, 'PARTIALLY_PAID')] })[0].issue)
      .toBe('marked PARTIALLY_PAID with no payment');
  });

  it('leaves an unpaid draft alone', () => {
    expect(checkInvoiceStatus({ invoices: [inv(1, 'INV-1', 100, 0, 'DRAFT')] })).toEqual([]);
  });
});

describe('logical foreign keys — id columns with no constraint behind them', () => {
  it('reports a reference to a row that is not there', () => {
    const findings = findOrphans([{
      label: 'SalesReturnLine.invoiceLineId -> InvoiceLine',
      rows: [{ id: 1, invoiceLineId: 10 }, { id: 2, invoiceLineId: 888888 }],
      column: 'invoiceLineId',
      validIds: [10, 11],
    }]);
    expect(findings).toEqual([
      { reference: 'SalesReturnLine.invoiceLineId -> InvoiceLine', rowId: 2, column: 'invoiceLineId', value: 888888 },
    ]);
  });

  it('treats a null reference as "not set", not as an orphan', () => {
    const findings = findOrphans([{
      label: 'Jobcard.itemId -> Item', rows: [{ id: 1, itemId: null }], column: 'itemId', validIds: [5],
    }]);
    expect(findings).toEqual([]);
  });
});

describe('customer material lots', () => {
  it('reports a lot whose own ledger sums below zero', () => {
    const findings = reconcileCustomerLots({
      lots: [{ id: 3, inwardNumber: 'CMI-3' }],
      ledger: [
        { customerMaterialLotId: 3, qtyIn: 10, qtyOut: 0 },
        { customerMaterialLotId: 3, qtyIn: 0, qtyOut: 25 },
      ],
    });
    expect(findings[0]).toMatchObject({ lotId: 3, inwardNumber: 'CMI-3', derived: -15 });
  });
});

describe('the report a deployment gate reads', () => {
  it('is ok only when every check is clean', () => {
    expect(buildReport([{ id: 'a', label: 'A', findings: [] }]).ok).toBe(true);
    const bad = buildReport([
      { id: 'a', label: 'A', findings: [] },
      { id: 'b', label: 'B', findings: [{ itemId: 1 }] },
    ]);
    expect(bad.ok).toBe(false);
    expect(bad.checks.map((c) => c.status)).toEqual(['OK', 'DRIFT']);
    expect(bad.checks[1].count).toBe(1);
  });
});
