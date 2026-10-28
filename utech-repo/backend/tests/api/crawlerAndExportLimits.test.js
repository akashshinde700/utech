'use strict';

// AUD-110 / AUD-111. The ERP sits on a public domain, so the login screen and
// /health are reachable by anyone — including crawlers. And exports are the
// expensive endpoints: each one runs a wide query or renders a document.

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { loadApp } from '../helpers/app';

let app;

beforeAll(async () => {
  app = await loadApp();
});

describe('search engines are told to stay out', () => {
  it('sends X-Robots-Tag on an API response', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
  });

  it('sends it on a rejected request too, not only on success', async () => {
    // an unauthenticated 401 is exactly what a crawler following a bookmark gets
    const res = await request(app).get('/api/invoices');
    expect(res.status).toBe(401);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
  });

  it('ships a robots.txt that disallows everything', () => {
    const robots = fs.readFileSync(
      path.resolve(__dirname, '..', '..', '..', 'frontend/public/robots.txt'), 'utf8');
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Disallow: \/$/m);
  });
});

describe('export endpoints are rate limited', () => {
  it('declares a limiter on /api/reports and nowhere else globally', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src/server.js'), 'utf8');
    expect(src).toMatch(/app\.use\('\/api\/reports', exportLimiter\)/);
    // an IP-wide cap on the whole API would take the plant down, since
    // everyone reaches the server from one NAT address
    expect(src).not.toMatch(/app\.use\('\/api',\s*\w*[Ll]imiter\)/);
  });

  it('is disabled under test so the suite is not throttled', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src/server.js'), 'utf8');
    expect(src).toMatch(/skip: \(\) => env\.NODE_ENV === 'test'/);
  });
});
