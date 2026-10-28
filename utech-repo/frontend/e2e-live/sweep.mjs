/**
 * READ-ONLY sweep of the live site.
 *
 *   E2E_CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" \
 *   LIVE_EMAIL=you@example.com LIVE_PASSWORD='...' \
 *   node e2e-live/sweep.mjs [https://www.lastrivon.tech]
 *
 * It signs in, opens every screen, and reports what is broken: failed API
 * calls, console errors, horizontal overflow, and pages that render nothing.
 *
 * NOTHING IS WRITTEN. Every request that is not a GET is aborted before it
 * leaves the browser -- the single exception is the login POST. That is a hard
 * block in the network layer, not a convention: this runs against the real
 * business database, so a stray save, status change or delete is not something
 * to rely on discipline for. Aborted writes are listed at the end, so an
 * accidental write attempt is visible rather than silent.
 *
 * Reproducing a SAVE therefore cannot happen here by design; use the demo stack
 * (npm run test:e2e) for anything that has to write.
 */

import { chromium } from '@playwright/test';

const BASE = (process.argv[2] || process.env.LIVE_BASE_URL || 'https://www.lastrivon.tech').replace(/\/$/, '');
const EMAIL = process.env.LIVE_EMAIL;
const PASSWORD = process.env.LIVE_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('Set LIVE_EMAIL and LIVE_PASSWORD.');
  process.exit(1);
}

// Every list and detail screen the sidebar can reach. Detail routes take an id
// discovered from the list API, so they are only visited if a record exists.
const LIST_ROUTES = [
  '/', '/users', '/roles', '/departments', '/department-subcategories', '/assignments',
  '/parties', '/items', '/machines', '/metal-calculator', '/quotations', '/invoices',
  '/jobcards', '/tasks', '/my-tasks', '/jobwork', '/dispatch', '/processes', '/expenses',
  '/purchase-orders', '/grns', '/quality', '/projects', '/sales-returns', '/purchase-returns',
  '/back-orders', '/production', '/production/batches', '/production/shifts', '/boms',
  '/customer-material', '/vendor-work-orders', '/stock', '/reports',
  '/analytics/sales', '/analytics/production', '/analytics/inventory',
];

// [route template, API collection to take an id from]
const DETAIL_ROUTES = [
  ['/parties/:id', 'parties'],
  ['/items/:id', 'items'],
  ['/jobcards/:id', 'jobcards'],
  ['/jobcards/:id/edit', 'jobcards'],
  ['/invoices/:id', 'invoices'],
  ['/quotations/:id', 'quotations'],
  ['/purchase-orders/:id', 'purchase-orders'],
  ['/grns/:id', 'grns'],
  ['/projects/:id', 'projects'],
  ['/customer-material/:id', 'customer-material'],
  ['/vendor-work-orders/:id', 'vendor-work-orders'],
  ['/boms/:id', 'boms'],
];

const findings = [];
const blockedWrites = [];
const add = (route, kind, detail) => findings.push({ route, kind, detail });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.E2E_CHROME_PATH || undefined,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

// --- the hard read-only guard -------------------------------------------
await context.route('**/*', async (route) => {
  const request = route.request();
  const method = request.method();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
  if (request.url().includes('/api/auth/login')) return route.continue();
  blockedWrites.push(`${method} ${request.url()}`);
  return route.abort();
});

const page = await context.newPage();
let current = 'startup';

page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  // a failed request is already recorded from the response side; the console
  // copy of it would double every finding
  if (/Failed to load resource/i.test(text)) return;
  add(current, 'console', text.slice(0, 300));
});
page.on('pageerror', (err) => add(current, 'pageerror', String(err.message).slice(0, 300)));
page.on('response', (res) => {
  if (res.status() < 400) return;
  const url = res.url();
  if (!url.includes('/api/')) return;
  add(current, `http ${res.status()}`, `${res.request().method()} ${url.replace(BASE, '')}`);
});

async function settle() {
  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 });
  } catch {
    // a page that polls never reaches networkidle; its findings are already in
  }
}

// --- sign in ------------------------------------------------------------
current = '/login';
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input#login-email', EMAIL);
await page.fill('input#login-password', PASSWORD);
await page.click('button[type="submit"]');
try {
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 });
} catch {
  console.error('Login did not navigate away from /login. Findings so far:');
  console.error(JSON.stringify(findings, null, 2));
  await browser.close();
  process.exit(1);
}
await settle();
console.log(`signed in as ${EMAIL}\n`);

// --- what records exist, so detail pages can be visited -----------------
const token = await page.evaluate(() => localStorage.getItem('utech.token'));
const firstIds = {};
for (const [, collection] of DETAIL_ROUTES) {
  if (firstIds[collection] !== undefined) continue;
  firstIds[collection] = await page.evaluate(async ({ base, path, bearer }) => {
    try {
      const r = await fetch(`${base}/api/${path}?pageSize=1`, { headers: { Authorization: `Bearer ${bearer}` } });
      if (!r.ok) return null;
      const body = await r.json();
      const rows = Array.isArray(body) ? body : body.items || [];
      return rows.length ? rows[0].id : null;
    } catch { return null; }
  }, { base: BASE, path: collection, bearer: token });
}

// --- sweep --------------------------------------------------------------
const routes = [
  ...LIST_ROUTES,
  ...DETAIL_ROUTES
    .filter(([, c]) => firstIds[c] != null)
    .map(([tpl, c]) => tpl.replace(':id', String(firstIds[c]))),
];

for (const route of routes) {
  current = route;
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settle();

    // did anything render at all?
    const text = (await page.locator('body').innerText().catch(() => '')).trim();
    if (text.length < 40) add(route, 'blank', `rendered ${text.length} characters of text`);
    if (/could not be loaded|Something went wrong/i.test(text)) {
      add(route, 'error-card', text.split('\n').slice(0, 3).join(' / '));
    }

    // a page wider than the window means a horizontal scrollbar on every screen
    const overflow = await page.evaluate(() =>
      Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
    if (overflow > 2) add(route, 'overflow', `${overflow}px wider than the viewport`);

    console.log(`  ${String(route).padEnd(32)} ok`);
  } catch (e) {
    add(route, 'navigation', String(e.message).split('\n')[0].slice(0, 200));
    console.log(`  ${String(route).padEnd(32)} FAILED`);
  }
}

// --- report -------------------------------------------------------------
console.log('\n================ findings ================');
if (!findings.length) console.log('none');
const byRoute = new Map();
for (const f of findings) {
  if (!byRoute.has(f.route)) byRoute.set(f.route, []);
  byRoute.get(f.route).push(f);
}
for (const [route, items] of byRoute) {
  console.log(`\n${route}`);
  const seen = new Set();
  for (const i of items) {
    const key = `${i.kind}|${i.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  [${i.kind}] ${i.detail}`);
  }
}

console.log('\n================ write attempts blocked ================');
if (!blockedWrites.length) console.log('none - the sweep issued no writes');
else for (const w of [...new Set(blockedWrites)]) console.log(`  ${w}`);

console.log(`\n${routes.length} routes visited, ${findings.length} findings`);
await browser.close();
