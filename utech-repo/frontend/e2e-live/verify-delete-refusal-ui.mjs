/**
 * Live check of what the deployed app does when a job-card delete is refused.
 *
 *   E2E_CHROME_PATH=... LIVE_EMAIL=... LIVE_PASSWORD='...' \
 *   node e2e-live/verify-delete-refusal-ui.mjs [https://www.lastrivon.tech]
 *
 * WHY THIS CANNOT CHANGE ANYTHING
 * The DELETE never leaves the browser. It is intercepted and answered with the
 * exact 400 the API would send for a job card with open drawing assignments, so
 * the deployed frontend is exercised end to end while the real record is
 * untouched. Every other non-GET request is aborted outright.
 *
 * Issuing the real DELETE would be the more direct test and is deliberately not
 * done: if the blocking assignments were closed in the meantime, the job card
 * would be marked CANCELLED, and that is a change nobody asked for.
 */

import { chromium } from '@playwright/test';

const BASE = (process.argv[2] || 'https://www.lastrivon.tech').replace(/\/$/, '');
const { LIVE_EMAIL: EMAIL, LIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) {
  console.error('Set LIVE_EMAIL and LIVE_PASSWORD.');
  process.exit(1);
}

const REFUSAL = 'Finish or cancel the 2 open drawing assignments on this job card before cancelling it';

const browser = await chromium.launch({ headless: true, executablePath: process.env.E2E_CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

let deleteIntercepted = 0;
await context.route('**/*', async (route) => {
  const req = route.request();
  const method = req.method();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
  if (req.url().includes('/api/auth/login')) return route.continue();
  if (method === 'DELETE' && /\/api\/jobcards\/\d+$/.test(req.url())) {
    deleteIntercepted += 1;
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'HttpError', message: REFUSAL }),
    });
  }
  return route.abort();
});

const page = await context.newPage();
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input#login-email', EMAIL);
await page.fill('input#login-password', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 });

await page.goto(`${BASE}/jobcards`, { waitUntil: 'domcontentloaded' });
const deleteButton = page.locator('button[aria-label^="Delete jobcard"]').first();
await deleteButton.waitFor({ timeout: 30000 });
const which = await deleteButton.getAttribute('aria-label');
console.log(`signed in as ${EMAIL}\ntarget: ${which} (the DELETE is answered locally, never sent)\n`);

await deleteButton.click();
await page.getByRole('button', { name: 'Mark as cancelled' }).click();

const dialog = page.getByRole('dialog');
const refusalShown = await dialog.getByText(/Finish or cancel the 2 open drawing assignments/).isVisible().catch(() => false);
const unchangedShown = await dialog.getByText(/has not been changed/).isVisible().catch(() => false);
const link = dialog.getByRole('link', { name: 'Open Drawing Assignments' });
const linkHref = await link.getAttribute('href').catch(() => null);
const retryShown = await dialog.getByRole('button', { name: 'Try again' }).isVisible().catch(() => false);
const oldButtonGone = !(await dialog.getByRole('button', { name: 'Mark as cancelled' }).isVisible().catch(() => false));

console.log(`delete requests intercepted : ${deleteIntercepted}`);
console.log(`refusal kept on screen      : ${refusalShown}`);
console.log(`says the card is unchanged  : ${unchangedShown}`);
console.log(`link to clear the blocker   : ${linkHref || '(none)'}`);
console.log(`button now says Try again   : ${retryShown}`);
console.log(`no longer re-offers cancel  : ${oldButtonGone}`);

const ok = deleteIntercepted === 1 && refusalShown && unchangedShown
  && linkHref === '/assignments' && retryShown && oldButtonGone;
console.log(`\n${ok ? 'PASS' : 'FAIL'}: the deployed app ${ok ? 'turns the refusal into a next step' : 'does not show the refusal properly'}`);

await browser.close();
process.exit(ok ? 0 : 1);
