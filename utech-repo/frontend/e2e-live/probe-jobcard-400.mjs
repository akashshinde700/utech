/**
 * Live proof of the job-card save 400, with no possibility of writing.
 *
 *   E2E_CHROME_PATH=... LIVE_EMAIL=... LIVE_PASSWORD='...' \
 *   node e2e-live/probe-jobcard-400.mjs [https://www.lastrivon.tech]
 *
 * The browser console reported `api/jobcards/1 400` twice. The read-only sweep
 * showed GET /jobcards/1 and its edit screen load cleanly, so the 400 comes
 * from the SAVE. The form used to decide which line rows to validate with a
 * predicate whose quantity clause was inverted, so a row holding only a
 * quantity skipped validation and was sent anyway -- and the API's line schema
 * requires a positive quantity.
 *
 * WHY THIS CANNOT WRITE ANYTHING
 *  - every payload below is rejected by `validate(updateJobcardSchema)`, which
 *    runs BEFORE the controller, so no database statement is ever reached, and
 *  - the id used is one that does not exist, so even a payload that somehow
 *    passed validation would 404 before touching a row.
 * Nothing is created, changed or deleted.
 */

import { chromium } from '@playwright/test';

const BASE = (process.argv[2] || 'https://www.lastrivon.tech').replace(/\/$/, '');
const { LIVE_EMAIL: EMAIL, LIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) {
  console.error('Set LIVE_EMAIL and LIVE_PASSWORD.');
  process.exit(1);
}

// An id that does not exist: belt and braces behind the validation itself.
const SAFE_ID = 999999;

const PAYLOADS = [
  ['row with only a quantity of 0 (what the old form sent)',
    { date: '2026-10-28', qtyOrdered: 1, lines: [{ itemId: null, itemName: '', qty: 0, uomCode: '', notes: '' }] }],
  ['row whose quantity was a typo, so Number() gave NaN and JSON sent null',
    { date: '2026-10-28', qtyOrdered: 1, lines: [{ itemId: null, itemName: '', qty: null }] }],
  ['row with a negative quantity',
    { date: '2026-10-28', qtyOrdered: 1, lines: [{ itemId: null, itemName: '', qty: -2 }] }],
];

const browser = await chromium.launch({ headless: true, executablePath: process.env.E2E_CHROME_PATH || undefined });
const page = await browser.newPage();

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input#login-email', EMAIL);
await page.fill('input#login-password', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 });
const token = await page.evaluate(() => localStorage.getItem('utech.token'));
console.log(`signed in as ${EMAIL}\n`);

for (const [label, body] of PAYLOADS) {
  const result = await page.evaluate(async ({ base, id, bearer, payload }) => {
    const r = await fetch(`${base}/api/jobcards/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify(payload),
    });
    let parsed = null;
    try { parsed = await r.json(); } catch { /* not json */ }
    return { status: r.status, body: parsed };
  }, { base: BASE, id: SAFE_ID, bearer: token, payload: body });

  console.log(`${result.status}  ${label}`);
  if (result.body) {
    console.log(`      error:   ${result.body.error}`);
    console.log(`      message: ${result.body.message}`);
    for (const d of result.body.details || []) console.log(`      detail:  ${d.path} (${d.label}) -> ${d.message}`);
  }
  console.log();
}

// And the control: the same shape with a usable quantity is NOT a validation
// error. It is refused for the only remaining reason -- no such job card --
// which is what proves nothing above was rejected for the wrong reason.
const control = await page.evaluate(async ({ base, id, bearer }) => {
  const r = await fetch(`${base}/api/jobcards/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ date: '2026-10-28', qtyOrdered: 1, lines: [{ itemId: null, itemName: 'control', qty: 2 }] }),
  });
  let parsed = null;
  try { parsed = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: parsed };
}, { base: BASE, id: SAFE_ID, bearer: token });
console.log(`${control.status}  control: the same row with quantity 2 passes validation`);
console.log(`      error:   ${control.body?.error}`);
console.log(`      message: ${control.body?.message}`);

await browser.close();
