'use strict';

// API input-validation tests — server-side, over HTTP, through the real
// middleware chain. Frontend validation is irrelevant to these: the request
// goes straight at the API with a valid bearer token.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { getDb, makeUser, signInAs, loadApp } from '../helpers/app';

let app;
let token;

const VALID_INVOICE = {
  date: '2026-01-15',
  partyId: 1,
  isIntraState: true,
  lines: [{ description: 'Machining job', qty: 10, rate: 100, gstRate: 18 }],
};

beforeAll(async () => {
  app = await loadApp();
});

beforeEach(() => {
  getDb().reset();
  token = signInAs(makeUser({ id: 1, role: 'SUPERADMIN' }));
});

const auth = (r) => r.set('Authorization', `Bearer ${token}`);

describe('POST /api/auth/login — validation', () => {
  it('400s on a missing email', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: 'whatever1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
    expect(res.body.details.map((d) => d.path)).toContain('email');
  });

  it('400s on a malformed email', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: 'whatever1' });
    expect(res.status).toBe(400);
  });

  it('400s on a password below the minimum length', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.details.map((d) => d.path)).toContain('password');
  });

  it('401s (not 400) when the credentials are simply wrong', async () => {
    getDb().when('user.findUnique', null);
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@utech.local', password: 'whatever1' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials');
  });

  it('normalises the email so case and padding cannot dodge the lookup', async () => {
    getDb().when('user.findUnique', null);
    await request(app).post('/api/auth/login').send({ email: '  Admin@UTech.Local ', password: 'whatever1' });
    const [args] = getDb().calls('user.findUnique');
    expect(args[0].where.email).toBe('admin@utech.local');
  });
});

describe('POST /api/auth/change-password — validation', () => {
  it('400s when the new password is under 8 characters', async () => {
    const res = await auth(request(app).post('/api/auth/change-password')).send({
      currentPassword: 'current123',
      newPassword: 'short',
    });
    expect(res.status).toBe(400);
    expect(res.body.details.map((d) => d.path)).toContain('newPassword');
  });
});

describe('POST /api/invoices — server-side validation', () => {
  beforeEach(() => {
    getDb().when('party.findUnique', { id: 1, name: 'Acme', stateCode: '27', gstin: '27AAPFU0939F1ZV' });
    getDb().when('invoice.create', (args) => ({ id: 99, ...args[0].data }));
    getDb().when('invoiceLine.findFirst', null);
  });

  it('400s when there are no lines', async () => {
    const res = await auth(request(app).post('/api/invoices')).send({ ...VALID_INVOICE, lines: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  it('400s on a zero or negative quantity', async () => {
    for (const qty of [0, -5]) {
      const res = await auth(request(app).post('/api/invoices')).send({
        ...VALID_INVOICE,
        lines: [{ description: 'x', qty, rate: 10, gstRate: 18 }],
      });
      expect(res.status, `qty=${qty}`).toBe(400);
    }
  });

  it('400s on a negative rate', async () => {
    const res = await auth(request(app).post('/api/invoices')).send({
      ...VALID_INVOICE,
      lines: [{ description: 'x', qty: 1, rate: -10, gstRate: 18 }],
    });
    expect(res.status).toBe(400);
  });

  it('400s on a missing partyId', async () => {
    const body = { ...VALID_INVOICE };
    delete body.partyId;
    const res = await auth(request(app).post('/api/invoices')).send(body);
    expect(res.status).toBe(400);
  });

  it('400s when the date is unparseable', async () => {
    const res = await auth(request(app).post('/api/invoices')).send({ ...VALID_INVOICE, date: 'not-a-date' });
    expect(res.status).toBe(400);
  });

  it('rejects a discount that is not a number', async () => {
    const res = await auth(request(app).post('/api/invoices')).send({ ...VALID_INVOICE, discount: 'lots' });
    expect(res.status).toBe(400);
  });

  it('computes the money server-side and ignores client-supplied totals', async () => {
    const res = await auth(request(app).post('/api/invoices')).send({
      ...VALID_INVOICE,
      subtotal: 1,
      total: 1,
      cgst: 0,
      sgst: 0,
      status: 'PAID',
      number: 'INV-HACKED-00001',
      createdById: 999,
      amountPaid: 999999,
    });
    expect(res.status).toBe(201);

    const [args] = getDb().calls('invoice.create');
    const data = args[0].data;
    // 10 x 100 @18% intra-state = 1000 + 90 + 90
    expect(Number(data.subtotal)).toBe(1000);
    expect(Number(data.cgst)).toBe(90);
    expect(Number(data.sgst)).toBe(90);
    expect(Number(data.total)).toBe(1180);
    // the forged fields never reach the database
    expect(data.status).toBe('ISSUED');
    expect(data.number).not.toBe('INV-HACKED-00001');
    expect(data.createdById).toBe(1);
    expect(data).not.toHaveProperty('amountPaid');
  });

  it('400s when the party does not exist', async () => {
    getDb().when('party.findUnique', null);
    const res = await auth(request(app).post('/api/invoices')).send(VALID_INVOICE);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Party not found/);
  });
});

describe('POST /api/parties — server-side validation', () => {
  beforeEach(() => {
    getDb().when('party.create', (args) => ({ id: 5, ...args[0].data }));
    getDb().when('party.findFirst', null);
  });

  it('400s on an invalid GSTIN', async () => {
    const res = await auth(request(app).post('/api/parties')).send({ name: 'Acme', gstin: 'NOT-A-GSTIN' });
    expect(res.status).toBe(400);
  });

  it('400s on a name that is too short', async () => {
    const res = await auth(request(app).post('/api/parties')).send({ name: 'A' });
    expect(res.status).toBe(400);
  });

  it('400s on an unknown party type', async () => {
    const res = await auth(request(app).post('/api/parties')).send({ name: 'Acme', type: 'FRIEND' });
    expect(res.status).toBe(400);
  });

  it('400s on a negative credit limit', async () => {
    const res = await auth(request(app).post('/api/parties')).send({ name: 'Acme', creditLimit: -100 });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/items — server-side validation', () => {
  beforeEach(() => {
    getDb().when('item.create', (args) => ({ id: 6, ...args[0].data }));
    getDb().when('item.findFirst', null);
  });

  it('400s on a GST rate above 100', async () => {
    const res = await auth(request(app).post('/api/items')).send({ name: 'Widget', gstRate: 500 });
    expect(res.status).toBe(400);
  });

  it('400s on a negative sale rate', async () => {
    const res = await auth(request(app).post('/api/items')).send({ name: 'Widget', saleRate: -1 });
    expect(res.status).toBe(400);
  });
});

describe('list endpoints tolerate junk query parameters', () => {
  it('GET /api/invoices?page=abc&pageSize=999999 still returns a page', async () => {
    const res = await auth(request(app).get('/api/invoices?page=abc&pageSize=999999&sortBy=;DROP&sortDir=asc'));
    expect(res.status).toBe(200);
    expect(res.body.pagination.pageSize).toBe(100);
    expect(res.body.pagination.page).toBe(1);
  });
});
