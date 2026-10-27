'use strict';

// Actual Express handlers + the disposable, schema-driven in-memory adapter.
// This verifies rollback behavior of that adapter, not InnoDB isolation/FKs.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
const { createInMemoryPrisma } = require('../../src/config/inMemoryPrisma');

let app;
let db;
let token;
let customer;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'isolated-transaction-test-secret-only';
  process.env.DATABASE_URL = 'mysql://stub:stub@localhost:3306/stub';
  process.env.UPLOAD_DIR = '/tmp/utech-transaction-test-uploads';
  db = createInMemoryPrisma();
  global.__prisma = db;
  const role = await db.role.create({ data: { name: 'SUPERADMIN', code: 'TEST-SUPERADMIN' } });
  const user = await db.user.create({ data: { name: 'Test Admin', email: 'test@example.invalid', passwordHash: 'not-used', roleId: role.id } });
  customer = await db.party.create({ data: { name: 'Isolated Customer', code: 'TEST-CUSTOMER', type: 'CUSTOMER' } });
  token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  app = (await import('../../src/server')).default;
});

const auth = (r) => r.set('Authorization', `Bearer ${token}`);
const makeInvoice = () => ({
  date: '2026-10-01', partyId: customer.id, isIntraState: true,
  lines: [{ description: 'Transactional test', qty: 2, rate: 50, gstRate: 0 }],
});

async function withInjectedFailure(delegate, method, fn) {
  const original = delegate[method];
  delegate[method] = async () => { throw new Error('Injected database failure'); };
  try { return await fn(); } finally { delegate[method] = original; }
}

