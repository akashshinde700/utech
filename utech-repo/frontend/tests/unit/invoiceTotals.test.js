import { describe, it, expect } from 'vitest';
import { calculateInvoiceTotals } from '../../src/lib/invoiceTotals';
import gst from '../../../backend/src/utils/gst';

describe('invoice preview matches server GST math', () => {
  it.each([
    { lines: [{ qty: 0.125, rate: 33.33, gstRate: 5 }], discount: 0, intra: true },
    { lines: [{ qty: 0.125, rate: 33.33, gstRate: 5 }, { qty: 3.333, rate: 55.55, gstRate: 18 }], discount: 1.55, intra: false },
    { lines: [{ qty: 2, rate: 100, gstRate: 0 }], discount: 0, intra: true },
  ])('uses rounded line amounts before tax and discount: %#', ({ lines, discount, intra }) => {
    const server = gst.calcTaxes(lines, intra, discount);
    const rounded = gst.roundInvoiceTotal(server.total);
    const preview = calculateInvoiceTotals(lines, intra, discount);
    expect(preview).toMatchObject({ subtotal: server.subtotal, discount: server.discount, taxable: server.taxable, cgst: server.cgst, sgst: server.sgst, igst: server.igst, ...rounded });
  });
});
