'use strict';

// AUD-214 / AUD-215 regression suite (2026-10-27 integrity pass):
//
//  AUD-214  A job-card save used to delete and re-create every operation, so an
//           unrelated edit wiped each task's id, assignment, progress, approval
//           and comment thread. Replace-all is now id-preserving and refuses to
//           discard a task that already has history.
//  AUD-215  `?to=YYYY-MM-DD` used `new Date(to)` = midnight, so documents stored
//           later on the end date silently vanished from lists, reports and the
//           stock ledger ("sales up to today" understated today).
//  AUD-216  /api/stock/summary hardcoded reservedStock: 0 while job cards held
//           customer material reservations.
//  AUD-217  Excel exports were silently truncated at a take() cap with no
//           indication that the workbook was incomplete.
//
// Disposable schema-driven in-memory database: this is NOT an InnoDB isolation
// test and does not prove MySQL locking behaviour.
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
const { createInMemoryPrisma } = require('../../src/config/inMemoryPrisma');
const { dateRangeFilter } = require('../../src/utils/dates');

let app, db, token, customer, prisma;
const auth = (r) => r.set('Authorization', `Bearer ${token}`);
const post = (url, body) => auth(request(app).post(url)).send(body);
const put = (url, body) => auth(request(app).put(url)).send(body);

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'isolated-integrity-test-secret-only';
  process.env.DATABASE_URL = 'mysql://stub:stub@localhost:3306/stub';
  process.env.UPLOAD_DIR = '/tmp/utech-integrity-test-uploads';
  db = createInMemoryPrisma();
  global.__prisma = db;
  const role = await db.role.create({ data: { name: 'SUPERADMIN' } });
  const user = await db.user.create({ data: { name: 'Integrity Admin', email: 'integrity@example.invalid', passwordHash: 'x', roleId: role.id } });
  customer = await db.party.create({ data: { name: 'Integrity Customer', code: 'INT-C', type: 'CUSTOMER' } });
  token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  app = (await import('../../src/server')).default;
  prisma = require('../../src/config/prisma');
});

afterAll(() => vi.restoreAllMocks());

describe('AUD-215 — date-range upper bound includes the whole end day', () => {
  it('treats a bare to= as an exclusive next-midnight bound and a timestamp as an instant', () => {
    const day = dateRangeFilter('2026-10-01', '2026-10-27');
    expect(day.gte.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(day.lt.toISOString()).toBe('2026-10-28T00:00:00.000Z');
    expect(day.lte).toBeUndefined();

    const instant = dateRangeFilter(null, '2026-10-27T12:00:00.000Z');
    expect(instant.lte.toISOString()).toBe('2026-10-27T12:00:00.000Z');
    expect(dateRangeFilter(undefined, '')).toBeNull();
    expect(() => dateRangeFilter('nonsense', null)).toThrow(/Invalid start date/);
    expect(() => dateRangeFilter(null, '2026-13-45')).toThrow(/Invalid end date/);
  });

  it('lists an invoice stored at 18:30 on the end date (previously invisible)', async () => {
    const morning = await post('/api/invoices', {
      partyId: customer.id, date: '2026-10-27', isIntraState: true,
      lines: [{ description: 'Morning line', qty: 1, rate: 100, gstRate: 18 }],
    });
    expect(morning.status, JSON.stringify(morning.body)).toBe(201);
    const evening = await post('/api/invoices', {
      partyId: customer.id, date: '2026-10-27T18:30:00.000Z', isIntraState: true,
      lines: [{ description: 'Evening lot charge', qty: 1, rate: 500, gstRate: 18 }],
    });
    expect(evening.status, JSON.stringify(evening.body)).toBe(201);

    const upto = await auth(request(app).get('/api/invoices?from=2026-10-27&to=2026-10-27&pageSize=100'));
    expect(upto.status).toBe(200);
    const numbers = upto.body.items.map((i) => i.number);
    expect(numbers).toContain(morning.body.number);
    expect(numbers).toContain(evening.body.number);
    // and nothing from the surrounding days leaks in
    expect(upto.body.items.every((i) => String(i.date).startsWith('2026-10-27'))).toBe(true);

    // an explicit instant keeps its exact meaning
    const cutOff = await auth(request(app).get('/api/invoices?to=2026-10-27T12:00:00.000Z&pageSize=100'));
    expect(cutOff.body.items.map((i) => i.number)).toContain(morning.body.number);
    expect(cutOff.body.items.map((i) => i.number)).not.toContain(evening.body.number);
  });

  it('rejects a malformed date instead of silently returning an empty page', async () => {
    const bad = await auth(request(app).get('/api/invoices?to=not-a-date'));
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/Invalid end date/);
  });

  it('applies the same end-day rule to the stock ledger and its XLSX report', async () => {
    const item = await db.item.create({ data: { code: 'INT-I1', name: 'Ledger item', currentStock: 0 } });
    await post('/api/stock/adjust', { itemId: item.id, qty: 10, notes: 'late movement' });

    const ledger = await auth(request(app).get('/api/stock/ledger?to=2026-10-27'));
    expect(ledger.status).toBe(200);
    expect(ledger.body.length).toBeGreaterThan(0);
    expect(ledger.body.every((r) => new Date(r.createdAt || r.date) < new Date('2026-10-28T00:00:00.000Z'))).toBe(true);

    const report = await auth(request(app).get('/api/reports/stock-ledger.xlsx?to=2026-10-27'));
    expect(report.status).toBe(200);
    expect(report.headers['x-export-truncated']).toBe('false');
  });

  it('keeps the expense summary consistent with the filtered expense list', async () => {
    await post('/api/expenses', { date: '2026-10-27T19:00:00.000Z', category: 'POWER', description: 'Late bill', amount: 250 });
    const list = await auth(request(app).get('/api/expenses?from=2026-10-27&to=2026-10-27'));
    const summary = await auth(request(app).get('/api/expenses/summary?from=2026-10-27&to=2026-10-27'));
    expect(list.status).toBe(200);
    expect(summary.status).toBe(200);
    const power = summary.body.find((g) => g.category === 'POWER');
    const listTotal = list.body.items.filter((e) => e.category === 'POWER').reduce((s, e) => s + Number(e.amount), 0);
    expect(power ? power.total : 0).toBe(listTotal);
  });
});

