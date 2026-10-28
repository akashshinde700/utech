'use strict';

// Expenses go straight into the cost side of the dashboard and the category
// summary chart, and `POST /` + `PUT /:id` were the only money-writing routes
// with no schema behind them. The controller whitelists which keys it copies
// (so nothing can be mass-assigned), but it never checked that the values in
// them were numbers, and `update` did not re-run even the create route's two
// hand-written checks.

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
  getDb().when('numberSequence.findUnique', null);
});

const auth = (r) => r.set('Authorization', `Bearer ${token}`);
const post = (body) => auth(request(app).post('/api/expenses')).send(body);
const put = (id, body) => auth(request(app).put(`/api/expenses/${id}`)).send(body);

const VALID = {
  date: '2026-10-28',
  category: 'Material',
  description: 'Hardware for the fabrication bay',
  amount: 1500,
  taxAmount: 270,
  paymentMode: 'BANK',
};

describe('POST /api/expenses', () => {
  it('accepts a well-formed expense', async () => {
    const res = await post(VALID);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it('refuses an amount that is not a number instead of failing in the database', async () => {
    const res = await post({ ...VALID, amount: 'twelve hundred' });
    expect(res.status).toBe(400);
    expect(getDb().calls('expense.create')).toHaveLength(0);
  });

  it('refuses a negative or zero amount', async () => {
    expect((await post({ ...VALID, amount: -500 })).status).toBe(400);
    expect((await post({ ...VALID, amount: 0 })).status).toBe(400);
    expect(getDb().calls('expense.create')).toHaveLength(0);
  });

  it('refuses a negative tax amount', async () => {
    const res = await post({ ...VALID, taxAmount: -270 });
    expect(res.status).toBe(400);
  });

  it('refuses more than two decimal places on money', async () => {
    const res = await post({ ...VALID, amount: 1500.125 });
    expect(res.status).toBe(400);
  });

  it('refuses a category or payment mode outside the allowed set', async () => {
    // the schema comment on the model lists these; nothing enforced them, so a
    // typo became its own slice in the category summary chart
    expect((await post({ ...VALID, category: 'Mterial' })).status).toBe(400);
    expect((await post({ ...VALID, paymentMode: 'BARTER' })).status).toBe(400);
  });

  it('still requires a description and a date', async () => {
    expect((await post({ ...VALID, description: '   ' })).status).toBe(400);
    expect((await post({ ...VALID, date: undefined })).status).toBe(400);
  });

  it('ignores keys it does not own', async () => {
    const res = await post({ ...VALID, id: 9999, number: 'EXP-HACK', createdById: 42 });
    expect(res.status).toBe(201);
    const [[args]] = getDb().calls('expense.create');
    expect(args.data.id).toBeUndefined();
    expect(args.data.number).not.toBe('EXP-HACK');
    expect(args.data.createdById).toBe(1); // the signed-in user, not the body
  });
});

describe('PUT /api/expenses/:id', () => {
  beforeEach(() => {
    getDb().when('expense.findUnique', { id: 5, number: 'EXP-0005', amount: 1500 });
  });

  it('accepts a legitimate edit', async () => {
    const res = await put(5, { amount: 1750 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('refuses a negative amount — the edit route used to accept one', async () => {
    // a negative expense quietly reduced the reported cost total on the
    // dashboard and in the category summary
    const res = await put(5, { amount: -5000 });
    expect(res.status).toBe(400);
    expect(getDb().calls('expense.update')).toHaveLength(0);
  });

  it('refuses a non-numeric amount on edit', async () => {
    const res = await put(5, { amount: 'five thousand' });
    expect(res.status).toBe(400);
    expect(getDb().calls('expense.update')).toHaveLength(0);
  });

  it('refuses blanking the description', async () => {
    const res = await put(5, { description: '' });
    expect(res.status).toBe(400);
  });

  it('leaves untouched fields alone when the key is absent', async () => {
    const res = await put(5, { notes: 'approved by plant head' });
    expect(res.status).toBe(200);
    const [[args]] = getDb().calls('expense.update');
    expect(args.data.amount).toBeUndefined();
    expect(args.data.category).toBeUndefined();
  });
});
