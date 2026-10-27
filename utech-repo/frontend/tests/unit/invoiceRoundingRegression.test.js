import { describe, expect, it } from 'vitest';
import { calculateInvoiceTotals } from '../../src/lib/invoiceTotals';

describe('invoice preview rounding', () => {
  it('rounds a half-paisa per-kg line correctly before GST and total', () => {
    const totals = calculateInvoiceTotals([{ qty: 0.5, rate: 20.15, gstRate: 0 }], true, 0);
    expect(totals.subtotal).toBe(10.08);
    expect(totals.roundOff).toBe(-0.08);
    expect(totals.total).toBe(10);
  });
});
