'use strict';

// SECURITY MATRIX — every API endpoint, checked for the two controls that must
// never be missing: authentication (401 without a token) and authorization
// (403 for an authenticated caller who holds none of the required permissions).
//
// This is the regression net for the single most common way an ERP leaks data:
// a new route added without `requirePermission(...)`. Because the matrix is
// generated from the route files themselves, a new unprotected route fails
// here on the next run.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { getDb, makeUser, signInAs, loadApp } from '../helpers/app';
import { loadInventory, PUBLIC_ROUTES } from '../helpers/routeInventory';

let app;
let routes;

// A role that is real but holds nothing: it must be denied everywhere the API
// declares a permission, and it proves requirePermission is actually consulted
// (SUPERADMIN short-circuits, so testing with it would prove nothing).
const NO_PERMISSIONS_USER = { id: 501, role: 'OPERATOR', permissions: [], hierarchyLevel: 6, email: 'nobody@utech.local' };

function send(req, method, url) {
  switch (method) {
    case 'GET': return req.get(url);
    case 'POST': return req.post(url);
    case 'PUT': return req.put(url);
    case 'PATCH': return req.patch(url);
    case 'DELETE': return req.delete(url);
    default: throw new Error('unknown method ' + method);
  }
}

beforeAll(async () => {
  app = await loadApp();
  routes = loadInventory();
});

beforeEach(() => getDb().reset());

describe('API inventory', () => {
  it('discovers every mounted router and route handler', () => {
    expect(routes.length).toBeGreaterThan(200);
    expect(new Set(routes.map((r) => r.file)).size).toBeGreaterThan(30);
  });

  it('declares authentication on every route except the public auth endpoints', () => {
    const unprotected = routes
      .filter((r) => !r.hasAuth)
      .map((r) => `${r.method} ${r.path}`);
    expect(unprotected.sort()).toEqual(PUBLIC_ROUTES.slice().sort());
  });

  it('records how many routes are permission-gated (baseline for drift detection)', () => {
    const gated = routes.filter((r) => r.permissions.length > 0);
    // 218 of 233 at the time of this audit; assert a floor so a regression
    // that drops gates fails loudly
    expect(gated.length).toBeGreaterThanOrEqual(215);
  });
});

describe('authentication — every endpoint returns 401 without a token', () => {
  it.each(loadInventory().map((r) => [`${r.method} ${r.path}`, r]))('%s', async (_label, route) => {
    if (PUBLIC_ROUTES.includes(`${route.method} ${route.path}`)) return;
    const res = await send(request(app), route.method, route.concretePath);
    expect(res.status, `expected 401 from ${route.method} ${route.concretePath}, got ${res.status}`).toBe(401);
  });
});

describe('authorization — every permission-gated endpoint returns 403 for a caller with no permissions', () => {
  it.each(
    loadInventory()
      .filter((r) => r.permissions.length > 0)
      .map((r) => [`${r.method} ${r.path}`, r]),
  )('%s', async (_label, route) => {
    const token = signInAs(makeUser(NO_PERMISSIONS_USER));
    const res = await send(request(app), route.method, route.concretePath).set('Authorization', `Bearer ${token}`);
    expect(
      res.status,
      `expected 403 from ${route.method} ${route.concretePath} for a user with no permissions, got ${res.status}`,
    ).toBe(403);
  });
});

describe('authorization — SUPERADMIN bypasses the permission check everywhere', () => {
  it.each(
    loadInventory()
      .filter((r) => r.permissions.length > 0 && r.method === 'GET' && !r.hasUpload)
      .map((r) => [`${r.method} ${r.path}`, r]),
  )('%s is not 403 for SUPERADMIN', async (_label, route) => {
    const token = signInAs(makeUser({ id: 1, role: 'SUPERADMIN' }));
    const res = await send(request(app), route.method, route.concretePath).set('Authorization', `Bearer ${token}`);
    expect(res.status, `SUPERADMIN was denied on ${route.method} ${route.concretePath}`).not.toBe(403);
  });
});

describe('auth-only endpoints (no requirePermission) are enumerated, not silently assumed', () => {
  it('lists exactly the endpoints that any authenticated user can reach', () => {
    const authOnly = routes
      .filter((r) => r.hasAuth && r.permissions.length === 0)
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    // These must be intentional: own-profile, own-notifications, the
    // attachment endpoints (which enforce module permissions per refType inside
    // the controller instead), and the read-only metal calculator (pure
    // arithmetic over public reference tables — no tenant data, no writes).
    // Anything new here needs a decision.
    expect(authOnly).toEqual([
      'DELETE /api/attachments/file/:id',
      'GET /api/attachments/:refType/:refId',
      'GET /api/attachments/file/:id',
      'GET /api/auth/me',
      'GET /api/metal-calculator/catalog',
      'GET /api/metal-calculator/profiles',
      'GET /api/notifications',
      'GET /api/notifications/unread-count',
      'GET /api/parties/lookup/gstin/:gstin',
      'GET /api/parties/lookup/ifsc/:code',
      'POST /api/attachments/:refType/:refId',
      'POST /api/auth/change-password',
      'POST /api/metal-calculator/calculate',
      'POST /api/notifications/:id/read',
      'POST /api/notifications/read-all',
    ]);
  });
});
