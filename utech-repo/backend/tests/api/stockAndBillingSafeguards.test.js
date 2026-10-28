import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { getDb, makeUser, signInAs, loadApp } from '../helpers/app';

let app;
let token;
beforeAll(async () => { app = await loadApp(); });
beforeEach(() => {
  getDb().reset();
  token = signInAs(makeUser({ id: 1, role: 'SUPERADMIN' }));
});
const auth = (r) => r.set('Authorization', `Bearer ${token}`);

describe('stock and accounting safeguards', () => {
  it.each([-1, 0.0001])('rejects invalid opening stock %s before writing an item', async (openingStock) => {
    const res = await auth(request(app).post('/api/items')).send({ name: 'Invalid stock', openingStock });
    expect(res.status).toBe(400);
    expect(getDb().calls('item.create')).toHaveLength(0);
  });

  it('rejects a movement with more than three decimal places', async () => {
    const res = await auth(request(app).post('/api/stock/adjust')).send({ itemId: 5, qty: 0.0001 });
    expect(res.status).toBe(400);
    expect(getDb().calls('stockLedger.create')).toHaveLength(0);
  });

  it('treats the ledger end date as inclusive for the whole day', async () => {
    const res = await auth(request(app).get('/api/stock/ledger?from=2026-01-15&to=2026-01-15&itemId=5'));
    expect(res.status).toBe(200);
    const { where } = getDb().calls('stockLedger.findMany')[0][0];
    expect(where.itemId).toBe(5);
    // the bounds are that day's midnights where the server is, which is the
    // day the report prints next to the row — asserting a fixed UTC string
    // would only hold on a UTC machine
    expect(where.date.gte).toEqual(new Date(2026, 0, 15, 0, 0, 0, 0));
    expect(where.date.lt).toEqual(new Date(2026, 0, 16, 0, 0, 0, 0));
  });

  it('rejects an invalid ledger date rather than querying with Invalid Date', async () => {
    const res = await auth(request(app).get('/api/stock/ledger?to=not-a-date'));
    expect(res.status).toBe(400);
    expect(getDb().calls('stockLedger.findMany')).toHaveLength(0);
  });

  it('remembers a rejection when the last jobwork receipt is accepted', async () => {
    getDb().when('jobworkChallan.findUnique', { id: 31, status: 'PARTIAL_RECEIVED', materialOwnerType: 'COMPANY',
      lines: [{ id: 1, itemId: 5, qtySent: 4, qtyReceived: 2, qtyRejected: 1 }] });
    getDb().when('item.findUnique', { id: 5, name: 'Part', currentStock: 9 });
    const res = await auth(request(app).post('/api/jobwork/31/receive')).send({ lines: [{ id: 1, qtyReceived: 1 }] });
    expect(res.status).toBe(200);
    expect(getDb().calls('jobworkChallan.update')[0][0].data.status).toBe('REJECTED');
  });

  it('rejects duplicate jobwork receipt line IDs before any stock movement', async () => {
    const res = await auth(request(app).post('/api/jobwork/4/receive')).send({
      lines: [{ id: 2, qtyReceived: 3 }, { id: 2, qtyReceived: 3 }],
    });
    expect(res.status).toBe(400);
    expect(getDb().calls('stockLedger.create')).toHaveLength(0);
  });

  it('does not restore dispatch stock when a conditional cancellation claim loses', async () => {
    getDb().when('dispatchChallan.findUnique', { id: 21, status: 'DISPATCHED', number: 'DC-1', lines: [{ id: 1, itemId: 5, qty: 4 }] });
    getDb().when('dispatchChallan.updateMany', { count: 0 });
    const res = await auth(request(app).post('/api/dispatch/21/status/CANCELLED'));
    expect(res.status).toBe(409);
    expect(getDb().calls('stockLedger.create')).toHaveLength(0);
  });

  it('does not allow a delivered dispatch to move backward and then be cancelled', async () => {
    getDb().when('dispatchChallan.findUnique', { id: 21, status: 'DELIVERED', number: 'DC-1', lines: [] });
    const res = await auth(request(app).post('/api/dispatch/21/status/DISPATCHED'));
    expect(res.status).toBe(400);
    expect(getDb().calls('dispatchChallan.updateMany')).toHaveLength(0);
  });

  it('does not reverse a GRN when a conditional cancellation claim loses', async () => {
    getDb().when('gRN.findUnique', { id: 31, status: 'RECEIVED', number: 'GRN-1', lines: [{ itemId: 5, qtyAccepted: 4 }] });
    getDb().when('purchaseReturn.count', 0);
    getDb().when('gRN.updateMany', { count: 0 });
    const res = await auth(request(app).delete('/api/grns/31')).send({ reason: 'mistake' });
    expect(res.status).toBe(409);
    expect(getDb().calls('stockLedger.create')).toHaveLength(0);
  });

  it('does not post production output or consumption when the completion claim loses', async () => {
    getDb().when('productionBatch.findUnique', { id: 8, status: 'IN_PROGRESS', itemId: 4, materialConsumptions: [{ itemId: 5, qtyConsumed: 4 }] });
    getDb().when('productionBatch.updateMany', { count: 0 });
    const res = await auth(request(app).post('/api/production/batches/8/complete')).send({ qtyProduced: 3 });
    expect(res.status).toBe(409);
    expect(getDb().calls('stockLedger.create')).toHaveLength(0);
  });

  it('does not record a payment when the invoice claim loses', async () => {
    getDb().when('invoice.findUnique', { id: 11, status: 'ISSUED', total: 100, amountPaid: 0, partyId: 1 });
    getDb().when('invoicePayment.aggregate', { _sum: { amount: 0 } });
    getDb().when('invoice.updateMany', { count: 0 });
    const res = await auth(request(app).post('/api/invoices/11/payments')).send({ date: '2026-01-01', amount: 100, mode: 'BANK' });
    expect(res.status).toBe(409);
    expect(getDb().calls('invoicePayment.create')).toHaveLength(0);
    expect(getDb().calls('partyLedger.create')).toHaveLength(0);
  });
});

