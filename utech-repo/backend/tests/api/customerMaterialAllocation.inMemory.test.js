'use strict';
// Disposable schema-driven in-memory database: not an InnoDB isolation test.
import { beforeAll, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
const { createInMemoryPrisma } = require('../../src/config/inMemoryPrisma');
let app, db, token, customer;
const auth = (r) => r.set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'isolated-allocation-test-secret-only';
  process.env.DATABASE_URL = 'mysql://stub:stub@localhost:3306/stub';
  process.env.UPLOAD_DIR = '/tmp/utech-allocation-test-uploads';
  db = createInMemoryPrisma();
  global.__prisma = db;
  const role = await db.role.create({ data: { name: 'SUPERADMIN' } });
  const user = await db.user.create({ data: { name: 'Test Admin', email: 'allocation@example.invalid', passwordHash: 'not-used', roleId: role.id } });
  customer = await db.party.create({ data: { name: 'Test Customer', code: 'ALLOC-C', type: 'CUSTOMER' } });
  token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  app = (await import('../../src/server')).default;
});

async function setupLot(weight = 50) {
  const lot = await auth(request(app).post('/api/customer-material')).send({
    customerId: customer.id, materialDescription: 'Isolated stock', qty: 100, weight, receivedDate: '2026-10-01',
  });
  expect(lot.status, JSON.stringify(lot.body)).toBe(201);
  const cards = await Promise.all([1, 2, 3].map(() => auth(request(app).post('/api/jobcards')).send({ date: '2026-10-01', partyId: customer.id })));
  for (const card of cards) expect(card.status).toBe(201);
  return { lot: lot.body, cards: cards.map((card) => card.body) };
}
const reserve = (lotId, jobcardId, qty, weight) => auth(request(app).post(`/api/customer-material/${lotId}/allocations`)).send({ jobcardId, qty, weight });
const get = (id) => auth(request(app).get(`/api/customer-material/${id}`));

it('reserves measured quantity and weight across cards without overspending, and protects them from stock movements', async () => {
  const { lot, cards } = await setupLot();
  const first = await reserve(lot.id, cards[0].id, 40, 20);
  const second = await reserve(lot.id, cards[1].id, 30, 15);
  expect([first.status, second.status]).toEqual([201, 201]);
  let saved = (await get(lot.id)).body;
  expect([saved.availableQty, saved.currentWeight, saved.reservedQty, saved.reservedWeight, saved.unallocatedQty, saved.unallocatedWeight]).toEqual([100, 50, 70, 35, 30, 15]);
  const listed = await auth(request(app).get('/api/customer-material'));
  const row = listed.body.items.find((item) => item.id === lot.id);
  expect([row.availableQty, row.unallocatedQty, row.unallocatedWeight]).toEqual([100, 30, 15]);
  expect((await reserve(lot.id, cards[2].id, 31, 1)).status).toBe(400);
  expect((await reserve(lot.id, cards[2].id, 1, 16)).status).toBe(400);
  const good = await auth(request(app).post(`/api/customer-material/${lot.id}/consume`)).send({ qty: 20, weight: 10 });
  expect(good.status).toBe(200);
  saved = (await get(lot.id)).body;
  expect([saved.availableQty, saved.currentWeight, saved.unallocatedQty, saved.unallocatedWeight]).toEqual([80, 40, 10, 5]);
  expect((await auth(request(app).post(`/api/customer-material/${lot.id}/consume`)).send({ qty: 11, weight: 1 })).status).toBe(400);
  expect((await auth(request(app).post(`/api/customer-material/${lot.id}/consume`)).send({ qty: 10, weight: 6 })).status).toBe(400);
  expect((await auth(request(app).post(`/api/customer-material/${lot.id}/consume`)).send({ qty: 1 })).status).toBe(400);
  saved = (await get(lot.id)).body;
  expect([saved.availableQty, saved.currentWeight, saved.allocations.filter((a) => !a.releasedAt).length]).toEqual([80, 40, 2]);
  const released = await auth(request(app).post(`/api/customer-material/${lot.id}/allocations/${first.body.id}/release`)).send({ reason: 'Unused reservation' });
  expect(released.status).toBe(200);
  saved = (await get(lot.id)).body;
  expect([saved.unallocatedQty, saved.unallocatedWeight]).toEqual([50, 25]);
  expect((await auth(request(app).post(`/api/customer-material/${lot.id}/allocations/${first.body.id}/release`)).send({ reason: 'Repeated request' })).status).toBe(400);
});

