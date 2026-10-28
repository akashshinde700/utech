/**
 * Live check that the material-size calculator is reachable while ADDING and
 * while EDITING an item.
 *
 *   E2E_CHROME_PATH=... LIVE_EMAIL=... LIVE_PASSWORD='...' \
 *   node e2e-live/verify-item-size-calculator.mjs [https://www.lastrivon.tech]
 *
 * READ-ONLY. Every non-GET request is aborted in the network layer, except the
 * login, the item form's weight-preview lookup and /api/metal-calculator/* --
 * the last two compute a number and write nothing. The calculator is opened and
 * actually run; nothing is applied and no item is saved.
 */

import { chromium } from '@playwright/test';

const BASE = (process.argv[2] || 'https://www.lastrivon.tech').replace(/\/$/, '');
const { LIVE_EMAIL: EMAIL, LIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) {
  console.error('Set LIVE_EMAIL and LIVE_PASSWORD.');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.E2E_CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

const writeAttempts = [];
await context.route('**/*', async (route) => {
  const req = route.request();
  const method = req.method();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
  if (req.url().includes('/api/auth/login')) return route.continue();
  if (req.url().includes('/api/items/weight-preview')) return route.continue(); // computes, writes nothing
  if (req.url().includes('/api/metal-calculator/')) return route.continue();    // the calculator itself
  writeAttempts.push(`${method} ${req.url().replace(BASE, '')}`);
  return route.abort();
});

const page = await context.newPage();
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input#login-email', EMAIL);
await page.fill('input#login-password', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 });
const token = await page.evaluate(() => localStorage.getItem('utech.token'));

const itemId = await page.evaluate(async ({ base, bearer }) => {
  const r = await fetch(`${base}/api/items?pageSize=1`, { headers: { Authorization: `Bearer ${bearer}` } });
  const body = await r.json();
  const rows = body.items || [];
  return rows.length ? rows[0].id : null;
}, { base: BASE, bearer: token });

console.log(`signed in as ${EMAIL}; nothing will be saved\n`);

async function check(label, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#item-size', { timeout: 30000 });

  const open = page.getByRole('button', { name: 'Calculate material size' });
  const present = await open.isVisible().catch(() => false);
  if (!present) {
    console.log(`${label.padEnd(12)} : calculator button NOT present`);
    return false;
  }
  await open.click();

  // the embedded calculator fetches the shape/metal catalogue on mount, so the
  // shape picker appears a moment after the panel does -- wait for it instead
  // of reading the DOM in the same tick
  const shapeVisible = await page.waitForSelector('#mc-shape', { timeout: 20000 })
    .then(() => true).catch(() => false);

  // Drive it the whole way: a 100 mm round bar, 1 m long, in the default metal.
  // /api/metal-calculator/calculate only computes -- it writes nothing -- so the
  // real in-form flow can be exercised right up to the point of applying.
  let weightShown = '(not calculated)';
  let applyPresent = false;
  if (shapeVisible) {
    await page.selectOption('#mc-shape', 'roundbar').catch(() => {});
    await page.locator('#mc-d').fill('100').catch(() => {});
    await page.locator('#mc-L').fill('1000').catch(() => {});
    await page.getByRole('button', { name: 'Calculate', exact: true }).click().catch(() => {});
    const kg = page.getByText(/\d+\.\d+ kg/).first();
    await kg.waitFor({ timeout: 20000 }).catch(() => {});
    weightShown = await kg.innerText().catch(() => '(not calculated)');
    const apply = page.getByRole('button', { name: 'Use this material size' });
    applyPresent = await apply.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  }

  const closes = await page.getByRole('button', { name: 'Close calculator' }).isVisible().catch(() => false);
  console.log(`${label.padEnd(12)} : opens inline, shape picker ${shapeVisible ? 'yes' : 'NO'}, `
    + `100 mm round bar x 1 m -> ${weightShown.trim()}, apply button ${applyPresent ? 'yes' : 'NO'}, close ${closes ? 'yes' : 'NO'}`);

  await page.getByRole('button', { name: 'Close calculator' }).click().catch(() => {});
  return present && shapeVisible && applyPresent && closes;
}

const addOk = await check('add item', `${BASE}/items/new`);
const editOk = itemId ? await check('edit item', `${BASE}/items/${itemId}`) : false;
if (!itemId) console.log('edit item    : no item on the site to open');

console.log('\nwrite attempts blocked:');
console.log(writeAttempts.length ? [...new Set(writeAttempts)].map((w) => `  ${w}`).join('\n') : '  none');

const ok = addOk && editOk;
console.log(`\n${ok ? 'PASS' : 'FAIL'}: the calculator is ${ok ? 'available while adding AND editing an item' : 'not available in both places'}`);
await browser.close();
process.exit(ok ? 0 : 1);
