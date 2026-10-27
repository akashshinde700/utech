'use strict';

// Focused regressions for confirmed ERP audit findings. The Prisma API tests use
// a programmable fake; they do not claim to exercise MySQL decimal storage.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, makeUser, signInAs, loadApp } from '../helpers/app';

let app;
let token;
const fileName = `audit-private-${process.pid}.png`;
let filePath;

beforeAll(async () => {
  app = await loadApp();
  filePath = path.join(process.env.UPLOAD_DIR, fileName);
  fs.writeFileSync(filePath, Buffer.from('private test attachment'));
});

afterAll(() => { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); });

beforeEach(() => {
  getDb().reset();
  token = signInAs(makeUser({ role: 'SUPERADMIN' }));
  getDb().when('party.findUnique', { id: 1, type: 'CUSTOMER', name: 'Test customer' });
  getDb().when('invoice.create', (args) => ({ id: 11, ...args[0].data }));
});

const auth = (r) => r.set('Authorization', `Bearer ${token}`);
const invoice = (line, extra = {}) => ({
  date: '2026-10-01', partyId: 1, isIntraState: true,
  lines: [{ description: 'Machining', qty: 1, rate: 10, gstRate: 18, ...line }],
  ...extra,
});

describe('invoice rounding and database precision', () => {
  it('rounds a half-paisa line from an exact decimal product', async () => {
    const res = await auth(request(app).post('/api/invoices')).send(invoice({ qty: 0.5, rate: 20.15, gstRate: 0 }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(getDb().calls('invoice.create')[0][0].data.lines.create[0].amount).toBe(10.08);
    expect(getDb().calls('invoice.create')[0][0].data.subtotal).toBe(10.08);
  });

  it.each([
    ['quantity', { qty: 1.0001 }, {}],
    ['rate', { rate: 12.345 }, {}],
    ['GST rate', { gstRate: 18.001 }, {}],
    ['discount', {}, { discount: 0.001 }],
    ['a discount larger than the subtotal', {}, { discount: 11 }],
    ['a line amount larger than the money column', { qty: 99999999999, rate: 999999999999 }, {}],
  ])('rejects %s instead of silently storing a different value', async (_name, line, extra) => {
    const res = await auth(request(app).post('/api/invoices')).send(invoice(line, extra));
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(getDb().calls('invoice.create')).toHaveLength(0);
  });
});

describe('quotation conversion authorization and approval', () => {
  const quotation = {
    id: 5, number: 'QT-26-00005', type: 'CUSTOMER', status: 'APPROVED', partyId: 1,
    subtotal: 100, cgst: 0, sgst: 0, igst: 0, discount: 0, total: 100,
    lines: [{ description: 'Work', qty: 1, rate: 100, gstRate: 0, amount: 100 }],
  };

  it('rejects quotation values that cannot be represented in its invoice columns', async () => {
    const res = await auth(request(app).post('/api/quotations')).send({
      date: '2026-10-01', partyId: 1, type: 'CUSTOMER',
      lines: [{ description: 'Work', qty: 1.0001, rate: 10 }],
    });
    expect(res.status).toBe(400);
    expect(getDb().calls('quotation.create')).toHaveLength(0);
  });

  it('persists and recomputes a discount-only quotation edit', async () => {
    getDb().when('quotation.findUnique', { ...quotation, status: 'DRAFT' });
    const res = await auth(request(app).put('/api/quotations/5')).send({ discount: 10 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const data = getDb().calls('quotation.update')[0][0].data;
    expect(data.discount).toBe(10);
    expect(data.total).toBe(90);
  });

  it('rejects conversion of a legacy quote with an excess discount and negative total', async () => {
    getDb().when('quotation.findUnique', { ...quotation, discount: 200, total: -100 });
    const res = await auth(request(app).post('/api/quotations/5/convert'));
    expect(res.status).toBe(400);
    expect(getDb().calls('invoice.create')).toHaveLength(0);
  });

  it('persists the UI transition from draft to sent', async () => {
    getDb().when('quotation.findUnique', { ...quotation, status: 'DRAFT' });
    const res = await auth(request(app).put('/api/quotations/5')).send({ status: 'SENT' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(getDb().calls('quotation.update')[0][0].data.status).toBe('SENT');
  });

  it('rejects skipping from draft directly to approved', async () => {
    getDb().when('quotation.findUnique', { ...quotation, status: 'DRAFT' });
    const res = await auth(request(app).put('/api/quotations/5')).send({ status: 'APPROVED' });
    expect(res.status).toBe(400);
    expect(getDb().calls('quotation.update')).toHaveLength(0);
  });

  it('cannot link a quotation by bypassing the approved conversion endpoint', async () => {
    token = signInAs(makeUser({ role: 'INVOICE_CREATOR', permissions: ['invoice.create'] }));
    const res = await auth(request(app).post('/api/invoices')).send(invoice({}, { quotationId: 5 }));
    expect(res.status).toBe(400);
    expect(getDb().calls('invoice.create')).toHaveLength(0);
  });

  it('cannot attach or detach a quotation through an invoice edit', async () => {
    const res = await auth(request(app).put('/api/invoices/11')).send({ quotationId: null });
    expect(res.status).toBe(400);
    expect(getDb().calls('invoice.updateMany')).toHaveLength(0);
  });

  it('requires invoice creation permission in addition to quotation update', async () => {
    token = signInAs(makeUser({ role: 'QUOTE_EDITOR', permissions: ['customerQuotation.update'] }));
    getDb().when('quotation.findUnique', quotation);
    const res = await auth(request(app).post('/api/quotations/5/convert'));
    expect(res.status).toBe(403);
    expect(getDb().calls('invoice.create')).toHaveLength(0);
  });

  it('does not create an invoice from an unapproved quotation', async () => {
    token = signInAs(makeUser({ role: 'BILLING', permissions: ['customerQuotation.update', 'invoice.create'] }));
    getDb().when('quotation.findUnique', { ...quotation, status: 'DRAFT' });
    const res = await auth(request(app).post('/api/quotations/5/convert'));
    expect(res.status).toBe(400);
    expect(getDb().calls('invoice.create')).toHaveLength(0);
  });

  it('allows an authorized user to convert an approved customer quotation', async () => {
    token = signInAs(makeUser({ role: 'BILLING', permissions: ['customerQuotation.update', 'invoice.create'] }));
    getDb().when('quotation.findUnique', quotation);
    const res = await auth(request(app).post('/api/quotations/5/convert'));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(getDb().calls('invoice.create')).toHaveLength(1);
    expect(getDb().calls('partyLedger.create')).toHaveLength(1);
  });
});

describe('cross-module GRN authorization', () => {
  it('requires work-order update access for a direct non-PO work-order return', async () => {
    token = signInAs(makeUser({ role: 'GRN_CLERK', permissions: ['grn.create'] }));
    const orderLine = { id: 72, vendorWorkOrderId: 71, qtySent: 10, qtyReceived: 0, qtyRejected: 0 };
    getDb().when('vendorWorkOrder.findUnique', {
      id: 71, partyId: 3, status: 'SENT', poId: null, lines: [orderLine],
    });
    getDb().when('vendorWorkOrderLine.findUnique', orderLine);
    getDb().when('gRN.create', (args) => ({ id: 73, ...args[0].data, lines: args[0].data.lines.create }));
    const res = await auth(request(app).post('/api/grns')).send({
      date: '2026-10-01', partyId: 3, vendorWorkOrderId: 71,
      lines: [{ description: 'Part', qty: 1, vendorWorkOrderLineId: 72 }],
    });
    expect(res.status).toBe(403);
    expect(getDb().calls('gRN.create')).toHaveLength(0);
  });

  it('enforces department scope on a direct work-order GRN', async () => {
    token = signInAs(makeUser({ role: 'SUPERVISOR', permissions: ['grn.create', 'vendorWorkOrder.update'], scopeToDepartment: true, hierarchyLevel: 4, departmentId: 1 }));
    getDb().when('vendorWorkOrder.findUnique', { id: 71, partyId: 3, status: 'SENT', poId: null, departmentId: 2, lines: [] });
    const res = await auth(request(app).post('/api/grns')).send({
      date: '2026-10-01', partyId: 3, vendorWorkOrderId: 71, lines: [{ description: 'Part', qty: 1 }],
    });
    expect(res.status).toBe(403);
    expect(getDb().calls('gRN.create')).toHaveLength(0);
  });
});

describe('uploaded business documents cannot bypass authorization', () => {
  it('does not expose a stored file through the unauthenticated static path', async () => {
    const res = await request(app).get(`/uploads/${fileName}`);
    expect(res.status).toBe(404);
  });

  it('does not let a quotation reader retrieve an unrelated attachment as an image', async () => {
    token = signInAs(makeUser({ role: 'QUOTATION_READER', permissions: ['customerQuotation.read'] }));
    getDb().when('attachment.findFirst', { id: 22, storedName: fileName });
    const res = await auth(request(app).get(`/api/quotation-templates/image/${fileName}`));
    expect(res.status).toBe(404);
  });

  it('still permits an authorized document download via its checked API', async () => {
    getDb().when('attachment.findUnique', { id: 22, refType: 'INVOICE', refId: 3, filename: 'document.png', storedName: fileName });
    const res = await auth(request(app).get('/api/attachments/file/22'));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
  });

  it('serves a newly uploaded quotation image to an authorized reader', async () => {
    token = signInAs(makeUser({ role: 'QUOTATION_EDITOR', permissions: ['customerQuotation.create', 'customerQuotation.read'] }));
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');
    const upload = await auth(request(app).post('/api/quotation-templates/upload-image'))
      .attach('file', bytes, { filename: 'header.png', contentType: 'image/png' });
    expect(upload.status).toBe(201);
    const uploadedPath = path.join(process.env.UPLOAD_DIR, upload.body.storedName);
    try {
      expect(upload.body.storedName).toMatch(/^quotation-[0-9a-f-]+\.png$/);
      const res = await auth(request(app).get(`/api/quotation-templates/image/${upload.body.storedName}`));
      expect(res.status).toBe(200);
      expect(res.body).toEqual(bytes);
    } finally { if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath); }
  });

  it('serves a referenced legacy quotation image, but not an unreferenced legacy file', async () => {
    token = signInAs(makeUser({ role: 'QUOTATION_READER', permissions: ['customerQuotation.read'] }));
    getDb().when('quotationTemplate.findFirst', { id: 42 });
    let res = await auth(request(app).get(`/api/quotation-templates/image/${fileName}`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(Buffer.from('private test attachment'));
    getDb().when('quotationTemplate.findFirst', null);
    res = await auth(request(app).get(`/api/quotation-templates/image/${fileName}`));
    expect(res.status).toBe(404);
  });
});
