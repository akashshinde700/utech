'use strict';

// Unit tests for the money math. These numbers appear on customer-facing tax
// documents, so they are the highest-value pure logic in the backend.

import { describe, it, expect } from 'vitest';
const { calcLineAmount, calcTaxes, round2, roundInvoiceTotal, stateCodeOf } = require('../../src/utils/gst');
const { amountInWordsINR } = require('../../src/utils/numberToWords');
const { deriveFromGstin, GSTIN_RE } = require('../../src/utils/gstin');

describe('gst.calcLineAmount', () => {
  it('multiplies qty by rate and rounds to 2dp', () => {
    expect(calcLineAmount(3, 100.5)).toBe(301.5);
    expect(calcLineAmount(1.005, 100)).toBe(100.5);
  });

  // BUG AUD-014 (P2): calcLineAmount has no numeric guard — a non-numeric qty
  // or rate becomes NaN and propagates into subtotal/tax/total. The invoice and
  // quotation routes are protected by zod (qty: positive number), but
  // /api/sales-returns and /api/purchase-returns have NO schema, so a client can
  // reach this with qty="abc". Asserted as-is so the fix has a regression net.
  it('AUD-014: propagates NaN for non-numeric input (no numeric guard)', () => {
    expect(Number.isNaN(calcLineAmount(undefined, 100))).toBe(true);
    expect(Number.isNaN(calcLineAmount('abc', 100))).toBe(true);
  });
});

describe('gst.calcTaxes — intra-state (CGST + SGST)', () => {
  it('splits GST evenly and keeps the odd paisa on SGST', () => {
    // 1000 @ 18% = 180 -> 90 / 90
    const t = calcTaxes([{ qty: 10, rate: 100, gstRate: 18 }], true);
    expect(t.subtotal).toBe(1000);
    expect(t.cgst).toBe(90);
    expect(t.sgst).toBe(90);
    expect(t.igst).toBe(0);
    expect(t.tax).toBe(180);
    expect(t.total).toBe(1180);
  });

  it('never loses a paisa when the split is odd', () => {
    // 999 @ 18% = 179.82 -> 89.91 / 89.91 (even) ; 333 @ 18% = 59.94
    const odd = calcTaxes([{ qty: 1, rate: 333, gstRate: 18 }], true);
    expect(round2(odd.cgst + odd.sgst)).toBe(odd.tax);
    expect(odd.tax).toBe(59.94);
  });

  it('reduces the taxable value by the discount before taxing, not after', () => {
    // 1000 taxable, 100 discount -> GST on 900 = 162, total 1062
    const t = calcTaxes([{ qty: 10, rate: 100, gstRate: 18 }], true, 100);
    expect(t.subtotal).toBe(1000);
    expect(t.discount).toBe(100);
    expect(t.taxable).toBe(900);
    expect(t.tax).toBe(162);
    expect(t.total).toBe(1062);
  });

  it('spreads the discount across lines in proportion to their value', () => {
    const t = calcTaxes(
      [
        { qty: 1, rate: 300, gstRate: 18 },
        { qty: 1, rate: 700, gstRate: 5 },
      ],
      true,
      100,
    );
    // 300*0.9=270 @18% = 48.60 ; 700*0.9=630 @5% = 31.50 ; total tax 80.10
    expect(t.taxable).toBe(900);
    expect(t.tax).toBe(80.1);
    expect(t.total).toBe(980.1);
  });

  it('caps a discount at the subtotal so the taxable value can never go negative', () => {
    const t = calcTaxes([{ qty: 1, rate: 100, gstRate: 18 }], true, 5000);
    expect(t.discount).toBe(100);
    expect(t.taxable).toBe(0);
    expect(t.tax).toBe(0);
    expect(t.total).toBe(0);
  });
});

describe('gst.calcTaxes — inter-state (IGST)', () => {
  it('charges the whole GST as IGST and no CGST/SGST', () => {
    const t = calcTaxes([{ qty: 2, rate: 500, gstRate: 28 }], false);
    expect(t.igst).toBe(280);
    expect(t.cgst).toBe(0);
    expect(t.sgst).toBe(0);
    expect(t.total).toBe(1280);
  });
});

describe('gst.calcTaxes — mixed-rate invoices', () => {
  it('sums tax across different GST rates on the same document', () => {
    const t = calcTaxes(
      [
        { qty: 1, rate: 1000, gstRate: 18 },
        { qty: 1, rate: 1000, gstRate: 12 },
        { qty: 1, rate: 1000, gstRate: 5 },
        { qty: 1, rate: 1000, gstRate: 0 },
      ],
      true,
    );
    expect(t.subtotal).toBe(4000);
    expect(t.tax).toBe(350); // 180 + 120 + 50 + 0
    expect(t.cgst).toBe(175);
    expect(t.sgst).toBe(175);
    expect(t.total).toBe(4350);
  });
});

