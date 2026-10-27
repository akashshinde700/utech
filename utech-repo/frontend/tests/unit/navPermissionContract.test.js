import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// NAV ↔ API PERMISSION CONTRACT
//
// AppLayout hides a sidebar link when the user lacks `item.perm`. If that key is
// not the one the backend actually checks, one of two things happens and both
// are bugs:
//   - nav key is narrower than the API  -> the link is hidden from users who
//                                          are allowed to use the page
//   - nav key is broader than the API   -> the link shows, the page loads, and
//                                          every request 403s
// AUD-104 was exactly this: the BOMs link was gated on `bom.read` while
// /api/boms checks `item.read`.
//
// This test reads both sides from source, so the mismatch cannot come back.

const FRONTEND = path.resolve(__dirname, '..', '..');
const BACKEND = path.resolve(FRONTEND, '..', 'backend');

function navPermissions() {
  const src = fs.readFileSync(path.join(FRONTEND, 'src/components/layout/AppLayout.jsx'), 'utf8');
  const out = [];
  for (const m of src.matchAll(/\{\s*to:\s*'([^']+)'[^}]*perm:\s*'([^']+)'/g)) {
    out.push({ to: m[1].split('?')[0], perm: m[2] });
  }
  return out;
}

function routePermissions() {
  const dir = path.join(BACKEND, 'src/routes');
  const map = {}; // mount -> Set(perm)
  const server = fs.readFileSync(path.join(BACKEND, 'src/server.js'), 'utf8');
  const varToFile = {};
  for (const m of server.matchAll(/const (\w+) = require\('\.\/routes\/([\w.]+)'\)/g)) varToFile[m[1]] = m[2];
  for (const m of server.matchAll(/app\.use\('(\/api\/[^']+)',\s*(\w+)\)/g)) {
    const file = varToFile[m[2]];
    if (!file) continue;
    const src = fs.readFileSync(path.join(dir, `${file}.js`), 'utf8');
    const perms = new Set();
    for (const p of src.matchAll(/requirePermission\(([^)]*)\)/g)) {
      for (const k of p[1].matchAll(/'([^']+)'/g)) perms.add(k[1]);
    }
    map[m[1]] = perms;
  }
  return map;
}

// nav path -> the API mount that serves it (the SPA and API paths differ)
const NAV_TO_MOUNT = {
  '/quotations': '/api/quotations',
  '/parties': '/api/parties',
  '/jobcards': '/api/jobcards',
  '/assignments': '/api/assignments',
  '/machines': '/api/machines',
  '/my-tasks': '/api/tasks',
  '/tasks': '/api/tasks',
  '/processes': '/api/processes',
  '/invoices': '/api/invoices',
  '/sales-returns': '/api/sales-returns',
  '/dispatch': '/api/dispatch',
  '/items': '/api/items',
  '/boms': '/api/boms',
  '/production/batches': '/api/production',
  '/production/shifts': '/api/production',
  '/purchase-orders': '/api/purchase-orders',
  '/grns': '/api/grns',
  '/purchase-returns': '/api/purchase-returns',
  '/back-orders': '/api/back-orders',
  '/customer-material': '/api/customer-material',
  '/jobwork': '/api/jobwork',
  '/vendor-work-orders': '/api/vendor-work-orders',
  '/stock': '/api/stock',
  '/reports': '/api/reports',
  '/users': '/api/users',
  '/roles': '/api/roles',
  '/departments': '/api/departments',
  '/department-subcategories': '/api/department-subcategories',
  '/projects': '/api/projects',
  '/expenses': '/api/expenses',
};

describe('sidebar permission keys match what the API enforces', () => {
  const nav = navPermissions();
  const routes = routePermissions();

  it('discovers nav entries on both sides', () => {
    expect(nav.length).toBeGreaterThan(25);
    expect(Object.keys(routes).length).toBeGreaterThan(30);
  });

  it.each(nav.map((n) => [`${n.to} (${n.perm})`, n]))(
    '%s is a permission the backing API actually accepts',
    (_label, entry) => {
      const mount = NAV_TO_MOUNT[entry.to];
      if (!mount) return; // analytics/dashboard links have no single backing mount
      const allowed = routes[mount];
      expect(allowed, `no routes parsed for ${mount}`).toBeTruthy();
      expect(
        allowed.has(entry.perm),
        `the sidebar gates ${entry.to} on "${entry.perm}" but ${mount} only accepts: ${[...allowed].sort().join(', ')}`,
      ).toBe(true);
    },
  );
});

describe('seeded permission keys cover everything the API requires', () => {
  it('every required key exists in the seed (otherwise only SUPERADMIN could use the route)', () => {
    const seed = fs.readFileSync(path.join(BACKEND, 'prisma/seed.js'), 'utf8');
    const modules = [...seed.matchAll(/const MODULES = \[([\s\S]*?)\];/g)][0][1]
      .match(/'([^']+)'/g).map((s) => s.replace(/'/g, ''));
    const extra = [...seed.matchAll(/key: '([\w.]+)'/g)].map((m) => m[1]);
    const seeded = new Set([...modules.flatMap((m) => ['create', 'read', 'update', 'delete'].map((a) => `${m}.${a}`)), ...extra]);

    const required = new Set();
    for (const perms of Object.values(routePermissions())) for (const p of perms) required.add(p);

    const missing = [...required].filter((k) => !seeded.has(k)).sort();
    expect(missing, `these permission keys are enforced by routes but never seeded: ${missing.join(', ')}`).toEqual([]);
  });
});
