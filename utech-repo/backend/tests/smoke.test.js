'use strict';

// Smoke test: proves the harness boots the real Express app (src/server.js) and
// that requireAuth() is genuinely in the request path.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { getDb, makeUser, signInAs, loadApp } from './helpers/app';

let app;

beforeAll(async () => {
  app = await loadApp();
});

beforeEach(() => getDb().reset());

describe('harness / app bootstrap', () => {
  it('exposes /health without auth', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns JSON 404 (not the SPA shell) for unknown /api paths', async () => {
    const res = await request(app).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('rejects an unauthenticated call to a protected endpoint', async () => {
    const res = await request(app).get('/api/invoices');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('accepts a bearer token and resolves the identity through requireAuth', async () => {
    const token = signInAs(makeUser({ id: 7, role: 'SUPERADMIN' }));
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(7);
    expect(res.body.user.role).toBe('SUPERADMIN');
  });

  it('rejects a token signed with the wrong secret', async () => {
    const bad = jwt.sign({ sub: 1 }, 'not-the-app-secret');
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${bad}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token for a deactivated user', async () => {
    const token = signInAs(makeUser({ id: 9, isActive: false }));
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});
