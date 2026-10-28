/**
 * Why does DELETE /api/jobcards/:id answer 400 on this site?
 *
 *   E2E_CHROME_PATH=... LIVE_EMAIL=... LIVE_PASSWORD='...' \
 *   node e2e-live/diagnose-jobcard-delete.mjs [jobcardId] [baseUrl]
 *
 * READ-ONLY. It issues GETs only and never the DELETE it is reasoning about --
 * running that to see the message would cancel or remove the job card, which is
 * the opposite of what a diagnosis is for.
 *
 * The three refusals in jobcard.controller.remove(), in the order checked:
 *   1. unreleased customer-material reservations on this job card
 *   2. drawing assignments still open (not COMPLETED or CANCELLED)
 *   3. the job card is already CANCELLED but has allocation history, so it
 *      cannot be permanently removed
 */

import { chromium } from '@playwright/test';

const JOBCARD_ID = Number(process.argv[2] || 1);
const BASE = (process.argv[3] || 'https://www.lastrivon.tech').replace(/\/$/, '');
const { LIVE_EMAIL: EMAIL, LIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) {
  console.error('Set LIVE_EMAIL and LIVE_PASSWORD.');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.E2E_CHROME_PATH || undefined });
const context = await browser.newContext();
await context.route('**/*', async (route) => {
  const method = route.request().method();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
  if (route.request().url().includes('/api/auth/login')) return route.continue();
  return route.abort();
});
const page = await context.newPage();

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input#login-email', EMAIL);
await page.fill('input#login-password', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 });
const token = await page.evaluate(() => localStorage.getItem('utech.token'));

const get = (path) => page.evaluate(async ({ base, p, bearer }) => {
  const r = await fetch(`${base}${p}`, { headers: { Authorization: `Bearer ${bearer}` } });
  let body = null;
  try { body = await r.json(); } catch { /* not json */ }
  return { status: r.status, body };
}, { base: BASE, p: path, bearer: token });

const rows = (res) => {
  const b = res.body;
  if (!b) return [];
  return Array.isArray(b) ? b : b.items || [];
};

const jc = await get(`/api/jobcards/${JOBCARD_ID}`);
if (jc.status !== 200) {
  console.log(`GET /api/jobcards/${JOBCARD_ID} -> ${jc.status}`);
  await browser.close();
  process.exit(1);
}

console.log(`job card ${JOBCARD_ID}: ${jc.body.number}`);
console.log(`  status      : ${jc.body.status}`);
console.log(`  party       : ${jc.body.party ? jc.body.party.name : '-'}`);
console.log(`  lines       : ${(jc.body.lines || []).length}`);
console.log(`  task items  : ${(jc.body.operations || []).length}`);

// 1. customer-material reservations
const lots = rows(await get('/api/customer-material?pageSize=200'));
const reservations = [];
for (const lot of lots) {
  const detail = await get(`/api/customer-material/${lot.id}`);
  for (const a of (detail.body && detail.body.allocations) || []) {
    if (Number(a.jobcardId) !== JOBCARD_ID) continue;
    reservations.push({ lot: lot.inwardNumber || lot.id, qty: a.qty, released: a.releasedAt ? 'released' : 'OPEN' });
  }
}
const openReservations = reservations.filter((r) => r.released === 'OPEN');

// 2. drawing assignments
const assignments = rows(await get('/api/assignments?pageSize=200'))
  .filter((a) => a.attachment && a.attachment.refType === 'JOBCARD' && Number(a.attachment.refId) === JOBCARD_ID);
const openAssignments = assignments.filter((a) => !['COMPLETED', 'CANCELLED'].includes(a.status));

console.log(`\nwhat the delete checks, in order:`);
console.log(`  1. open customer-material reservations : ${openReservations.length}`
  + (openReservations.length ? ` -> ${JSON.stringify(openReservations)}` : ''));
console.log(`  2. open drawing assignments            : ${openAssignments.length} (of ${assignments.length} on this card)`
  + (openAssignments.length ? ` -> ${JSON.stringify(openAssignments.map((a) => ({ id: a.id, status: a.status })))}` : ''));
console.log(`  3. allocation history while CANCELLED  : ${jc.body.status === 'CANCELLED' ? `${reservations.length} allocation(s) ever` : 'not applicable (status is not CANCELLED)'}`);

// A SUPERADMIN is not refused: the cancel releases open reservations and
// cancels open assignments itself. Every other role is stopped. So the honest
// answer is two answers.
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

let others;
if (openReservations.length) {
  others = `400 — "Release the ${plural(openReservations.length, 'customer-material reservation')} on this job card before cancelling it"`;
} else if (openAssignments.length) {
  others = `400 — "Finish or cancel the ${plural(openAssignments.length, 'open drawing assignment')} on this job card before cancelling it"`;
} else if (jc.body.status === 'CANCELLED' && reservations.length) {
  others = '400 — "Job card has allocation history and cannot be permanently deleted"';
} else if (jc.body.status === 'CANCELLED') {
  others = '200 — permanently removes this job card';
} else {
  others = '200 — marks this job card CANCELLED';
}

let owner;
if (jc.body.status === 'CANCELLED') {
  const extra = reservations.length
    ? `, ${plural(reservations.length, 'reservation record')} removed (written to the audit log first)`
    : '';
  owner = `200 — permanently removes this job card${extra}`;
} else {
  const clears = [
    openReservations.length && `${plural(openReservations.length, 'reservation')} released`,
    openAssignments.length && `${plural(openAssignments.length, 'open assignment')} cancelled`,
  ].filter(Boolean);
  owner = `200 — marks it CANCELLED${clears.length ? `, ${clears.join(' and ')}` : ''}`;
}

console.log('\na DELETE right now would answer:');
console.log(`  any other role : ${others}`);
console.log(`  a SUPERADMIN   : ${owner}`);
console.log('(no DELETE was issued by this script)');

await browser.close();
