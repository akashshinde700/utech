import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// AUD-108. Every page used to be imported statically, so the built index.html
// carried a modulepreload for all 36 chunks — 1.74 MB of JavaScript — before
// the login form could appear, on an ERP that is used from the shop floor on
// phones. Routes are lazy now (333 kB initial), and that is easy to undo by
// accident: adding one ordinary `import PageX from './pages/...'` at the top of
// App.jsx pulls that page, and anything it imports, straight back into the
// first load. This test reads App.jsx and refuses that.

const APP = path.join(process.cwd(), 'src/App.jsx');
const src = fs.readFileSync(APP, 'utf8');

// the login screen is the first thing an unauthenticated visitor needs, and
// the layout wraps every route, so both are deliberately eager
const EAGER_BY_DESIGN = ['./pages/auth/Login.jsx', './components/layout/AppLayout.jsx'];

describe('route code is loaded per route, not all at once', () => {
  it('imports no page statically except the ones that are eager by design', () => {
    const statics = [...src.matchAll(/^import\s+\w+\s+from\s+'(\.\/(?:pages|components)\/[^']+)';$/gm)]
      .map((m) => m[1]);
    expect(statics.sort()).toEqual([...EAGER_BY_DESIGN].sort());
  });

  it('loads every other page through lazy(() => import(...))', () => {
    const lazies = [...src.matchAll(/^const\s+(\w+)\s*=\s*lazyPage\(\(\)\s*=>\s*import\('([^']+)'\)\);$/gm)];
    expect(lazies.length).toBeGreaterThan(50);
    // no page may be both eager and lazy — that would defeat the split while
    // looking correct
    const lazyPaths = lazies.map((m) => m[2]);
    for (const eager of EAGER_BY_DESIGN) expect(lazyPaths).not.toContain(eager);
  });

  it('renders every route element from a component that is declared in App.jsx', () => {
    const declared = new Set([
      ...[...src.matchAll(/^const\s+(\w+)\s*=\s*lazyPage\(/gm)].map((m) => m[1]),
      ...[...src.matchAll(/^import\s+(\w+)\s+from\s+'\.\//gm)].map((m) => m[1]),
      ...[...src.matchAll(/^function\s+(\w+)\(/gm)].map((m) => m[1]),
      // <Navigate> and friends come from the router, not from a page module
      ...[...src.matchAll(/^import\s+\{([^}]+)\}\s+from\s+'[^.][^']*';$/gm)]
        .flatMap((m) => m[1].split(',').map((n) => n.trim())),
    ]);
    const routed = [...src.matchAll(/element=\{<(\w+)\s*\/?>?/g)].map((m) => m[1]);
    expect(routed.length).toBeGreaterThan(50);
    const missing = routed.filter((name) => !declared.has(name));
    expect(missing).toEqual([]);
  });

  it('turns a failed page download into a readable message, not a crash', () => {
    // offline on the shop floor, or a deploy that replaced the chunk an open
    // tab is still asking for — both reject the import()
    expect(src).toMatch(/function lazyPage\(load\)/);
    expect(src).toMatch(/load\(\)\.catch\(\(\) => load\(\)\)\.catch\(\(\) => \(\{ default: PageUnavailable \}\)\)/);
    expect(src).toMatch(/function PageUnavailable\(\)/);
  });

  it('keeps a Suspense boundary around the content, not around the whole app', () => {
    // a boundary above AppLayout would blank the sidebar and header on every
    // navigation; the one in AppLayout only replaces the page area
    expect(src).not.toMatch(/import\s*\{[^}]*Suspense/); // App.jsx cannot render one without importing it
    const layout = fs.readFileSync(path.join(process.cwd(), 'src/components/layout/AppLayout.jsx'), 'utf8');
    expect(layout.replace(/\s+/g, ' '))
      .toContain('<Suspense fallback={<RouteLoading />}> <Outlet /> </Suspense>');
  });
});