describe('gst.roundInvoiceTotal', () => {
  it('rounds to the nearest rupee and reports the round-off within ±0.5', () => {
    expect(roundInvoiceTotal(1180.49)).toEqual({ total: 1180, roundOff: -0.49 });
    expect(roundInvoiceTotal(1180.5)).toEqual({ total: 1181, roundOff: 0.5 });
    expect(roundInvoiceTotal(1180.51)).toEqual({ total: 1181, roundOff: 0.49 });
  });

  it('keeps |roundOff| <= 0.5 for every paisa value', () => {
    for (let p = 0; p < 100; p += 1) {
      const { total, roundOff } = roundInvoiceTotal(1000 + p / 100);
      expect(Math.abs(roundOff)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(total - (1000 + p / 100))).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('gst.stateCodeOf', () => {
  it('reads the two-digit state code from a GSTIN', () => {
    expect(stateCodeOf('27AAPFU0939F1ZV')).toBe('27');
    expect(stateCodeOf('09ABCDE1234F1Z5')).toBe('09');
  });
  it('returns null for junk', () => {
    expect(stateCodeOf('')).toBeNull();
    expect(stateCodeOf(null)).toBeNull();
    expect(stateCodeOf('XXAAPFU0939F1ZV')).toBeNull();
  });
});

describe('numberToWords — amount in words (printed on quotations and invoices)', () => {
  it('renders zero', () => {
    expect(amountInWordsINR(0)).toBe('Zero Rupees Only');
  });

  it('renders plain rupees', () => {
    expect(amountInWordsINR(1)).toBe('One Rupees Only');
    expect(amountInWordsINR(1000)).toBe('One Thousand Rupees Only');
    expect(amountInWordsINR(100000)).toBe('One Lakh Rupees Only');
    expect(amountInWordsINR(10000000)).toBe('One Crore Rupees Only');
  });

  it('uses the Indian grouping, not the international one', () => {
    // 1,23,45,678 in the Indian system
    expect(amountInWordsINR(12345678)).toBe('One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees Only');
  });

  it('renders paise without ever producing "100 Paise"', () => {
    expect(amountInWordsINR(0.5)).toBe('Zero Rupees and Fifty Paise Only');
    expect(amountInWordsINR(10.995)).toBe('Eleven Rupees Only');
    expect(amountInWordsINR(1.01)).toBe('One Rupees and One Paise Only');
  });

  it('renders negative amounts with a Minus prefix, never "undefined"', () => {
    const words = amountInWordsINR(-1500);
    expect(words).toBe('Minus One Thousand Five Hundred Rupees Only');
    expect(words).not.toMatch(/undefined/);
  });

  it('falls back to zero words for non-numeric input', () => {
    expect(amountInWordsINR('abc')).toBe('Zero Rupees Only');
    expect(amountInWordsINR(null)).toBe('Zero Rupees Only');
  });

  it('never emits "undefined" for any amount in a wide sweep', () => {
    for (let i = 0; i < 2000; i += 1) {
      const words = amountInWordsINR(i * 7.77 - 5000);
      expect(words, `amount ${i * 7.77 - 5000}`).not.toMatch(/undefined|NaN/);
    }
  });
});

describe('gstin.deriveFromGstin', () => {
  it('derives state and PAN from a valid GSTIN', () => {
    const d = deriveFromGstin('27AAPFU0939F1ZV');
    expect(d.stateCode).toBe('27');
    expect(d.state).toBe('Maharashtra');
    expect(d.pan).toBe('AAPFU0939F');
  });

  it('accepts lowercase and surrounding whitespace', () => {
    expect(deriveFromGstin('  27aapfu0939f1zv ').pan).toBe('AAPFU0939F');
  });

  it('returns an empty object for malformed GSTINs', () => {
    expect(deriveFromGstin('27AAPFU0939F1Z')).toEqual({});
    expect(deriveFromGstin('')).toEqual({});
    expect(deriveFromGstin('27AAPFU0939F1ZVX')).toEqual({});
  });

  it('exposes the same regex the API validators use', () => {
    expect(GSTIN_RE.test('27AAPFU0939F1ZV')).toBe(true);
    // layout: <2 state><5 PAN-alpha><4 digits><1 alpha><1 alnum>Z<1 alnum>
    expect(GSTIN_RE.test('27AAPFU0939F1Z5')).toBe(true);
    expect(GSTIN_RE.test('27AAPFU0939F1Y5')).toBe(false); // 13th char must be Z
    expect(GSTIN_RE.test('27AAPFU0939F1Z')).toBe(false);  // too short
  });
});
