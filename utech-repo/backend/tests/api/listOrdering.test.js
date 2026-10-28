'use strict';

// Regression: list endpoints sorted by a single non-unique key (usually
// `date`). Every seeded/created document shares today's date, so with no
// tiebreaker the row order was undefined — a freshly saved invoice could
// land on page 2 and the list the user was returned to did not show the
// record they had just created (this failed a Playwright workflow test:
// "waiting for row INV-26-00007"). Lists now order by [{sortBy}, {id}] so
// equal keys resolve newest-first (desc) deterministically.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
const { createInMemoryPrisma } = require('../../src/config/inMemoryPrisma');

let app, db, token, customer;
const auth = (r) => r.set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'isolated-ordering-test-secret-only';
  process.env.DATABASE_URL = 'mysql://stub:stub@localhost:3306/stub';
  process.env.UPLOAD_DIR = '/tmp/utech-ordering-test-uploads';
  db = createInMemoryPrisma();
  global.__prisma = db;
  const role = await db.role.create({ data: { name: 'SUPERADMIN' } });
  const user = await db.user.create({ data: { name: 'Ordering Admin', email: 'ordering@example.invalid', passwordHash: 'x', roleId: role.id } });
  customer = await db.party.create({ data: { name: 'Ordering Customer', code: 'ORD-C', type: 'CUSTOMER' } });
  token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  app = (await import('../../src/server')).default;
});

describe('list ordering is deterministic on equal sort keys', () => {
  it('a just-created invoice is the first row of page 1, not stranded on page 2', async () => {
    const ids = [];
    for (let i = 0; i < 12; i++) {
      const res = await auth(request(app).post('/api/invoices')).send({
        date: new Date().toISOString().slice(0, 10),
        partyId: customer.id,
        lines: [{ description: `Ordering line ${i}`, qty: 1, rate: 10, gstRate: 0 }],
      });
      expect(res.status).toBe(201);
      ids.push(res.body.id);
    }
    const page1 = await auth(request(app).get('/api/invoices?pageSize=10'));
    expect(page1.status).toBe(200);
    const page1Ids = page1.body.items.map((r) => r.id);
    expect(page1Ids[0]).toBe(ids[ids.length - 1]); // newest first
    expect(page1Ids).toEqual([...ids].reverse().slice(0, 10)); // strictly deterministic

    const page2 = await auth(request(app).get('/api/invoices?pageSize=10&page=2'));
    expect(page2.body.items.map((r) => r.id)).toEqual([...ids].reverse().slice(10));
  });
});
