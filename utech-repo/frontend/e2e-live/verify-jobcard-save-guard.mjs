/**
 * Live check that the job-card form no longer sends a line the API must refuse.
 *
 *   E2E_CHROME_PATH=... LIVE_EMAIL=... LIVE_PASSWORD='...' \
 *   node e2e-live/verify-jobcard-save-guard.mjs [https://www.lastrivon.tech]
 *
 * Opens a real job card's edit screen, adds a material row, types a quantity of
 * 0 into it and presses Save. Before the fix that row skipped the form's own
 * validation and was sent, and the save came back 400 with nothing highlighted.
 * Afterwards the form must stop it: the field is marked and NO request leaves
 * the browser.
 *
 * WHY THIS CANNOT WRITE ANYTHING
 * Every non-GET request is aborted in the network layer (the login POST and the
 * form's own weight-preview lookup aside, neither of which writes). So the
 * check is exactly "did a PUT get attempted", and if the fix were missing, the
 * attempt would be recorded and then blocked rather than saved. The job card is
 * never modified either way.
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
  if (req.url().includes('/api/items/weight-preview')) return route.continue(); // a lookup, writes nothing
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

const jobcardId = await page.evaluate(async ({ base, bearer }) => {
  const r = await fetch(`${base}/api/jobcards?pageSize=1`, { headers: { Authorization: `Bearer ${bearer}` } });
  const body = await r.json();
  const rows = Array.isArray(body) ? body : body.items || [];
  return rows.length ? rows[0].id : null;
}, { base: BASE, bearer: token });

if (!jobcardId) {
  console.error('No job card to open on this site.');
  await browser.close();
  process.exit(1);
}

console.log(`signed in as ${EMAIL}; editing job card ${jobcardId} (nothing will be saved)\n`);
await page.goto(`${BASE}/jobcards/${jobcardId}/edit`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#jc-qtyOrdered', { timeout: 30000 });

const rowsBefore = await page.locator('[id^="jc-line-"][id$="-qty"]').count();
await page.getByRole('button', { name: /Add material/i }).click();
const index = rowsBefore; // the row just added
const qty = page.locator(`#jc-line-${index}-qty`);
await qty.waitFor({ timeout: 10000 });
await qty.fill('0');

const before = writeAttempts.length;
await page.getByRole('button', { name: 'Save', exact: true }).click();
// give a save every chance to fire before concluding that none did
await page.waitForTimeout(2500);
const attempted = writeAttempts.slice(before).filter((w) => w.includes('/api/jobcards/'));

const fieldError = await page.locator(`#jc-line-${index}-qty-error`).innerText().catch(() => '');
const stillOnForm = /\/edit$/.test(new URL(page.url()).pathname);

console.log(`line quantity typed      : 0`);
console.log(`save requests attempted  : ${attempted.length ? attempted.join(', ') : 'none'}`);
console.log(`field error shown        : ${fieldError ? `"${fieldError.trim()}"` : '(none)'}`);
console.log(`still on the edit screen : ${stillOnForm}`);

const ok = attempted.length === 0 && /quantity|greater than 0|required/i.test(fieldError) && stillOnForm;
console.log(`\n${ok ? 'PASS' : 'FAIL'}: the form ${ok ? 'stopped the bad line before sending it' : 'did not stop the bad line'}`);

console.log('\nwrite attempts blocked during this run:');
console.log(writeAttempts.length ? [...new Set(writeAttempts)].map((w) => `  ${w}`).join('\n') : '  none');

await browser.close();
process.exit(ok ? 0 : 1);
