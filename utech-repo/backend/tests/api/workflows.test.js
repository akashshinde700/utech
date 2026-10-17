'use strict';

// Business-workflow tests, driven over HTTP against the real controllers.
//
// Each test asserts the OBSERVABLE contract: the status code returned, and the
// exact Prisma write the controller issued. That catches the failure mode an
// ERP cannot afford — "the UI said saved, but nothing was persisted / stock
// moved the wrong way / the money total was the client's, not the server's".

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

// ---------------------------------------------------------------- invoices

describe('Invoice lifecycle', () => {
  const invoiceBody = {
    date: '2026-01-15',
    partyId: 1,
    isIntraState: true,
    lines: [
      { description: 'Machining', qty: 10, rate: 100, gstRate: 18 },
      { description: 'Assembly', qty: 5, rate: 200, gstRate: 12 },
    ],
  };

  beforeEach(() => {
    getDb().when('party.findUnique', { id: 1, name: 'Acme', stateCode: '27' });
    getDb().when('invoice.create', (args) => ({ id: 11, number: 'INV-26-00001', ...args[0].data }));
  });

  it('creates an invoice with server-computed GST across mixed rates', async () => {
    const res = await auth(request(app).post('/api/invoices')).send(invoiceBody);
    expect(res.status).toBe(201);

    const data = getDb().calls('invoice.create')[0][0].data;
    // 1000 @18% = 180 ; 1000 @12% = 120 -> tax 300 -> total 2300
    expect(Number(data.subtotal)).toBe(2000);
    expect(Number(data.cgst) + Number(data.sgst) + Number(data.igst)).toBe(300);
    expect(Number(data.cgst)).toBe(150);
    expect(Number(data.sgst)).toBe(150);
    expect(Number(data.igst)).toBe(0);
    expect(Number(data.roundOff)).toBe(0);
    expect(Number(data.total)).toBe(2300);
    expect(data.status).toBe('ISSUED');
  });

  it('writes the party ledger entry in the same transaction as the invoice', async () => {
    await auth(request(app).post('/api/invoices')).send(invoiceBody);
    const ledger = getDb().calls('partyLedger.upsert')[0] || getDb().calls('partyLedger.create')[0];
    expect(ledger, 'no party ledger write was issued').toBeTruthy();
  });

  it('refuses to edit a cancelled invoice', async () => {
    getDb().when('invoice.findUnique', { id: 11, status: 'CANCELLED', lines: [] });
    const res = await auth(request(app).put('/api/invoices/11')).send({ notes: 'changed' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cancelled/i);
    expect(getDb().calls('invoice.update')).toHaveLength(0);
  });

  it('refuses to change lines or discount on a PAID invoice', async () => {
    getDb().when('invoice.findUnique', { id: 11, status: 'PAID', lines: [], igst: 0, discount: 0 });
    const res = await auth(request(app).put('/api/invoices/11')).send(invoiceBody);
    expect(res.status).toBe(400);
    expect(getDb().calls('invoice.update')).toHaveLength(0);
  });

  it('DELETE soft-cancels an unpaid invoice and removes its ledger rows', async () => {
    getDb().when('invoice.findUnique', { id: 11, status: 'ISSUED', amountPaid: 0, number: 'INV-26-00001' });
    getDb().when('invoicePayment.aggregate', { _sum: { amount: 0 } });
    const res = await auth(request(app).delete('/api/invoices/11'));
    expect(res.status).toBe(200);
    expect(getDb().calls('invoice.update')[0][0].data.status).toBe('CANCELLED');
    expect(getDb().calls('partyLedger.deleteMany')).toHaveLength(1);
    expect(getDb().calls('invoice.delete')).toHaveLength(0);
  });

  it('refuses to delete an invoice that has payments (credit note required)', async () => {
    getDb().when('invoice.findUnique', { id: 11, status: 'PARTIALLY_PAID', amountPaid: 500 });
    getDb().when('invoicePayment.aggregate', { _sum: { amount: 500 } });
    const res = await auth(request(app).delete('/api/invoices/11'));
    expect(res.status).toBe(400);
    expect(getDb().calls('invoice.update')).toHaveLength(0);
  });
});

describe('Invoice payments', () => {
  beforeEach(() => {
    getDb().when('invoice.findUnique', { id: 11, status: 'ISSUED', total: 1000, amountPaid: 0, partyId: 1, number: 'INV-26-00001' });
    getDb().when('invoicePayment.aggregate', { _sum: { amount: 0 } });
    getDb().when('invoicePayment.create', (args) => ({ id: 1, ...args[0].data }));
  });

  it('rejects an overpayment', async () => {
    const res = await auth(request(app).post('/api/invoices/11/payments')).send({
      date: '2026-01-20', amount: 5000, mode: 'BANK',
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/exceeds the invoice total/i);
    expect(getDb().calls('invoicePayment.create')).toHaveLength(0);
  });

  it('marks the invoice PAID when the payment settles the balance', async () => {
    const res = await auth(request(app).post('/api/invoices/11/payments')).send({
      date: '2026-01-20', amount: 1000, mode: 'BANK',
    });
    expect(res.status).toBe(200);
    const upd = getDb().calls('invoice.update')[0][0].data;
    expect(upd.status).toBe('PAID');
    expect(Number(upd.amountPaid)).toBe(1000);
  });

  it('marks a partial payment PARTIALLY_PAID', async () => {
    await auth(request(app).post('/api/invoices/11/payments')).send({ date: '2026-01-20', amount: 400, mode: 'CASH' });
    expect(getDb().calls('invoice.update')[0][0].data.status).toBe('PARTIALLY_PAID');
  });

  it('refuses a payment on a cancelled invoice', async () => {
    getDb().when('invoice.findUnique', { id: 11, status: 'CANCELLED', total: 1000, amountPaid: 0 });
    const res = await auth(request(app).post('/api/invoices/11/payments')).send({ date: '2026-01-20', amount: 10 });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------- dispatch

describe('Dispatch challan — stock in / stock out', () => {
  const dispatchBody = {
    date: '2026-02-01',
    partyId: 1,
    lines: [{ itemId: 5, qty: 10, notes: 'n' }],
  };

  beforeEach(() => {
    getDb().when('dispatchChallan.create', (args) => ({ id: 21, number: 'DC-26-00001', ...args[0].data }));
    getDb().when('item.findUnique', { id: 5, name: 'Widget', currentStock: 50 });
    // the conditional decrement only "succeeds" when the row matched
    getDb().when('item.updateMany', { count: 1 });
  });

  it('moves stock OUT of company stock when the challan is created', async () => {
    const res = await auth(request(app).post('/api/dispatch')).send(dispatchBody);
    expect(res.status).toBe(201);
    const dec = getDb().calls('item.updateMany')[0][0];
    expect(dec.data.currentStock.decrement).toBe(10);
    const ledger = getDb().calls('stockLedger.create')[0][0].data;
    expect(ledger.refType).toBe('DISPATCH');
    expect(Number(ledger.qtyOut)).toBe(10);
    expect(ledger.ownerType).toBe('COMPANY');
  });

  it('refuses to dispatch more than the stock on hand', async () => {
    getDb().when('item.findUnique', { id: 5, name: 'Widget', currentStock: 3 });
    getDb().when('item.updateMany', { count: 0 });
    const res = await auth(request(app).post('/api/dispatch')).send(dispatchBody);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Insufficient stock/);
  });

  it('restores stock when a dispatch is cancelled (regression: phantom inventory loss)', async () => {
    getDb().when('dispatchChallan.findUnique', {
      id: 21, number: 'DC-26-00001', status: 'DISPATCHED',
      lines: [{ id: 1, itemId: 5, qty: 10 }],
    });
    getDb().when('dispatchChallan.update', (args) => ({
      id: 21, number: 'DC-26-00001', ...args[0].data,
      lines: [{ id: 1, itemId: 5, qty: 10 }], // the real update() includes lines
    }));

    const res = await auth(request(app).post('/api/dispatch/21/status/CANCELLED'));
    expect(res.status).toBe(200);

    const ledgers = getDb().calls('stockLedger.create').map((c) => c[0].data);
    expect(ledgers.some((l) => l.refType === 'DISPATCH_CANCEL' && Number(l.qtyIn) === 10)).toBe(true);
    expect(getDb().calls('item.update')[0][0].data.currentStock.increment).toBe(10);
  });

  it('refuses to cancel a delivered dispatch', async () => {
    getDb().when('dispatchChallan.findUnique', { id: 21, status: 'DELIVERED', lines: [] });
    const res = await auth(request(app).post('/api/dispatch/21/status/CANCELLED'));
    expect(res.status).toBe(400);
    expect(getDb().calls('stockLedger.create')).toHaveLength(0);
  });

  it('refuses to cancel twice (which would double-credit stock)', async () => {
    getDb().when('dispatchChallan.findUnique', { id: 21, status: 'CANCELLED', lines: [{ id: 1, itemId: 5, qty: 10 }] });
    const res = await auth(request(app).post('/api/dispatch/21/status/CANCELLED'));
    expect(res.status).toBe(400);
    expect(getDb().calls('stockLedger.create')).toHaveLength(0);
  });

  it('rejects an unknown target status', async () => {
    getDb().when('dispatchChallan.findUnique', { id: 21, status: 'DRAFT', lines: [] });
    const res = await auth(request(app).post('/api/dispatch/21/status/EXPLODED'));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------- jobwork

describe('Jobwork receipt — vendor cannot invent material', () => {
  const challan = {
    id: 31,
    number: 'JW-26-00001',
    status: 'ISSUED',
    materialOwnerType: 'COMPANY',
    customerMaterialLotId: null,
    lines: [{ id: 1, itemId: 5, qtySent: 10, qtyReceived: 0, qtyRejected: 0 }],
  };

  beforeEach(() => {
    getDb().when('jobworkChallan.findUnique', challan);
    getDb().when('item.findUnique', { id: 5, name: 'Widget', currentStock: 0 });
    getDb().when('jobworkChallan.update', (args) => ({ id: 31, ...args[0].data }));
  });

  const receive = (lines) => auth(request(app).post('/api/jobwork/31/receive')).send({ lines });

  it('accepts a receipt within the quantity sent', async () => {
    const res = await receive([{ id: 1, qtyReceived: 8, qtyRejected: 1 }]);
    expect(res.status).toBe(200);
    expect(getDb().calls('jobworkLine.update')[0][0].data).toMatchObject({ qtyReceived: 8, qtyRejected: 1 });
  });

  it('rejects an over-receipt (received + rejected > qtySent)', async () => {
    const res = await receive([{ id: 1, qtyReceived: 20, qtyRejected: 0 }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/exceeds the qty sent/i);
    expect(getDb().calls('jobworkLine.update')).toHaveLength(0);
  });

  it('rejects a line that does not belong to the challan', async () => {
    const res = await receive([{ id: 999, qtyReceived: 1 }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not belong/);
  });

  it('refuses to receive against a cancelled challan', async () => {
    getDb().when('jobworkChallan.findUnique', { ...challan, status: 'CANCELLED' });
    const res = await receive([{ id: 1, qtyReceived: 1 }]);
    expect(res.status).toBe(400);
    expect(getDb().calls('stockLedger.create')).toHaveLength(0);
  });

  it('400s (not 500s) when a company line has no catalog item', async () => {
    getDb().when('jobworkChallan.findUnique', {
      ...challan,
      lines: [{ id: 1, itemId: null, qtySent: 10, qtyReceived: 0, qtyRejected: 0 }],
    });
    const res = await receive([{ id: 1, qtyReceived: 2 }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no catalog item/i);
  });
});

// ---------------------------------------------------------------- sales returns

describe('Sales return — cannot return more than was sold', () => {
  const invoice = {
    id: 41,
    number: 'INV-26-00007',
    partyId: 1,
    party: { id: 1, name: 'Acme' },
    lines: [{ id: 100, qty: 10, rate: 100, gstRate: 18 }],
  };

  beforeEach(() => {
    getDb().when('invoice.findUnique', invoice);
    getDb().when('salesReturnLine.aggregate', { _sum: { qty: 0 } });
    getDb().when('salesReturn.create', (args) => ({ id: 51, number: 'SR-26-00001', ...args[0].data }));
  });

  it('accepts a return within the invoiced quantity', async () => {
    const res = await auth(request(app).post('/api/sales-returns')).send({
      invoiceId: 41, date: '2026-03-01',
      lines: [{ invoiceLineId: 100, itemId: 5, description: 'd', qty: 4, rate: 100, gstRate: 18 }],
    });
    expect(res.status).toBe(201);
  });

  it('rejects a return that exceeds the invoiced quantity', async () => {
    const res = await auth(request(app).post('/api/sales-returns')).send({
      invoiceId: 41, date: '2026-03-01',
      lines: [{ invoiceLineId: 100, itemId: 5, description: 'd', qty: 40, rate: 100, gstRate: 18 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/exceeds the invoiced quantity/i);
  });

  it('counts previously returned quantity, not just this request', async () => {
    getDb().when('salesReturnLine.aggregate', { _sum: { qty: 8 } });
    const res = await auth(request(app).post('/api/sales-returns')).send({
      invoiceId: 41, date: '2026-03-01',
      lines: [{ invoiceLineId: 100, itemId: 5, description: 'd', qty: 3, rate: 100, gstRate: 18 }],
    });
    expect(res.status).toBe(400);
  });

  it('rejects a line belonging to a different invoice', async () => {
    const res = await auth(request(app).post('/api/sales-returns')).send({
      invoiceId: 41, date: '2026-03-01',
      lines: [{ invoiceLineId: 777, itemId: 5, description: 'd', qty: 1, rate: 100, gstRate: 18 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not belong to invoice/i);
  });

  // AUD-013 (P1, FIXED) — /api/sales-returns used to have no zod schema at all:
  // salesReturn.routes.js imported validate() but never called it, so a
  // non-numeric qty flowed through calcLineAmount into the stored money fields.
  // createSalesReturnSchema is now wired in; this asserts the contract holds.
  it('AUD-013 regression: a non-numeric quantity is rejected with 400', async () => {
    const res = await auth(request(app).post('/api/sales-returns')).send({
      invoiceId: 41, date: '2026-03-01',
      lines: [{ invoiceLineId: 100, itemId: 5, description: 'd', qty: 'not-a-number', rate: 100, gstRate: 18 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
    expect(getDb().calls('salesReturn.create')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- user admin

describe('User administration — privilege escalation guards', () => {
  // A Department Head really does hold user.update (the seed grants it), which
  // is exactly why the in-controller guards matter.
  const caller = makeUser({
    id: 4, role: 'Department Head', hierarchyLevel: 4, departmentId: 2,
    permissions: ['user.read', 'user.update', 'user.create'],
  });

  // requireAuth and the controller both call user.findUnique, for different
  // ids — answer per id so the caller identity and the target record stay
  // distinct.
  function programUsers(target) {
    getDb().when('user.findUnique', (args) => (args[0].where.id === 9 ? target : caller));
  }

  let dhToken;

  beforeEach(() => {
    dhToken = signInAs(caller);
    programUsers({ id: 9, roleId: 6, departmentId: 2, isActive: true });
  });

  it('blocks a Department Head from changing another user\'s role', async () => {
    const res = await request(app).put('/api/users/9').set('Authorization', `Bearer ${dhToken}`).send({ roleId: 1 });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Only administrators can change/);
    expect(getDb().calls('user.update')).toHaveLength(0);
  });

  it('blocks a Department Head from resetting another user\'s password', async () => {
    const res = await request(app).put('/api/users/9').set('Authorization', `Bearer ${dhToken}`).send({ password: 'NewPass123' });
    expect(res.status).toBe(403);
  });

  it('blocks a Department Head from reactivating a deactivated user', async () => {
    const res = await request(app).put('/api/users/9').set('Authorization', `Bearer ${dhToken}`).send({ isActive: true });
    expect(res.status).toBe(403);
  });

  it('blocks editing a user outside the caller\'s department', async () => {
    programUsers({ id: 9, roleId: 6, departmentId: 77, isActive: true });
    const res = await request(app).put('/api/users/9').set('Authorization', `Bearer ${dhToken}`).send({ name: 'Hijacked' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not in your department/i);
  });

  it('lets a Department Head edit a plain field inside their own department', async () => {
    getDb().when('user.update', (args) => ({ id: 9, ...args[0].data }));
    const res = await request(app).put('/api/users/9').set('Authorization', `Bearer ${dhToken}`).send({ name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(getDb().calls('user.update')[0][0].data.name).toBe('Renamed');
  });

  it('never lets a privileged-field change through, whatever role is requested', async () => {
    getDb().when('role.findUnique', { id: 3, name: 'Plant Head', hierarchyLevel: 2 });
    const res = await request(app).put('/api/users/9').set('Authorization', `Bearer ${dhToken}`).send({ roleId: 3 });
    expect(res.status).toBe(403);
    expect(getDb().calls('user.update')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- stock

describe('Manual stock adjustment', () => {
  beforeEach(() => {
    getDb().when('item.findUnique', { id: 5, name: 'Widget', currentStock: 20 });
    getDb().when('stockLedger.create', (args) => ({ id: 1, ...args[0].data }));
  });

  it('a positive qty increments stock and writes an IN ledger row', async () => {
    const res = await auth(request(app).post('/api/stock/adjust')).send({ itemId: 5, qty: 7, notes: 'found' });
    expect(res.status).toBe(201);
    expect(getDb().calls('item.update')[0][0].data.currentStock.increment).toBe(7);
    expect(getDb().calls('stockLedger.create')[0][0].data.refType).toBe('ADJUSTMENT');
  });

  it('a negative qty decrements stock and writes an OUT ledger row', async () => {
    getDb().when('item.updateMany', { count: 1 });
    const res = await auth(request(app).post('/api/stock/adjust')).send({ itemId: 5, qty: -3, notes: 'damaged' });
    expect(res.status).toBe(201);
    expect(getDb().calls('item.updateMany')[0][0].data.currentStock.decrement).toBe(3);
  });

  it('refuses to adjust below zero', async () => {
    getDb().when('item.updateMany', { count: 0 });
    const res = await auth(request(app).post('/api/stock/adjust')).send({ itemId: 5, qty: -500 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Insufficient stock/);
  });

  it('refuses a zero-qty adjustment', async () => {
    const res = await auth(request(app).post('/api/stock/adjust')).send({ itemId: 5, qty: 0 });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------- notifications

describe('Notifications are scoped to the caller (IDOR)', () => {
  it('returns only the caller\'s notifications', async () => {
    const res = await auth(request(app).get('/api/notifications'));
    expect(res.status).toBe(200);
    expect(getDb().calls('notification.findMany')[0][0].where.userId).toBe(1);
  });

  it('404s when marking someone else\'s notification as read', async () => {
    getDb().when('notification.findUnique', { id: 5, userId: 999 });
    const res = await auth(request(app).post('/api/notifications/5/read'));
    expect(res.status).toBe(404);
    expect(getDb().calls('notification.update')).toHaveLength(0);
  });

  it('scopes mark-all-read to the caller', async () => {
    const res = await auth(request(app).post('/api/notifications/read-all'));
    expect(res.status).toBe(200);
    expect(getDb().calls('notification.updateMany')[0][0].where.userId).toBe(1);
  });
});
