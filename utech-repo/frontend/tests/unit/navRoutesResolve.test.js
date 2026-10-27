import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// NAV → ROUTE CONTRACT
//
// A sidebar link that points at a path no <Route> declares is a dead menu item:
// the router falls through to `*` (NotFound) and the user sees "page not found"
// for a feature that exists. AppLayout and App.jsx are edited independently, so
// the check is done from source at test time instead of by clicking.
//
// (The sibling tests cover the other two dead-link classes: navPermissionContract
// compares nav permission keys with the permissions the API actually requires,
// and restrictedNav asserts a restricted user may OPEN every link they can SEE.)

const SRC = path.resolve(__dirname, '..', '..', 'src');
const appSrc = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8');
const navSrc = fs.readFileSync(path.join(SRC, 'components/layout/AppLayout.jsx'), 'utf8');

// <Route path="..."> — attributes may span lines (the index route does).
function declaredRoutes() {
  const out = [];
  for (const m of appSrc.matchAll(/<Route\b([\s\S]*?)\/?>/g)) {
    const p = m[1].match(/\bpath="([^"]*)"/);
    if (p) out.push(p[1]);
  }
  return out;
}

// `to: '/invoices?type=CUSTOMER'` entries of NAV_SECTIONS / RESTRICTED_NAV_SECTIONS.
function navTargets() {
  const out = new Set();
  for (const m of navSrc.matchAll(/\bto:\s*'([^']+)'/g)) out.add(m[1]);
  return [...out];
}

function routeToRegex(route) {
  if (route === '*') return /.*/;
  const body = route
    .split('/')
    .filter(Boolean)
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${body}$`);
}

const routes = declaredRoutes();
// The catch-all route is deliberately excluded: `*` matches ANY path, so using
// it here would make every typo'd link "resolve" and the test would pass while
// the link still lands on NotFound. (Verified by mutating a nav link to
// /invoicez — the first version of this test stayed green, this one fails.)
const regexes = routes.filter((r) => r !== '*').map(routeToRegex);
const resolves = (to) => {
  const clean = to.split('?')[0].replace(/^\//, '').replace(/\/$/, '');
  return clean === '' ? regexes.some((r) => r.source === '^$') : regexes.some((r) => r.test(clean));
};

describe('nav → route contract', () => {
  it('reads a realistic number of routes and links', () => {
    expect(routes.length).toBeGreaterThan(50);
    expect(navTargets().length).toBeGreaterThan(30);
  });

  it('declares the dashboard index route', () => {
    // path="/" is written across two lines, so a naive single-line parse misses
    // it and every '/' link would look dead.
    expect(resolves('/')).toBe(true);
  });

  it('every sidebar link resolves to a declared route', () => {
    const dead = navTargets().filter((to) => !resolves(to));
    expect(dead).toEqual([]);
  });

  it('the catch-all route stays last, so specific routes win', () => {
    expect(routes[routes.length - 1]).toBe('*');
    expect(routes.filter((r) => r === '*')).toHaveLength(1);
  });

  it('has no duplicate route paths (which would silently shadow each other)', () => {
    const seen = routes.filter((r) => r !== '*');
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('does not leave a page import unused', () => {
    // every `import X from './pages/...'` must appear as an element somewhere
    const imports = [...appSrc.matchAll(/import\s+(\w+)\s+from\s+'\.\/(?:pages|components)\//g)].map((m) => m[1]);
    const unused = imports.filter((name) => {
      const uses = appSrc.split(new RegExp(`<${name}\\b`)).length - 1;
      return uses === 0;
    });
    expect(unused).toEqual([]);
  });
});
