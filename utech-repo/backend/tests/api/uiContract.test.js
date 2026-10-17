'use strict';

// FRONTEND ↔ BACKEND CONTRACT TESTS
//
// Each payload below is copied from the submit handler of the matching React
// form. If the two sides drift — different key names, a dropped field, a string
// where the API wants a number — the user gets a 500 and a generic toast while
// every other test in the suite stays green. That is exactly how the Sales
// Return form shipped broken (AUD-102): it posted `items`, the controller read
// `lines`.
//
// Keep these in sync with the forms when either side changes.

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
});

const auth = (r) => r.set('Authorization', `Bearer ${token}`);

describe('POST /api/sales-returns — payload exactly as SalesReturnForm sends it', () => {
  const invoice = {
    id: 41,
    number: 'INV-26-00007',
    partyId: 1,
    party: { id: 1, name: 'Acme' },
    lines: [{ id: 100, itemId: 5, description: 'Machining', hsnCode: '8471', qty: 10, rate: 100, gstRate: 18 }],
  };

  // frontend/src/pages/salesReturns/SalesReturnForm.jsx handleSubmit()
  const formPayload = {
    invoiceId: 41,
    date: '2026-03-01',
    reason: 'Damaged in transit',
    notes: '',
    lines: [
      {
        invoiceLineId: 100,
        itemId: 5,
        description: 'Machining',
        hsnCode: '8471',
        qty: 4,
        rate: 100,
        gstRate: 18,
        amount: 400,
        reason: 'Damaged in transit',
      },
    ],
  };

  beforeEach(() => {
    getDb().when('invoice.findUnique', invoice);
    getDb().when('salesReturnLine.aggregate', { _sum: { qty: 0 } });
    getDb().when('salesReturn.create', (args) => ({ id: 51, number: 'SR-26-00001', ...args[0].data }));
  });

  it('is accepted (201) and stores server-computed totals', async () => {
    const res = await auth(request(app).post('/api/sales-returns')).send(formPayload);
    expect(res.status, `Sales Return create failed: ${JSON.stringify(res.body)}`).toBe(201);

    const data = getDb().calls('salesReturn.create')[0][0].data;
    expect(Number(data.subtotal)).toBe(400);
    expect(Number(data.cgst) + Number(data.sgst)).toBe(72); // 400 @18%
    expect(Number(data.total)).toBe(472);
    expect(data.status).toBe('DRAFT');
    expect(data.partyId).toBe(1);
  });

  it('AUD-102 regression: a payload with no `lines` key must 400, never 500', async () => {
    const { lines, ...withoutLines } = formPayload;
    withoutLines.items = lines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.rate, amount: l.amount }));
    const res = await auth(request(app).post('/api/sales-returns')).send(withoutLines);
    expect(res.status, 'the pre-fix code threw "lines is not iterable" and answered 500').toBe(400);
    expect(getDb().calls('salesReturn.create')).toHaveLength(0);
  });

  it('AUD-013 regression: a non-numeric qty must 400, never reach the money fields', async () => {
    const res = await auth(request(app).post('/api/sales-returns')).send({
      ...formPayload,
      lines: [{ ...formPayload.lines[0], qty: 'not-a-number' }],
    });
    expect(res.status).toBe(400);
    expect(getDb().calls('salesReturn.create')).toHaveLength(0);
  });

  it('rejects an empty line list', async () => {
    const res = await auth(request(app).post('/api/sales-returns')).send({ ...formPayload, lines: [] });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/sales-returns/:id — payload exactly as the edit form sends it', () => {
  beforeEach(() => {
    getDb().when('salesReturn.findUnique', { id: 51, status: 'DRAFT', number: 'SR-26-00001' });
    getDb().when('salesReturn.update', (args) => ({ id: 51, ...args[0].data }));
  });

  it('accepts a header-only edit', async () => {
    const res = await auth(request(app).put('/api/sales-returns/51')).send({
      invoiceId: 41, date: '2026-03-02', reason: 'Wrong item', notes: 'n',
    });
    expect(res.status).toBe(200);
    const data = getDb().calls('salesReturn.update')[0][0].data;
    // invoiceId is not in the controller's editable whitelist
    expect(data).not.toHaveProperty('invoiceId');
    expect(data.reason).toBe('Wrong item');
  });

  it('refuses to edit a return that is no longer DRAFT', async () => {
    getDb().when('salesReturn.findUnique', { id: 51, status: 'PROCESSED' });
    const res = await auth(request(app).put('/api/sales-returns/51')).send({ date: '2026-03-02' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/purchase-returns — payload exactly as PurchaseReturnForm sends it', () => {
  const grn = {
    id: 61,
    number: 'GRN-26-00003',
    partyId: 2,
    party: { id: 2, name: 'Supplier Co', gstin: null },
    lines: [{ id: 200, itemId: 7, qty: 20, rate: 50, gstRate: 18, item: { name: 'Steel plate' } }],
  };

  const formPayload = {
    grnId: 61,
    poId: null,
    partyId: 2,
    date: '2026-03-01',
    reason: 'Rejected in QC',
    notes: '',
    creditNoteNo: 'CN-1',
    lines: [
      { grnLineId: 200, itemId: 7, description: 'Steel plate', qty: 5, rate: 50, gstRate: 18, amount: 250, reason: 'Rejected in QC' },
    ],
  };

  beforeEach(() => {
    getDb().when('gRN.findUnique', grn);
    getDb().when('grnLine.findUnique', { id: 200, grnId: 61, qtyAccepted: 20 });
    getDb().when('purchaseReturnLine.aggregate', { _sum: { qty: 0 } });
    getDb().when('purchaseReturn.create', (args) => ({ id: 71, number: 'PR-26-00001', ...args[0].data }));
  });

  it('is accepted (201)', async () => {
    const res = await auth(request(app).post('/api/purchase-returns')).send(formPayload);
    expect(res.status, `Purchase Return create failed: ${JSON.stringify(res.body)}`).toBe(201);
  });

  it('400s when neither grnId nor poId is supplied', async () => {
    const res = await auth(request(app).post('/api/purchase-returns')).send({
      ...formPayload, grnId: null, poId: null,
    });
    expect(res.status).toBe(400);
  });

  it('400s on a non-numeric qty instead of computing NaN totals', async () => {
    const res = await auth(request(app).post('/api/purchase-returns')).send({
      ...formPayload, lines: [{ ...formPayload.lines[0], qty: 'abc' }],
    });
    expect(res.status).toBe(400);
    expect(getDb().calls('purchaseReturn.create')).toHaveLength(0);
  });
});
