'use strict';

// Route-level checks for /api/metal-calculator: authentication, the profile
// filters and the zod boundary. The arithmetic itself is covered by
// tests/unit/metalCalculator.test.js.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { getDb, makeUser, signInAs, loadApp } from '../helpers/app';

let app;
let token;

beforeAll(async () => {
  app = await loadApp();
});

beforeEach(() => {
  getDb().reset();
  token = signInAs(makeUser({ role: 'MANAGER', permissions: ['jobcard.read'] }));
});

const auth = (r) => r.set('Authorization', `Bearer ${token}`);
const post = (body) => auth(request(app).post('/api/metal-calculator/calculate')).send(body);

describe('/api/metal-calculator', () => {
  it('requires a signed-in user', async () => {
    const res = await request(app).get('/api/metal-calculator/catalog');
    expect(res.status).toBe(401);
  });

  it('serves the APK catalogue without any business permission', async () => {
    // MANAGER here has only jobcard.read — the calculator needs no key at all
    const res = await auth(request(app).get('/api/metal-calculator/catalog'));
    expect(res.status).toBe(200);
    // the ported 22, plus any grade added for this plant (flagged, never
    // altering the ported densities)
    expect(res.body.metals.filter((m) => !m.addedForPlant)).toHaveLength(22);
    expect(res.body.shapes).toHaveLength(11);
    expect(res.body.units.metric).toEqual(['mm', 'cm', 'm']);
    expect(res.body.standardProfiles.profileCount).toBe(2925);
  });

  it('filters the standard-profile families by shape and search', async () => {
    const res = await auth(request(app).get('/api/metal-calculator/profiles?shape=channel&search=UPN'));
    expect(res.status).toBe(200);
    expect(res.body.families.length).toBeGreaterThan(0);
    expect(res.body.families.every((f) => f.shape === 'channel')).toBe(true);
    expect(res.body.families.every((f) => f.profiles.every((p) => /upn/i.test(p.name)))).toBe(true);
  });

  it('calculates a round bar', async () => {
    const res = await post({
      shape: 'roundbar',
      unit: 'mm',
      weightUnit: 'kg',
      metal: 'Steel',
      values: { d: 100, L: 1000 },
      pieces: 2,
      rate: 70,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.pieceWeightKg).toBeCloseTo(61.654, 3);
    expect(res.body.totalWeightKg).toBeCloseTo(123.308, 3);
    expect(res.body.totalPrice).toBeCloseTo(8631.53, 2);
  });

  it('rejects an unknown shape before reaching the engine', async () => {
    const res = await post({ shape: 'hexahedron', values: { d: 10 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  it('rejects a missing dimension with a readable message', async () => {
    const res = await post({ shape: 'roundbar', metal: 'Steel', values: { d: 10 } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Length/);
  });

  it('accepts a standard-profile weight instead of a section', async () => {
    const res = await post({
      shape: 'beam',
      metal: 'Steel',
      values: { L: 6000 },
      standardProfile: { name: 'IPE 200 - 200x100', kgm: 22.4 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.pieceWeightKg).toBe(134.4);
    expect(res.body.standardProfile.kgm).toBe(22.4);
  });
});