describe('returns must use the source document item once', () => {
  const salesLine = { invoiceLineId: 100, itemId: 5, description: 'Item', qty: 6, rate: 10, gstRate: 0 };
  const purchaseLine = { grnLineId: 200, itemId: 5, description: 'Item', qty: 6, rate: 10, gstRate: 0 };
  beforeEach(() => {
    getDb().when('invoice.findUnique', { id: 1, status: 'ISSUED', partyId: 2, number: 'INV-1', lines: [{ id: 100, itemId: 5, qty: 10 }] });
    getDb().when('salesReturnLine.aggregate', { _sum: { qty: 0 } });
    getDb().when('gRN.findUnique', { id: 3, partyId: 2, number: 'GRN-1', lines: [] });
    getDb().when('grnLine.findUnique', { id: 200, grnId: 3, itemId: 5, qtyAccepted: 10 });
    getDb().when('purchaseReturnLine.aggregate', { _sum: { qty: 0 } });
  });

  it('rejects duplicate sales-return anchor lines', async () => {
    const res = await auth(request(app).post('/api/sales-returns')).send({ invoiceId: 1, date: '2026-01-01', lines: [salesLine, salesLine] });
    expect(res.status).toBe(400);
    expect(getDb().calls('salesReturn.create')).toHaveLength(0);
  });
  it('rejects a different item on a sales-return anchor', async () => {
    const res = await auth(request(app).post('/api/sales-returns')).send({ invoiceId: 1, date: '2026-01-01', lines: [{ ...salesLine, itemId: 99 }] });
    expect(res.status).toBe(400);
    expect(getDb().calls('salesReturn.create')).toHaveLength(0);
  });
  it('rejects duplicate purchase-return anchor lines', async () => {
    const res = await auth(request(app).post('/api/purchase-returns')).send({ grnId: 3, date: '2026-01-01', lines: [purchaseLine, purchaseLine] });
    expect(res.status).toBe(400);
    expect(getDb().calls('purchaseReturn.create')).toHaveLength(0);
  });
  it('rejects a different item on a purchase-return anchor', async () => {
    const res = await auth(request(app).post('/api/purchase-returns')).send({ grnId: 3, date: '2026-01-01', lines: [{ ...purchaseLine, itemId: 99 }] });
    expect(res.status).toBe(400);
    expect(getDb().calls('purchaseReturn.create')).toHaveLength(0);
  });
});