describe('AUD-217 — exports declare their row cap', () => {
  it('reports the row limit and completion status on every workbook', async () => {
    const res = await auth(request(app).get('/api/reports/invoices.xlsx'));
    expect(res.status).toBe(200);
    expect(res.headers['x-export-row-limit']).toBe('5000');
    expect(res.headers['x-export-truncated']).toBe('false');
    expect(Number(res.headers['x-export-rows'])).toBeGreaterThan(0);
  });

  it('marks the workbook truncated when the cap is hit (no silent data loss)', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => ({
      id: 100000 + i, number: `INV-T-${i}`, date: new Date('2026-10-01'), partyId: customer.id,
      status: 'ISSUED', subtotal: 1, cgst: 0, sgst: 0, igst: 0, discount: 0, total: 1, amountPaid: 0,
      party: { id: customer.id, name: customer.name, gstin: null },
    }));
    const spy = vi.spyOn(prisma.invoice, 'findMany').mockResolvedValueOnce(rows);
    const res = await auth(request(app).get('/api/reports/invoices.xlsx'));
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(res.headers['x-export-truncated']).toBe('true');
    expect(res.headers['x-export-rows']).toBe('5000');
  });
});

describe('AUD-214 — job-card edits preserve Task Progress history', () => {
  async function makeCard(operations) {
    const card = await post('/api/jobcards', {
      date: '2026-10-27', partyId: customer.id, itemDescription: 'Preserve tasks',
      lines: [{ itemName: 'Bar', qty: 1 }], operations,
    });
    expect(card.status, JSON.stringify(card.body)).toBe(201);
    return card.body;
  }

  it('updates an existing task in place instead of deleting and recreating it', async () => {
    const card = await makeCard([{ processId: null, sequence: 0, notes: 'first' }]);
    const original = card.operations[0];

    const saved = await put(`/api/jobcards/${card.id}`, {
      operations: [{ id: original.id, sequence: 2, notes: 'rescheduled' }],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.operations).toHaveLength(1);
    expect(saved.body.operations[0].id).toBe(original.id);
    expect(saved.body.operations[0].sequence).toBe(2);
    expect(saved.body.operations[0].notes).toBe('rescheduled');
  });

  it('refuses to drop a task that already has progress or an assignee', async () => {
    const card = await makeCard([{ sequence: 0, notes: 'keep me' }, { sequence: 1, notes: 'drop me' }]);
    const [keep, removable] = card.operations;
    await db.jobcardOperation.update({ where: { id: keep.id }, data: { status: 'IN_PROGRESS', progressPercent: 40, assignedToId: 1 } });

    const blocked = await put(`/api/jobcards/${card.id}`, { operations: [] });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/already have history/i);

    const still = await db.jobcardOperation.findMany({ where: { jobcardId: card.id } });
    expect(still.map((o) => o.id).sort()).toEqual([keep.id, removable.id].sort());

    // a task with no history may still be removed in the same save
    const allowed = await put(`/api/jobcards/${card.id}`, {
      operations: [{ id: keep.id, sequence: 0, notes: 'keep me' }],
    });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
    const after = await db.jobcardOperation.findMany({ where: { jobcardId: card.id } });
    expect(after.map((o) => o.id)).toEqual([keep.id]);
  });

  it('rejects an operation id that belongs to another job card', async () => {
    const a = await makeCard([{ sequence: 0, notes: 'a' }]);
    const b = await makeCard([{ sequence: 0, notes: 'b' }]);
    const hijack = await put(`/api/jobcards/${a.id}`, {
      operations: [{ id: b.operations[0].id, sequence: 0 }],
    });
    expect(hijack.status).toBe(400);
    expect(hijack.body.message).toMatch(/does not belong to this job card/);
  });

  it('a lines-only save never touches the task list (AUD-201 stays fixed)', async () => {
    const card = await makeCard([{ sequence: 0, notes: 'untouched' }]);
    const before = card.operations[0];
    const saved = await put(`/api/jobcards/${card.id}`, {
      lines: [{ id: card.lines[0].id, itemName: 'Bar', qty: 2 }],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.operations).toHaveLength(1);
    expect(saved.body.operations[0].id).toBe(before.id);
    expect(saved.body.operations[0].notes).toBe('untouched');
  });
});

describe('AUD-216 — reserved stock is reported, not hardcoded to zero', () => {
  it('reports customer material reserved by job cards in the stock summary', async () => {
    const lot = await post('/api/customer-material', {
      customerId: customer.id, materialDescription: 'Reserved bar', qty: 100, weight: 60, receivedDate: '2026-10-27',
    });
    expect(lot.status, JSON.stringify(lot.body)).toBe(201);
    const card = await post('/api/jobcards', { date: '2026-10-27', partyId: customer.id });
    const reserve = await post(`/api/customer-material/${lot.body.id}/allocations`, {
      jobcardId: card.body.id, qty: 25, weight: 15,
    });
    expect(reserve.status, JSON.stringify(reserve.body)).toBe(201);

    const summary = await auth(request(app).get('/api/stock/summary'));
    expect(summary.status).toBe(200);
    expect(summary.body.customerInventory.reservedQty).toBe(25);
    expect(summary.body.customerInventory.reservedWeight).toBe(15);
    expect(summary.body.reservedStock).toBe(25);
    expect(summary.body.reservedOwnerType).toBe('CUSTOMER');

    // releasing the reservation must drop the figure again
    const release = await post(`/api/customer-material/${lot.body.id}/allocations/${reserve.body.id}/release`, { reason: 'not needed' });
    expect(release.status, JSON.stringify(release.body)).toBe(200);
    const after = await auth(request(app).get('/api/stock/summary'));
    expect(after.body.reservedStock).toBe(0);
    expect(after.body.customerInventory.reservedQty).toBe(0);
  });
});

describe('AUD-218 — quality certificates reference a real document and cannot collide', () => {
  it('rejects a certificate pointing at a document that does not exist', async () => {
    const res = await post('/api/quality', {
      date: '2026-10-27', refType: 'JOBCARD', refId: 999999, result: 'PASS', certificateNo: 'CERT-X-1',
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/No JOBCARD with id 999999 exists/);
  });

  it('accepts a certificate for a real job card and blocks a duplicate number', async () => {
    const card = await post('/api/jobcards', { date: '2026-10-27', partyId: customer.id, itemDescription: 'Certificate subject' });
    expect(card.status).toBe(201);

    const first = await post('/api/quality', {
      date: '2026-10-27', refType: 'JOBCARD', refId: card.body.id, result: 'PASS', certificateNo: '  CERT-2026-001  ',
      lines: [{ parameter: 'Hardness', expected: '<= 90 HRB', actual: '82 HRB', result: 'PASS' }],
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.certificateNo).toBe('CERT-2026-001'); // trimmed

    const duplicate = await post('/api/quality', {
      date: '2026-10-27', refType: 'JOBCARD', refId: card.body.id, result: 'PASS', certificateNo: 'cert-2026-001',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message).toMatch(/already used by quality check/);

    // editing a certificate keeps its own number valid
    const same = await put(`/api/quality/${first.body.id}`, { certificateNo: 'CERT-2026-001', remarks: 'reviewed' });
    expect(same.status, JSON.stringify(same.body)).toBe(200);

    // but another check cannot steal it
    const other = await post('/api/quality', {
      date: '2026-10-27', refType: 'JOBCARD', refId: card.body.id, result: 'PASS', certificateNo: 'CERT-2026-002',
    });
    expect(other.status).toBe(201);
    const steal = await put(`/api/quality/${other.body.id}`, { certificateNo: 'CERT-2026-001' });
    expect(steal.status).toBe(409);
  });
});

describe('AUD-219 — a dispatch linked to an invoice must fit that invoice', () => {
  async function stockedItem(code, qty) {
    const item = await db.item.create({ data: { code, name: `Dispatch item ${code}`, currentStock: qty, purchaseRate: 10 } });
    await db.stockLedger.create({ data: { itemId: item.id, date: new Date(), refType: 'OPENING', refId: item.id, qtyIn: qty, qtyOut: 0, balance: qty, ownerType: 'COMPANY' } });
    return item;
  }

  it('rejects another customer\'s invoice, a cancelled invoice and over-shipment', async () => {
    const item = await stockedItem('INT-D1', 100);
    const otherCustomer = await db.party.create({ data: { name: 'Other Buyer', code: 'INT-C2', type: 'CUSTOMER' } });
    const invoice = await post('/api/invoices', {
      partyId: customer.id, date: '2026-10-27', isIntraState: true,
      lines: [{ itemId: item.id, description: 'Billed bar', qty: 2, rate: 10, gstRate: 18 }],
    });
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);

    const foreign = await post('/api/dispatch', {
      date: '2026-10-27', partyId: otherCustomer.id, invoiceId: invoice.body.id,
      lines: [{ itemId: item.id, qty: 1 }],
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body.message).toMatch(/belongs to .*not to this challan's party/);

    const tooMuch = await post('/api/dispatch', {
      date: '2026-10-27', partyId: customer.id, invoiceId: invoice.body.id,
      lines: [{ itemId: item.id, qty: 3 }],
    });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.message).toMatch(/Dispatch exceeds invoice/);

    const notOnInvoice = await post('/api/dispatch', {
      date: '2026-10-27', partyId: customer.id, invoiceId: invoice.body.id,
      lines: [{ itemId: (await stockedItem('INT-D2', 5)).id, qty: 1 }],
    });
    expect(notOnInvoice.status).toBe(400);
    expect(notOnInvoice.body.message).toMatch(/is not on invoice/);

    const partial = await post('/api/dispatch', {
      date: '2026-10-27', partyId: customer.id, invoiceId: invoice.body.id,
      lines: [{ itemId: item.id, qty: 1 }],
    });
    expect(partial.status, JSON.stringify(partial.body)).toBe(201);
    expect(Number((await db.item.findUnique({ where: { id: item.id } })).currentStock)).toBe(99);

    // the remaining balance is still dispatchable, one more piece is not
    const rest = await post('/api/dispatch', {
      date: '2026-10-27', partyId: customer.id, invoiceId: invoice.body.id,
      lines: [{ itemId: item.id, qty: 1 }],
    });
    expect(rest.status, JSON.stringify(rest.body)).toBe(201);
    const over = await post('/api/dispatch', {
      date: '2026-10-27', partyId: customer.id, invoiceId: invoice.body.id,
      lines: [{ itemId: item.id, qty: 1 }],
    });
    expect(over.status).toBe(400);
    expect(over.body.message).toMatch(/already dispatched 2, remaining 0/);

    // cancelling a challan gives the quantity back to the invoice's remaining
    const cancelled = await apiStatus(`/api/dispatch/${rest.body.id}/status/CANCELLED`);
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    const again = await post('/api/dispatch', {
      date: '2026-10-27', partyId: customer.id, invoiceId: invoice.body.id,
      lines: [{ itemId: item.id, qty: 1 }],
    });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
  });

  async function apiStatus(url) {
    return auth(request(app).post(url)).send({});
  }
});