describe('transaction failure rollback on isolated in-memory storage', () => {
  it('requires a revised approved quotation to be sent and approved again', async () => {
    const created = await auth(request(app).post('/api/quotations')).send({
      date: '2026-10-01', partyId: customer.id, type: 'CUSTOMER',
      lines: [{ description: 'Quoted part', qty: 1, rate: 100 }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id;
    expect((await auth(request(app).put(`/api/quotations/${id}`)).send({ status: 'SENT' })).status).toBe(200);
    const mixed = await auth(request(app).put(`/api/quotations/${id}`)).send({ status: 'APPROVED', discount: 10 });
    expect(mixed.status).toBe(400);
    let saved = await db.quotation.findUnique({ where: { id } });
    expect([saved.status, Number(saved.discount)]).toEqual(['SENT', 0]);
    expect((await auth(request(app).put(`/api/quotations/${id}`)).send({ status: 'APPROVED' })).status).toBe(200);
    const revised = await auth(request(app).put(`/api/quotations/${id}`)).send({ discount: 10 });
    expect(revised.status).toBe(200);
    expect([revised.body.status, Number(revised.body.total)]).toEqual(['DRAFT', 90]);
    expect((await auth(request(app).post(`/api/quotations/${id}/convert`))).status).toBe(400);
    expect((await auth(request(app).put(`/api/quotations/${id}`)).send({ status: 'SENT' })).status).toBe(200);
    expect((await auth(request(app).put(`/api/quotations/${id}`)).send({ status: 'APPROVED' })).status).toBe(200);
    expect((await auth(request(app).post(`/api/quotations/${id}/convert`))).status).toBe(201);
  });

  it('rolls back invoice and lines if writing its receivable fails', async () => {
    const invoicesBefore = await db.invoice.count();
    const linesBefore = await db.invoiceLine.count();
    const ledgerBefore = await db.partyLedger.count();
    const res = await withInjectedFailure(db.partyLedger, 'create', () =>
      auth(request(app).post('/api/invoices')).send(makeInvoice()));
    expect(res.status).toBe(500);
    expect(await db.invoice.count()).toBe(invoicesBefore);
    expect(await db.invoiceLine.count()).toBe(linesBefore);
    expect(await db.partyLedger.count()).toBe(ledgerBefore);
  });

  it('rolls back an invoice edit and its prior ledger row when ledger replacement fails', async () => {
    const created = await auth(request(app).post('/api/invoices')).send(makeInvoice());
    expect(created.status).toBe(201);
    const id = created.body.id;
    const priorLedger = await db.partyLedger.findMany({ where: { refType: 'invoice', refId: id } });
    const res = await withInjectedFailure(db.partyLedger, 'create', () =>
      auth(request(app).put(`/api/invoices/${id}`)).send({
        lines: [{ description: 'Changed', qty: 1, rate: 300, gstRate: 0 }],
      }));
    expect(res.status).toBe(500);
    const saved = await db.invoice.findUnique({ where: { id }, include: { lines: true } });
    const afterLedger = await db.partyLedger.findMany({ where: { refType: 'invoice', refId: id } });
    expect(Number(saved.total)).toBe(100);
    expect(saved.lines.map((line) => line.description)).toEqual(['Transactional test']);
    expect(afterLedger.map((row) => [row.id, Number(row.debit)])).toEqual(priorLedger.map((row) => [row.id, Number(row.debit)]));
  });

  it('rolls back the invoice balance and payment row if the payment ledger write fails', async () => {
    const created = await auth(request(app).post('/api/invoices')).send(makeInvoice());
    expect(created.status).toBe(201);
    const id = created.body.id;
    const res = await withInjectedFailure(db.partyLedger, 'create', () =>
      auth(request(app).post(`/api/invoices/${id}/payments`)).send({ date: '2026-10-02', amount: 25, mode: 'CASH' }));
    expect(res.status).toBe(500);
    const saved = await db.invoice.findUnique({ where: { id }, include: { payments: true } });
    expect(Number(saved.amountPaid)).toBe(0);
    expect(saved.status).toBe('ISSUED');
    expect(saved.payments).toHaveLength(0);
    expect(await db.partyLedger.count({ where: { refType: 'payment', refId: id } })).toBe(0);
  });

  it('does not allow a GRN to update a different vendor work order line', async () => {
    const vendorA = await db.party.create({ data: { name: 'Vendor A', code: 'TEST-VENDOR-A', type: 'VENDOR' } });
    const vendorB = await db.party.create({ data: { name: 'Vendor B', code: 'TEST-VENDOR-B', type: 'VENDOR' } });
    const makeOrder = (number, partyId) => db.vendorWorkOrder.create({
      data: { number, partyId, status: 'SENT', sentDate: new Date('2026-10-01'), lines: { create: [{ description: 'Part', qtySent: 10 }] } },
      include: { lines: true },
    });
    const first = await makeOrder('VWO-TEST-A', vendorA.id);
    const other = await makeOrder('VWO-TEST-B', vendorB.id);
    const response = await auth(request(app).post('/api/grns')).send({
      date: '2026-10-02', partyId: vendorA.id, vendorWorkOrderId: first.id,
      lines: [{ description: 'Part', qty: 4, vendorWorkOrderLineId: other.lines[0].id }],
    });
    expect(response.status).toBe(400);
    const unchanged = await db.vendorWorkOrderLine.findUnique({ where: { id: other.lines[0].id } });
    expect(Number(unchanged.qtyReceived)).toBe(0);
  });

  it('applies and reverses a valid work-order GRN and rejects over-receipt atomically', async () => {
    const vendor = await db.party.create({ data: { name: 'GRN Vendor', code: 'TEST-VENDOR-GRN', type: 'VENDOR' } });
    const order = await db.vendorWorkOrder.create({
      data: { number: 'VWO-TEST-GRN', partyId: vendor.id, status: 'SENT', sentDate: new Date('2026-10-01'), lines: { create: [{ description: 'Part', qtySent: 10 }] } },
      include: { lines: true },
    });
    const lineId = order.lines[0].id;
    const body = {
      date: '2026-10-02', partyId: vendor.id, vendorWorkOrderId: order.id,
      lines: [{ description: 'Part', qty: 5, qtyAccepted: 4, qtyRejected: 1, vendorWorkOrderLineId: lineId }],
    };
    const valid = await auth(request(app).post('/api/grns')).send(body);
    expect(valid.status, JSON.stringify(valid.body)).toBe(201);
    let line = await db.vendorWorkOrderLine.findUnique({ where: { id: lineId } });
    expect([Number(line.qtyReceived), Number(line.qtyRejected)]).toEqual([4, 1]);
    const over = await auth(request(app).post('/api/grns')).send({ ...body, lines: [{ ...body.lines[0], qty: 6, qtyAccepted: 6, qtyRejected: 0 }] });
    expect(over.status).toBe(400);
    line = await db.vendorWorkOrderLine.findUnique({ where: { id: lineId } });
    expect([Number(line.qtyReceived), Number(line.qtyRejected)]).toEqual([4, 1]);
    const reversed = await auth(request(app).delete(`/api/grns/${valid.body.id}`)).send({ reason: 'Isolated reversal test' });
    expect(reversed.status, JSON.stringify(reversed.body)).toBe(200);
    line = await db.vendorWorkOrderLine.findUnique({ where: { id: lineId } });
    expect([Number(line.qtyReceived), Number(line.qtyRejected)]).toEqual([0, 0]);
  });

  it('refuses to reverse an inconsistent historical work-order receipt instead of clamping its counters', async () => {
    const vendor = await db.party.create({ data: { name: 'Legacy Vendor', code: 'TEST-VENDOR-LEGACY', type: 'VENDOR' } });
    const order = await db.vendorWorkOrder.create({
      data: { number: 'VWO-TEST-LEGACY', partyId: vendor.id, status: 'SENT', sentDate: new Date('2026-10-01'),
        lines: { create: [{ description: 'Part', qtySent: 10 }] } }, include: { lines: true },
    });
    const grn = await db.gRN.create({
      data: { number: 'GRN-TEST-LEGACY', date: new Date('2026-10-02'), partyId: vendor.id, status: 'ACCEPTED', vendorWorkOrderId: order.id,
        lines: { create: [{ description: 'Part', qty: 5, qtyAccepted: 5, qtyRejected: 0, vendorWorkOrderLineId: order.lines[0].id }] } },
    });
    const response = await auth(request(app).delete(`/api/grns/${grn.id}`)).send({ reason: 'Historical discrepancy' });
    expect(response.status).toBe(400);
    expect((await db.gRN.findUnique({ where: { id: grn.id } })).status).toBe('ACCEPTED');
    expect(Number((await db.vendorWorkOrderLine.findUnique({ where: { id: order.lines[0].id } })).qtyReceived)).toBe(0);
  });

  it('automatically links a PO receipt to its actual vendor work order', async () => {
    const vendor = await db.party.create({ data: { name: 'PO Vendor', code: 'TEST-VENDOR-PO', type: 'VENDOR' } });
    const po = await db.purchaseOrder.create({
      data: { number: 'PO-TEST-VWO', partyId: vendor.id, status: 'APPROVED', date: new Date('2026-10-01'),
        lines: { create: [{ description: 'Part', qty: 10, rate: 1, amount: 10, gstRate: 0 }] } },
      include: { lines: true },
    });
    const order = await db.vendorWorkOrder.create({
      data: { number: 'VWO-TEST-PO', partyId: vendor.id, poId: po.id, status: 'SENT', sentDate: new Date('2026-10-01'),
        lines: { create: [{ description: 'Part', qtySent: 10, poLineId: po.lines[0].id }] } },
      include: { lines: true },
    });
    const response = await auth(request(app).post('/api/grns')).send({
      date: '2026-10-02', poId: po.id, partyId: vendor.id,
      lines: [{ description: 'Part', poLineId: po.lines[0].id, qty: 4 }],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.vendorWorkOrderId).toBe(order.id);
    const line = await db.vendorWorkOrderLine.findUnique({ where: { id: order.lines[0].id } });
    expect(Number(line.qtyReceived)).toBe(4);
  });

  it('accepts an exact fractional work-order return and closes it', async () => {
    const vendor = await db.party.create({ data: { name: 'Fraction Vendor', code: 'TEST-VENDOR-FRACTION', type: 'VENDOR' } });
    const order = await db.vendorWorkOrder.create({
      data: { number: 'VWO-TEST-FRACTION', partyId: vendor.id, status: 'SENT', sentDate: new Date('2026-10-01'), lines: { create: [{ description: 'Part', qtySent: 0.3 }] } },
      include: { lines: true },
    });
    const response = await auth(request(app).post(`/api/vendor-work-orders/${order.id}/receive`)).send({
      lines: [{ id: order.lines[0].id, qtyReceived: 0.1, qtyRejected: 0.2 }],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.status).toBe('RECEIVED');
    expect([Number(response.body.lines[0].qtyReceived), Number(response.body.lines[0].qtyRejected)]).toEqual([0.1, 0.2]);
  });

  it('rejects repeated IDs in a vendor-work-order return instead of losing quantities', async () => {
    const vendor = await db.party.create({ data: { name: 'Return Vendor', code: 'TEST-VENDOR-RETURN', type: 'VENDOR' } });
    const order = await db.vendorWorkOrder.create({
      data: { number: 'VWO-TEST-RETURN', partyId: vendor.id, status: 'SENT', sentDate: new Date('2026-10-01'), lines: { create: [{ description: 'Part', qtySent: 10 }] } },
      include: { lines: true },
    });
    const lineId = order.lines[0].id;
    const response = await auth(request(app).post(`/api/vendor-work-orders/${order.id}/receive`)).send({
      lines: [{ id: lineId, qtyReceived: 6 }, { id: lineId, qtyReceived: 6 }],
    });
    expect(response.status).toBe(400);
    const unchanged = await db.vendorWorkOrderLine.findUnique({ where: { id: lineId } });
    expect(Number(unchanged.qtyReceived)).toBe(0);
  });

  it('rolls back job-card line changes if the final job-card write fails', async () => {
    const created = await auth(request(app).post('/api/jobcards')).send({
      date: '2026-10-01', partyId: customer.id,
      lines: [{ itemName: 'First', qty: 1 }, { itemName: 'Second', qty: 2 }],
    });
    expect(created.status).toBe(201);
    const { id, lines } = created.body;
    const res = await withInjectedFailure(db.jobcard, 'update', () =>
      auth(request(app).put(`/api/jobcards/${id}`)).send({ lines: [{ id: lines[0].id, itemName: 'Changed', qty: 5 }] }));
    expect(res.status).toBe(500);
    const saved = await db.jobcard.findUnique({ where: { id }, include: { lines: { orderBy: { id: 'asc' } } } });
    expect(saved.lines.map((line) => [line.itemName, Number(line.qty)])).toEqual([['First', 1], ['Second', 2]]);
  });
});
