'use strict';
// Disposable schema-driven in-memory database (same harness as the allocation
// suite): rules, not InnoDB semantics. Row locks and isolation are verified
// separately against a real MySQL.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
const { createInMemoryPrisma } = require('../../src/config/inMemoryPrisma');

// The three manufacturing rules the plant decided on (2026-10-27):
//   MFG-04  production batches own the job card's produced/rejected quantity,
//           and a project cannot close with nothing produced
//   MFG-05  rejected pieces are written off to the scrap register
//   QC-02   quality must have passed before a project closes

let app, db, token;
const auth = (r) => r.set('Authorization', `Bearer ${token}`);

let shift, item, jobcard;

async function completedBatch({ jobcardId, qtyProduced, qtyRejected }) {
  const created = await auth(request(app).post('/api/production/batches')).send({
    date: '2026-10-27', shiftId: shift.id, itemId: item.id, jobcardId, qtyPlanned: qtyProduced + qtyRejected,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect((await auth(request(app).post(`/api/production/batches/${created.body.id}/start`))).status).toBe(200);
  const done = await auth(request(app).post(`/api/production/batches/${created.body.id}/complete`))
    .send({ qtyProduced, qtyRejected });
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return done.body;
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'production-output-rules-test-secret';
  process.env.DATABASE_URL = 'mysql://stub:stub@localhost:3306/stub';
  process.env.UPLOAD_DIR = '/tmp/utech-production-rules-uploads';
  db = createInMemoryPrisma();
  global.__prisma = db;
  const role = await db.role.create({ data: { name: 'SUPERADMIN' } });
  const user = await db.user.create({ data: { name: 'Rules Admin', email: 'rules@example.invalid', passwordHash: 'x', roleId: role.id } });
  token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  app = (await import('../../src/server')).default;

  shift = await db.shift.create({ data: { code: 'S-OUT', name: 'Output shift', startTime: '06:00', endTime: '14:00' } });
  item = await db.item.create({ data: { code: 'IT-OUT-1', name: 'Output item', currentStock: 0 } });
  const jc = await auth(request(app).post('/api/jobcards')).send({ date: '2026-10-27' });
  expect(jc.status, JSON.stringify(jc.body)).toBe(201);
  jobcard = jc.body;
});

describe('MFG-04 — the batch owns the job card quantity', () => {
  it('rolls a completed batch up into the job card', async () => {
    await completedBatch({ jobcardId: jobcard.id, qtyProduced: 8, qtyRejected: 2 });
    const after = await db.jobcard.findUnique({ where: { id: jobcard.id } });
    expect(Number(after.qtyProduced)).toBe(8);
    expect(Number(after.qtyRejected)).toBe(2);
  });

  it('adds a second batch to the total instead of replacing it', async () => {
    await completedBatch({ jobcardId: jobcard.id, qtyProduced: 5, qtyRejected: 1 });
    const after = await db.jobcard.findUnique({ where: { id: jobcard.id } });
    expect(Number(after.qtyProduced)).toBe(13);
    expect(Number(after.qtyRejected)).toBe(3);
  });

  it('refuses a hand-typed produced quantity on the job card', async () => {
    const res = await auth(request(app).put(`/api/jobcards/${jobcard.id}`))
      .send({ remarks: 'edit', qtyProduced: 999, qtyRejected: 999 });
    expect(res.status).toBe(200);
    const after = await db.jobcard.findUnique({ where: { id: jobcard.id } });
    expect(Number(after.qtyProduced)).toBe(13);
    expect(Number(after.qtyRejected)).toBe(3);
  });
});

describe('MFG-05 — rejected pieces reach the scrap register', () => {
  it('books the rejected quantity in against the scrap item', async () => {
    const scrap = await db.item.findUnique({ where: { code: 'SCRAP' } });
    expect(scrap, 'the scrap item is created on first use').toBeTruthy();
    expect(Number(scrap.currentStock)).toBe(3); // 2 + 1 from the two batches
    const moves = await db.stockLedger.findMany({ where: { itemId: scrap.id } });
    expect(moves.length).toBe(2);
    expect(moves.every((m) => Number(m.qtyIn) > 0 && Number(m.qtyOut) === 0)).toBe(true);
    expect(moves.every((m) => m.refType === 'SCRAP')).toBe(true);
  });

  it('leaves the finished item holding only the good pieces', async () => {
    const produced = await db.item.findUnique({ where: { id: item.id } });
    expect(Number(produced.currentStock)).toBe(13);
  });
});

describe('QC-02 / MFG-04 — what a project needs before it can close', () => {
  it('refuses a project with no production at all', async () => {
    const empty = (await auth(request(app).post('/api/jobcards')).send({ date: '2026-10-27' })).body;
    const res = await auth(request(app).post(`/api/jobcards/${empty.id}/complete`));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no production recorded/i);
  });

  it('refuses a project that has output but no quality check', async () => {
    const res = await auth(request(app).post(`/api/jobcards/${jobcard.id}/complete`));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/quality check/i);
  });

  it('refuses while a quality check is still pending or failed', async () => {
    const qc = await db.qualityCheck.create({ data: {
      number: 'QC-OUT-1', date: new Date(), refType: 'JOBCARD', refId: jobcard.id, result: 'PENDING',
    } });
    let res = await auth(request(app).post(`/api/jobcards/${jobcard.id}/complete`));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/PENDING/);

    await db.qualityCheck.update({ where: { id: qc.id }, data: { result: 'FAIL' } });
    res = await auth(request(app).post(`/api/jobcards/${jobcard.id}/complete`));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/FAIL/);

    await db.qualityCheck.update({ where: { id: qc.id }, data: { result: 'PASS' } });
  });

  it('closes once production is recorded and quality has passed', async () => {
    const res = await auth(request(app).post(`/api/jobcards/${jobcard.id}/complete`));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
  });
});