it('treats missing or unmeasured weight as unknown until an explicit reconciliation', async () => {
  const { lot, cards } = await setupLot(null);
  expect((await get(lot.id)).body.unallocatedWeight).toBeNull();
  expect((await reserve(lot.id, cards[0].id, 10, 2)).status).toBe(400);
  const baseline = await auth(request(app).post(`/api/customer-material/${lot.id}/reconcile-weight`)).send({ weight: 30, reason: 'Measured on-hand' });
  expect(baseline.status).toBe(200);
  expect((await reserve(lot.id, cards[0].id, 10, 2)).status).toBe(201);
  expect((await auth(request(app).post(`/api/customer-material/${lot.id}/reconcile-weight`)).send({ weight: 1, reason: 'Below reserved' })).status).toBe(400);
});

it('rolls back reservations, releases and reconciliations when their required audit write fails', async () => {
  const { lot, cards } = await setupLot();
  const original = db.auditLog.create;
  async function failAudit(callback) {
    db.auditLog.create = async () => { throw new Error('Injected audit failure'); };
    try { return await callback(); } finally { db.auditLog.create = original; }
  }
  expect((await failAudit(() => reserve(lot.id, cards[0].id, 10, 5))).status).toBe(500);
  expect((await get(lot.id)).body.reservedQty).toBe(0);
  const created = await reserve(lot.id, cards[0].id, 10, 5);
  expect(created.status).toBe(201);
  expect((await failAudit(() => auth(request(app).post(`/api/customer-material/${lot.id}/allocations/${created.body.id}/release`)).send({ reason: 'Unused material' }))).status).toBe(500);
  expect((await get(lot.id)).body.reservedQty).toBe(10);
  expect((await failAudit(() => auth(request(app).post(`/api/customer-material/${lot.id}/reconcile-weight`)).send({ weight: 45, reason: 'Measured on hand' }))).status).toBe(500);
  const saved = (await get(lot.id)).body;
  expect([saved.currentWeight, saved.stockLedger.length]).toEqual([50, 1]);
});

