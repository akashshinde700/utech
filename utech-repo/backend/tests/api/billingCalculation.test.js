'use strict';

// BILLING CALCULATION VERIFICATION — audit pass 2026-10-17 (arena/5f43ac08)
//
// User-mandated check #3: "quantity, weight, rate, lot charge, tax aur invoice
// totals sahi hone chahiye."
//
// This ERP models all three charge bases as ordinary invoice lines:
//   per-piece  : qty = number of pieces,  rate = price per piece
//   per-kg     : qty = weight in kg,      rate = price per kg
//   lot charge : qty = 1,                 rate = flat rate for the lot
// so "aggregation" is the line-sum + GST engine in utils/gst.js. These tests
// drive the REAL create endpoint with a mixed three-line invoice and reconcile
// every money column by hand — the same numbers the InvoiceForm preview shows
// (frontend/src/pages/invoices/InvoiceForm.jsx totals memo mirrors gst.js).

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { getDb, makeUser, signInAs, loadApp } from '../helpers/app';

let app;
let token;

beforeAll(async () => {
  app = await loadApp();
});

beforeEach(() => {
  getDb().reset();
  token = signInAs(makeUser({ id: 1, role: 'SUPERADMIN' }));
  getDb().when('party.findUnique', { id: 1, name: 'Acme', gstin: '27AAAAA0000A1Z5' });
  getDb().when('invoice.create', (args) => ({ id: 11, number: 'INV-26-00001', ...args[0].data }));
  getDb().when('invoice.update', (args) => ({ id: 11, ...args[0].data }));
  getDb().when('invoice.findUnique', {
    id: 11, number: 'INV-26-00001', status: 'ISSUED', partyId: 1, amountPaid: 0, total: 0,
    igst: 0, discount: 0,
    lines: [
      { id: 1, qty: 12, rate: 45.5, gstRate: 18 },
      { id: 2, qty: 36.75, rate: 120, gstRate: 18 },
      { id: 3, qty: 1, rate: 2500, gstRate: 18 },
    ],
  });
});

const auth = (r) => r.set('Authorization', `Bearer ${token}`);

// hand calculation for the mixed invoice used throughout:
//   line 1  12 pcs × ₹45.50        = ₹546.00
//   line 2  36.75 kg × ₹120.00     = ₹4,410.00   (weight-based)
//   line 3  1 lot × ₹2,500.00      = ₹2,500.00   (lot charge)
//   subtotal                        ₹7,456.00
//   GST @18% (intra: CGST+SGST)    ₹1,342.08   (983.88 + 358.20 → 671.04 each)
//   exact total                     ₹8,798.08
//   rounded to the nearest rupee    ₹8,798      (roundOff −0.08)
const MIXED = [
  { description: 'Machined brackets', hsnCode: '8466', qty: 12, rate: 45.5, gstRate: 18 },
  { description: 'Fabrication by weight', hsnCode: '7326', qty: 36.75, rate: 120, gstRate: 18 },
  { description: 'Setup / lot charge', hsnCode: '9987', qty: 1, rate: 2500, gstRate: 18 },
];

describe('invoice totals — pieces, weight and lot charge in one document', () => {
  it('aggregates all three charge bases and computes GST on the sum', async () => {
    const res = await auth(request(app).post('/api/invoices')).send({
      date: '2026-04-01', partyId: 1, isIntraState: true, lines: MIXED,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const d = getDb().calls('invoice.create')[0][0].data;

    expect(Number(d.subtotal)).toBe(7456); // 546 + 4410 + 2500
    expect(Number(d.cgst)).toBe(671.04); // 7456 × 18% ÷ 2
    expect(Number(d.sgst)).toBe(671.04);
    expect(Number(d.igst)).toBe(0);
    expect(Number(d.total)).toBe(8798); // 8798.08 rounded
    expect(Number(d.roundOff)).toBe(-0.08);
    // each stored line amount is qty × rate rounded to paise
    const lines = d.lines.create.map((l) => Number(l.amount));
    expect(lines).toEqual([546, 4410, 2500]);
  });

  it('inter-state (IGST) split is the same money, different columns', async () => {
    const res = await auth(request(app).post('/api/invoices')).send({
      date: '2026-04-01', partyId: 1, isIntraState: false, lines: MIXED,
    });
    expect(res.status).toBe(201);
    const d = getDb().calls('invoice.create')[0][0].data;
    expect(Number(d.igst)).toBe(1342.08);
    expect(Number(d.cgst) + Number(d.sgst)).toBe(0);
    expect(Number(d.total)).toBe(8798);
  });

  it('fractional weights and decimal rates keep paise precision', async () => {
    const res = await auth(request(app).post('/api/invoices')).send({
      date: '2026-04-01', partyId: 1, isIntraState: true,
      lines: [{ description: 'w', qty: 0.125, rate: 33.33, gstRate: 5 }],
    });
    expect(res.status).toBe(201);
    const d = getDb().calls('invoice.create')[0][0].data;
    // 0.125 × 33.33 = 4.16625 → line amount 4.17 (paise rounding at the line)
    expect(Number(d.lines.create[0].amount)).toBe(4.17);
    // GST is charged on the rounded line sum, not the raw product
    expect(Number(d.subtotal)).toBe(4.17);
    expect(Number(d.cgst) + Number(d.sgst)).toBeCloseTo(0.21, 2); // 4.17×5% = 0.2085 → 0.21
  });

  it('a lot-charge line is just qty 1 × rate — and can be zero-rated', async () => {
    const res = await auth(request(app).post('/api/invoices')).send({
      date: '2026-04-01', partyId: 1, isIntraState: true,
      lines: [{ description: 'Lot charge', qty: 1, rate: 0, gstRate: 0 }],
    });
    expect(res.status).toBe(201);
    const d = getDb().calls('invoice.create')[0][0].data;
    expect(Number(d.total)).toBe(0);
    expect(Number(d.roundOff)).toBe(0);
  });

  it('editing the same three lines reproduces identical totals (update = create)', async () => {
    const res = await auth(request(app).put('/api/invoices/11')).send({
      date: '2026-04-02', partyId: 1, isIntraState: true, lines: MIXED,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const d = getDb().calls('invoice.update')[0][0].data;
    expect(Number(d.subtotal)).toBe(7456);
    expect(Number(d.cgst)).toBe(671.04);
    expect(Number(d.sgst)).toBe(671.04);
    expect(Number(d.total)).toBe(8798);
    expect(Number(d.roundOff)).toBe(-0.08);
  });

  it('client-supplied totals are ignored — the server recomputes everything', async () => {
    const res = await auth(request(app).post('/api/invoices')).send({
      date: '2026-04-01', partyId: 1, isIntraState: true,
      total: 1, subtotal: 1, cgst: 0, sgst: 0,
      lines: [{ description: 'x', qty: 10, rate: 100, gstRate: 18 }],
    });
    expect(res.status).toBe(201);
    const d = getDb().calls('invoice.create')[0][0].data;
    expect(Number(d.subtotal)).toBe(1000);
    expect(Number(d.cgst) + Number(d.sgst)).toBe(180);
    expect(Number(d.total)).toBe(1180);
    expect(Number(d.total)).not.toBe(1);
  });
});
