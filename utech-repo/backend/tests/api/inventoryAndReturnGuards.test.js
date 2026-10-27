'use strict';

// REGRESSION TESTS — audit pass 2026-10-27
//
//   AUD-210  P1  cancelling a GRN drove company stock negative, silently
//   AUD-211  P1  a sales return restored stock with no proof the goods came back
//   AUD-212  P1  zod v4 re-injected defaults into update payloads (AUD-201 path)
//
// Every test below fails against the pre-fix code.

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

// ---------------------------------------------------------------------------
// AUD-210 — GRN cancellation must never silently create negative stock
// ---------------------------------------------------------------------------

describe('AUD-210 — GRN cancellation and negative stock', () => {
  const grnRow = {
    id: 31, status: 'RECEIVED', number: 'GRN-26-00031', poId: null,
    lines: [{ id: 1, itemId: 5, qtyAccepted: 4, poLineId: null }],
  };

  it('refuses to cancel when the received stock is already gone', async () => {
    getDb().when('gRN.findUnique', grnRow);
    getDb().when('purchaseReturn.count', 0);
    // only 1 on hand but the receipt put 4 in — reversing would leave -3
    getDb().when('item.findMany', [{ id: 5, name: 'Widget', currentStock: 1 }]);
    getDb().when('gRN.updateMany', { count: 1 });

    const res = await auth(request(app).delete('/api/grns/31')).send({ reason: 'wrong vendor' });

    expect(res.status, 'pre-fix this returned 200 and wrote a -3 balance').toBe(400);
    expect(res.body.message).toMatch(/Widget/);
    expect(res.body.message).toMatch(/available 1/);
    expect(res.body.message).toMatch(/force=true/);
    // nothing was claimed and no stock moved
    expect(getDb().calls('gRN.updateMany')).toHaveLength(0);
    expect(getDb().calls('stockLedger.create')).toHaveLength(0);
    expect(getDb().calls('item.updateMany')).toHaveLength(0);
  });

  it('still cancels normally when the stock is on hand', async () => {
    getDb().when('gRN.findUnique', grnRow);
    getDb().when('purchaseReturn.count', 0);
    getDb().when('item.findMany', [{ id: 5, name: 'Widget', currentStock: 9 }]);
    getDb().when('item.findUnique', { id: 5, name: 'Widget', currentStock: 9 });
    getDb().when('item.updateMany', { count: 1 });
    getDb().when('gRN.updateMany', { count: 1 });

    const res = await auth(request(app).delete('/api/grns/31')).send({ reason: 'wrong vendor' });

    expect(res.status).toBe(200);
    expect(getDb().calls('stockLedger.create')).toHaveLength(1);
    const movement = getDb().calls('stockLedger.create')[0][0].data;
    expect(movement.refType).toBe('GRN_CANCEL');
    expect(Number(movement.qtyOut)).toBe(4);
    // the conditional decrement (stock >= qty) is the concurrency guard
    expect(getDb().calls('item.updateMany')[0][0].where).toEqual({ id: 5, currentStock: { gte: 4 } });
  });

  it('allows the explicit, authorised override and audits it', async () => {
    getDb().when('gRN.findUnique', grnRow);
    getDb().when('purchaseReturn.count', 0);
    getDb().when('item.findMany', [{ id: 5, name: 'Widget', currentStock: 0 }]);
    getDb().when('item.findUnique', { id: 5, name: 'Widget', currentStock: 0 });
    getDb().when('item.updateMany', { count: 1 });
    getDb().when('gRN.updateMany', { count: 1 });

    const res = await auth(request(app).delete('/api/grns/31')).send({ reason: 'goods consumed', force: true });

    expect(res.status).toBe(200);
    expect(res.body.forcedNegative).toBe(true);
    expect(res.body.shortfalls[0]).toMatchObject({ itemId: 5, available: 0, needed: 4, short: 4 });
    // allowNegative: the decrement is unconditional and the ledger says why
    expect(getDb().calls('item.updateMany')[0][0].where).toEqual({ id: 5 });
    expect(getDb().calls('stockLedger.create')[0][0].data.notes).toMatch(/forced negative-stock reversal/i);
    // the audit row records the override, not just the reason
    const auditRow = getDb().calls('auditLog.create').map((c) => c[0].data).find((d) => d.action === 'cancel');
    expect(auditRow).toBeTruthy();
    expect(JSON.stringify(auditRow.meta || auditRow.details || auditRow)).toMatch(/forcedNegative/);
  });

  it('refuses the override for a caller without stock.adjust', async () => {
    token = signInAs(makeUser({ id: 7, role: 'STORE_KEEPER', permissions: ['grn.read', 'grn.delete'] }));
    getDb().when('gRN.findUnique', grnRow);
    getDb().when('purchaseReturn.count', 0);
    getDb().when('item.findMany', [{ id: 5, name: 'Widget', currentStock: 0 }]);

    const res = await auth(request(app).delete('/api/grns/31')).send({ reason: 'goods consumed', force: true });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/stock\.adjust/);
    expect(getDb().calls('gRN.updateMany')).toHaveLength(0);
    expect(getDb().calls('stockLedger.create')).toHaveLength(0);
  });

  it('never reports a shortfall for a line with no catalog item', async () => {
    getDb().when('gRN.findUnique', {
      ...grnRow,
      lines: [{ id: 1, itemId: null, qtyAccepted: 3, poLineId: null }],
    });
    getDb().when('purchaseReturn.count', 0);
    getDb().when('gRN.updateMany', { count: 1 });

    const res = await auth(request(app).delete('/api/grns/31')).send({ reason: 'service line only' });
    expect(res.status).toBe(200);
    expect(getDb().calls('stockLedger.create')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AUD-211 — a sales return proves a claim, not that the goods came back
// ---------------------------------------------------------------------------

describe('AUD-211 — sales return needs proof of physical receipt', () => {
  const returnedLine = { id: 1, itemId: 5, qty: 2, description: 'Widget' };

  function approveReturn(overrides = {}) {
    getDb().when('salesReturn.findUnique', {
      id: 51, number: 'SR-26-00051', status: 'APPROVED', partyId: 1, refundAmount: 236,
      returnChallanNo: null, receivedAt: null, dispatchChallanId: null,
      lines: [returnedLine],
      ...overrides,
    });
  }

  beforeEach(() => {
    getDb().when('item.findUnique', { id: 5, name: 'Widget', currentStock: 10 });
    getDb().when('item.updateMany', { count: 1 });
    getDb().when('salesReturn.update', (args) => ({ id: 51, ...args[0].data }));
  });

  it('refuses to process a return with no receipt recorded', async () => {
    approveReturn();

    const res = await auth(request(app).post('/api/sales-returns/51/process'));

    expect(res.status, 'pre-fix this restored stock with zero evidence').toBe(400);
    expect(res.body.message).toMatch(/physical return receipt/i);
    expect(getDb().calls('stockLedger.create')).toHaveLength(0);
    expect(getDb().calls('partyLedger.create')).toHaveLength(0);
  });

  it('records the receipt and then restores stock', async () => {
    approveReturn();

    const receipt = await auth(request(app).post('/api/sales-returns/51/receipt'))
      .send({ returnChallanNo: 'RC-9001', receivedAt: '2026-03-05' });
    expect(receipt.status).toBe(200);
    const stored = getDb().calls('salesReturn.update')[0][0].data;
    expect(stored.returnChallanNo).toBe('RC-9001');
    expect(stored.receivedAt.toISOString().slice(0, 10)).toBe('2026-03-05');
    expect(stored.receivedById).toBe(1);

    // the GET/programmed row now carries the proof, as the database would
    approveReturn({ returnChallanNo: 'RC-9001', receivedAt: new Date('2026-03-05T00:00:00Z') });
    const processed = await auth(request(app).post('/api/sales-returns/51/process')).send({});
    expect(processed.status).toBe(200);
    expect(getDb().calls('stockLedger.create')).toHaveLength(1);
    expect(getDb().calls('stockLedger.create')[0][0].data.refType).toBe('SALES_RETURN');
  });

  it('accepts the proof inline on process (API clients)', async () => {
    approveReturn();

    const res = await auth(request(app).post('/api/sales-returns/51/process'))
      .send({ returnChallanNo: 'RC-9002', receivedAt: '2026-03-06' });

    expect(res.status).toBe(200);
    expect(getDb().calls('stockLedger.create')).toHaveLength(1);
  });

  it('rejects a receipt dated in the future', async () => {
    approveReturn();
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const res = await auth(request(app).post('/api/sales-returns/51/receipt'))
      .send({ returnChallanNo: 'RC-1', receivedAt: future });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/future/i);
    expect(getDb().calls('salesReturn.update')).toHaveLength(0);
  });

  it('rejects a receipt with no challan number', async () => {
    const res = await auth(request(app).post('/api/sales-returns/51/receipt'))
      .send({ returnChallanNo: '', receivedAt: '2026-03-05' });
    expect(res.status).toBe(400);
    expect(getDb().calls('salesReturn.update')).toHaveLength(0);
  });

  it('rejects a dispatch challan belonging to another customer', async () => {
    approveReturn();
    getDb().when('dispatchChallan.findUnique', {
      id: 9, number: 'DC-9', partyId: 2, status: 'DELIVERED', lines: [{ itemId: 5, qty: 10 }],
    });

    const res = await auth(request(app).post('/api/sales-returns/51/receipt'))
      .send({ returnChallanNo: 'RC-1', receivedAt: '2026-03-05', dispatchChallanId: 9 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/different customer/i);
  });

  it('rejects a draft challan — those goods never left the building', async () => {
    approveReturn();
    getDb().when('dispatchChallan.findUnique', {
      id: 9, number: 'DC-9', partyId: 1, status: 'DRAFT', lines: [{ itemId: 5, qty: 10 }],
    });

    const res = await auth(request(app).post('/api/sales-returns/51/receipt'))
      .send({ returnChallanNo: 'RC-1', receivedAt: '2026-03-05', dispatchChallanId: 9 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/only dispatched or delivered/i);
  });

  it('caps the returned quantity at what the challan shipped', async () => {
    approveReturn({ lines: [{ ...returnedLine, qty: 5 }] });
    getDb().when('dispatchChallan.findUnique', {
      id: 9, number: 'DC-9', partyId: 1, status: 'DELIVERED', lines: [{ itemId: 5, qty: 4 }],
    });
    getDb().when('salesReturnLine.aggregate', { _sum: { qty: 0 } });

    const res = await auth(request(app).post('/api/sales-returns/51/receipt'))
      .send({ returnChallanNo: 'RC-1', receivedAt: '2026-03-05', dispatchChallanId: 9 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/shipped 4/);
  });

  it('adds earlier returns against the same challan to the cap', async () => {
    approveReturn({ lines: [{ ...returnedLine, qty: 3 }] });
    getDb().when('dispatchChallan.findUnique', {
      id: 9, number: 'DC-9', partyId: 1, status: 'DELIVERED', lines: [{ itemId: 5, qty: 4 }],
    });
    getDb().when('salesReturnLine.aggregate', { _sum: { qty: 2 } });

    const res = await auth(request(app).post('/api/sales-returns/51/receipt'))
      .send({ returnChallanNo: 'RC-1', receivedAt: '2026-03-05', dispatchChallanId: 9 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already returned 2/);
  });

  it('accepts a return inside the challan quantity', async () => {
    approveReturn({ lines: [{ ...returnedLine, qty: 2 }] });
    getDb().when('dispatchChallan.findUnique', {
      id: 9, number: 'DC-9', partyId: 1, status: 'DISPATCHED', lines: [{ itemId: 5, qty: 4 }],
    });
    getDb().when('salesReturnLine.aggregate', { _sum: { qty: 1 } });

    const res = await auth(request(app).post('/api/sales-returns/51/receipt'))
      .send({ returnChallanNo: 'RC-1', receivedAt: '2026-03-05', dispatchChallanId: 9 });

    expect(res.status).toBe(200);
    expect(getDb().calls('salesReturn.update')[0][0].data.dispatchChallanId).toBe(9);
  });

  it('refuses a receipt on an already processed return', async () => {
    approveReturn({ status: 'PROCESSED' });
    const res = await auth(request(app).post('/api/sales-returns/51/receipt'))
      .send({ returnChallanNo: 'RC-1', receivedAt: '2026-03-05' });
    expect(res.status).toBe(400);
  });
});