it('restricts reservation details and mutations to users who can read the linked job card', async () => {
  const { lot, cards } = await setupLot();
  const first = await reserve(lot.id, cards[0].id, 10, 5);
  await reserve(lot.id, cards[1].id, 20, 10);
  async function makeUser(name, keys) {
    const role = await db.role.create({ data: { name } });
    for (const key of keys) {
      let permission = await db.permission.findUnique({ where: { key } });
      if (!permission) permission = await db.permission.create({ data: { key, module: key.split('.')[0], action: key.split('.')[1] } });
      await db.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    const user = await db.user.create({ data: { name, email: `${name.replace(/\s+/g, '-')}@example.invalid`, passwordHash: 'not-used', roleId: role.id } });
    return { user, token: jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
  }
  const store = await makeUser('STORE', ['customerMaterial.read', 'customerMaterial.update']);
  const storeGet = await request(app).get(`/api/customer-material/${lot.id}`).set('Authorization', `Bearer ${store.token}`);
  expect(storeGet.status).toBe(200);
  expect(storeGet.body.allocations).toEqual([]);
  expect([storeGet.body.reservedQty, storeGet.body.allocationDetailsRestricted]).toEqual([30, true]);
  expect((await request(app).post(`/api/customer-material/${lot.id}/allocations/${first.body.id}/release`).set('Authorization', `Bearer ${store.token}`).send({ reason: 'Test' })).status).toBe(403);

  const operator = await makeUser('OPERATOR', ['customerMaterial.read', 'customerMaterial.update', 'jobcard.read', 'jobcard.update', 'jobcard.delete']);
  const opRequest = (method, path) => request(app)[method](path).set('Authorization', `Bearer ${operator.token}`);
  expect((await opRequest('delete', `/api/jobcards/${cards[2].id}`)).status).toBe(403);
  expect((await opRequest('post', `/api/jobcards/${cards[2].id}/revert`).send({ reason: 'Not assigned' })).status).toBe(403);
  expect((await opRequest('post', `/api/customer-material/${lot.id}/allocations/${first.body.id}/release`).send({ reason: 'Not assigned' })).status).toBe(403);
  expect((await opRequest('post', `/api/customer-material/${lot.id}/allocations`).send({ jobcardId: cards[2].id, qty: 1, weight: 1 })).status).toBe(403);
  await db.jobcard.update({ where: { id: cards[0].id }, data: { assignedOperatorId: operator.user.id } });
  const visible = await opRequest('get', `/api/customer-material/${lot.id}`);
  expect(visible.body.allocations.map((a) => a.jobcardId)).toEqual([cards[0].id]);
  expect(visible.body.allocationDetailsRestricted).toBe(true);
  expect((await opRequest('post', `/api/customer-material/${lot.id}/allocations/${first.body.id}/release`).send({ reason: 'Assigned work unused' })).status).toBe(200);

  const engineer = await makeUser('Project Engineer', ['jobcard.read', 'jobcard.update', 'assignment.create']);
  const engRequest = (method, path) => request(app)[method](path).set('Authorization', `Bearer ${engineer.token}`);
  const attachment = await db.attachment.create({ data: { refType: 'JOBCARD', refId: cards[2].id, filename: 'drawing.pdf', storedName: 'drawing.pdf', mimeType: 'application/pdf', size: 1 } });
  expect((await engRequest('get', `/api/attachments/JOBCARD/${cards[2].id}`)).status).toBe(403);
  expect((await engRequest('get', `/api/attachments/file/${attachment.id}`)).status).toBe(403);
  expect((await engRequest('post', '/api/assignments').send({ attachmentId: attachment.id, assignedToId: operator.user.id })).status).toBe(403);
  await db.jobcard.update({ where: { id: cards[2].id }, data: { assignedOperatorId: engineer.user.id } });
  expect((await engRequest('get', `/api/attachments/JOBCARD/${cards[2].id}`)).status).toBe(200);
  expect((await engRequest('post', '/api/assignments').send({ attachmentId: attachment.id, assignedToId: operator.user.id })).status).toBe(201);
});

it('tracks explicitly measured vendor issues and returns while protecting reservations', async () => {
  const { lot, cards } = await setupLot();
  expect((await reserve(lot.id, cards[0].id, 20, 10)).status).toBe(201);
  const vendor = await db.party.create({ data: { name: 'Test Vendor', code: 'ALLOC-V', type: 'VENDOR' } });
  const issue = (weightSent) => auth(request(app).post('/api/jobwork')).send({
    date: '2026-10-01', partyId: vendor.id, materialOwnerType: 'CUSTOMER', customerMaterialLotId: lot.id,
    lines: [{ description: 'Part', qtySent: 50, ...(weightSent === undefined ? {} : { weightSent }) }],
  });
  expect((await issue(undefined)).status).toBe(400);
  let saved = (await get(lot.id)).body;
  expect([saved.availableQty, saved.currentWeight, saved.stockLedger.length]).toEqual([100, 50, 1]);
  const sent = await issue(25);
  expect(sent.status, JSON.stringify(sent.body)).toBe(201);
  saved = (await get(lot.id)).body;
  expect([saved.availableQty, saved.currentWeight, saved.unallocatedQty, saved.unallocatedWeight]).toEqual([50, 25, 30, 15]);
  const returned = await auth(request(app).post(`/api/jobwork/${sent.body.id}/receive`)).send({
    lines: [{ id: sent.body.lines[0].id, qtyReceived: 25, qtyRejected: 25, weightReceived: 12, weightRejected: 13 }],
  });
  expect(returned.status, JSON.stringify(returned.body)).toBe(200);
  saved = (await get(lot.id)).body;
  expect([saved.availableQty, saved.currentWeight, saved.unallocatedQty, saved.unallocatedWeight]).toEqual([100, 50, 80, 40]);
  expect(saved.stockLedger.map((entry) => entry.weightBalance)).toEqual([50, 25, 37, 50]);
});

it('marks on-hand weight unknown after an unmeasured movement rather than guessing', async () => {
  const { lot, cards } = await setupLot();
  expect((await auth(request(app).post(`/api/customer-material/${lot.id}/consume`)).send({ qty: 10 })).status).toBe(200);
  const saved = (await get(lot.id)).body;
  expect([saved.availableQty, saved.currentWeight, saved.unallocatedWeight]).toEqual([90, null, null]);
  expect((await reserve(lot.id, cards[0].id, 1, 1)).status).toBe(400);
});

it('requires release before cancelling, completing or changing a reserved job card', async () => {
  const { lot, cards } = await setupLot();
  const allocation = await reserve(lot.id, cards[0].id, 10, 5);
  expect(allocation.status).toBe(201);
  const id = cards[0].id;
  const refused = await auth(request(app).delete(`/api/jobcards/${id}`));
  expect(refused.status).toBe(400);
  // the refusal has to say HOW MUCH is in the way: "something is reserved" does
  // not tell anyone whether this is one stale row or live work
  expect(refused.body.message).toBe('Release the 1 customer-material reservation on this job card before cancelling it');
  expect((await auth(request(app).put(`/api/jobcards/${id}`)).send({ status: 'COMPLETED' })).status).toBe(400);
  expect((await auth(request(app).post(`/api/jobcards/${id}/complete`))).status).toBe(400);
  expect((await auth(request(app).put(`/api/jobcards/${id}`)).send({ partyId: null })).status).toBe(400);
  const released = await auth(request(app).post(`/api/customer-material/${lot.id}/allocations/${allocation.body.id}/release`)).send({ reason: 'Work cancelled' });
  expect(released.status).toBe(200);
  expect((await auth(request(app).put(`/api/jobcards/${id}`)).send({ status: 'COMPLETED' })).status).toBe(400);
  expect((await auth(request(app).put(`/api/jobcards/${id}`)).send({ status: 'CANCELLED' })).status).toBe(400);
  expect((await auth(request(app).delete(`/api/jobcards/${id}`))).status).toBe(200);
  expect((await auth(request(app).put(`/api/jobcards/${id}`)).send({ status: 'DRAFT' })).status).toBe(400);
  // Reservation history is retained rather than deleted with a job card.
  expect((await auth(request(app).delete(`/api/jobcards/${id}`))).status).toBe(400);
  expect((await get(lot.id)).body.allocations).toHaveLength(1);
});

it('prevents new or reopened drawing assignments after job-card completion', async () => {
  const { cards } = await setupLot();
  const id = cards[0].id;
  const admin = await db.user.findUnique({ where: { email: 'allocation@example.invalid' } });
  const attachment = await db.attachment.create({ data: {
    refType: 'JOBCARD', refId: id, filename: 'test.pdf', storedName: 'test.pdf', mimeType: 'application/pdf', size: 1,
  } });
  const originalNotification = db.notification.create;
  db.notification.create = async () => { throw new Error('Injected notification failure'); };
  try {
    expect((await auth(request(app).post('/api/assignments')).send({ attachmentId: attachment.id, assignedToId: admin.id })).status).toBe(500);
    expect(await db.assignment.count({ where: { attachmentId: attachment.id } })).toBe(0);
  } finally { db.notification.create = originalNotification; }
  const created = await auth(request(app).post('/api/assignments')).send({ attachmentId: attachment.id, assignedToId: admin.id });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect((await auth(request(app).post(`/api/jobcards/${id}/complete`))).status).toBe(400);
  await db.assignment.update({ where: { id: created.body.id }, data: { status: 'COMPLETED' } });
  // MFG-04 + QC-02: completion now also needs recorded production output and a
  // passed quality check. This test is about assignments, so satisfy both
  // directly instead of running a whole production batch through the API.
  expect((await auth(request(app).post(`/api/jobcards/${id}/complete`))).status).toBe(400);
  await db.jobcard.update({ where: { id }, data: { qtyProduced: 5 } });
  expect((await auth(request(app).post(`/api/jobcards/${id}/complete`))).status).toBe(400);
  await db.qualityCheck.create({ data: {
    number: `QC-COMPLETE-${id}`, date: new Date(), refType: 'JOBCARD', refId: id, result: 'PASS',
  } });
  expect((await auth(request(app).post(`/api/jobcards/${id}/complete`))).status).toBe(200);
  expect((await auth(request(app).post(`/api/assignments/${created.body.id}/reopen`)).send({ reason: 'Needs work' })).status).toBe(400);
  expect((await auth(request(app).post('/api/assignments')).send({ attachmentId: attachment.id, assignedToId: admin.id, pageNumbers: [2] })).status).toBe(400);
  expect((await auth(request(app).post(`/api/jobcards/${id}/revert`)).send({ reason: 'Needs work' })).status).toBe(200);
  db.notification.create = async () => { throw new Error('Injected notification failure'); };
  try {
    expect((await auth(request(app).post(`/api/assignments/${created.body.id}/reopen`)).send({ reason: 'Needs work' })).status).toBe(500);
    expect((await db.assignment.findUnique({ where: { id: created.body.id } })).status).toBe('COMPLETED');
  } finally { db.notification.create = originalNotification; }
  expect((await auth(request(app).post(`/api/assignments/${created.body.id}/reopen`)).send({ reason: 'Needs work' })).status).toBe(200);
});

it('protects drawing work from job-card line removal and cancellation', async () => {
  const { cards } = await setupLot();
  const cardId = cards[0].id;
  const admin = await db.user.findUnique({ where: { email: 'allocation@example.invalid' } });
  const line = await db.jobcardLine.create({ data: { jobcardId: cardId, itemName: 'Attached line', qty: 1 } });
  const attachment = await db.attachment.create({ data: {
    refType: 'JOBCARD', refId: cardId, lineId: line.id, filename: 'drawing.pdf', storedName: 'drawing.pdf', mimeType: 'application/pdf', size: 1,
  } });
  const assigned = await auth(request(app).post('/api/assignments')).send({ attachmentId: attachment.id, assignedToId: admin.id });
  expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
  expect((await auth(request(app).put(`/api/jobcards/${cardId}`)).send({ lines: [] })).status).toBe(400);
  expect(await db.jobcardLine.findUnique({ where: { id: line.id } })).not.toBeNull();
  expect(await db.attachment.findUnique({ where: { id: attachment.id } })).not.toBeNull();
  expect((await auth(request(app).delete(`/api/jobcards/${cardId}`))).status).toBe(400);
  expect((await db.assignment.findUnique({ where: { id: assigned.body.id } })).status).toBe('ASSIGNED');
  expect((await auth(request(app).delete(`/api/assignments/${assigned.body.id}`))).status).toBe(200);
  expect((await auth(request(app).delete(`/api/jobcards/${cardId}`))).status).toBe(200);
});

it('does not delete an attachment while a new drawing assignment is open', async () => {
  const { cards } = await setupLot();
  const admin = await db.user.findUnique({ where: { email: 'allocation@example.invalid' } });
  const attachment = await db.attachment.create({ data: {
    refType: 'JOBCARD', refId: cards[0].id, filename: 'race.pdf', storedName: 'race.pdf', mimeType: 'application/pdf', size: 1,
  } });
  const old = await db.assignment.create({ data: { attachmentId: attachment.id, assignedById: admin.id, assignedToId: admin.id, status: 'COMPLETED' } });
  const [created, removed] = await Promise.all([
    auth(request(app).post('/api/assignments')).send({ attachmentId: attachment.id, assignedToId: admin.id, pageNumbers: [2] }),
    auth(request(app).delete(`/api/attachments/file/${attachment.id}`)),
  ]);
  expect([[201, 400], [404, 200]]).toContainEqual([created.status, removed.status]);
  if (created.status === 201) {
    expect(await db.attachment.findUnique({ where: { id: attachment.id } })).not.toBeNull();
    expect((await db.assignment.findUnique({ where: { id: created.body.id } })).status).toBe('ASSIGNED');
    expect(await db.assignment.findUnique({ where: { id: old.id } })).not.toBeNull();
  }
});

it('cannot reserve the same quantity twice in concurrent demo transactions', async () => {
  const { lot, cards } = await setupLot();
  const responses = await Promise.all([reserve(lot.id, cards[0].id, 60, 20), reserve(lot.id, cards[1].id, 60, 20)]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
  const saved = (await get(lot.id)).body;
  expect([saved.reservedQty, saved.unallocatedQty, saved.reservedWeight, saved.unallocatedWeight]).toEqual([60, 40, 20, 30]);
});

it('names how many open drawing assignments are blocking a job-card cancellation', async () => {
  const { cards } = await setupLot();
  const id = cards[0].id;
  const assignee = await db.user.findUnique({ where: { email: 'allocation@example.invalid' } });
  const attachment = await db.attachment.create({ data: {
    refType: 'JOBCARD', refId: id, filename: 'drawing.pdf', storedName: 'drawing.pdf',
    mimeType: 'application/pdf', size: 1,
  } });
  for (const page of [1, 2]) {
    const created = await auth(request(app).post('/api/assignments'))
      .send({ attachmentId: attachment.id, assignedToId: assignee.id, pageNumbers: [page] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
  }

  const refused = await auth(request(app).delete(`/api/jobcards/${id}`));
  expect(refused.status).toBe(400);
  expect(refused.body.message).toBe('Finish or cancel the 2 open drawing assignments on this job card before cancelling it');

  // one down, and the message follows the count rather than repeating itself
  const open = await db.assignment.findMany({ where: { attachmentId: attachment.id } });
  await db.assignment.update({ where: { id: open[0].id }, data: { status: 'CANCELLED' } });
  const stillRefused = await auth(request(app).delete(`/api/jobcards/${id}`));
  expect(stillRefused.status).toBe(400);
  expect(stillRefused.body.message).toBe('Finish or cancel the 1 open drawing assignment on this job card before cancelling it');

  // with none open the cancellation goes through, and the job card is kept
  await db.assignment.update({ where: { id: open[1].id }, data: { status: 'CANCELLED' } });
  const cancelled = await auth(request(app).delete(`/api/jobcards/${id}`));
  expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
  expect(cancelled.body.deleted).toBe(false);
  expect((await db.jobcard.findUnique({ where: { id } })).status).toBe('CANCELLED');
});
