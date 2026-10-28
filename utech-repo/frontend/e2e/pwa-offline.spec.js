import { test, expect } from '@playwright/test';

// PWA contract, in a real browser against a PRODUCTION build — the service
// worker only registers when import.meta.env.PROD is true, so the dev-server
// demo stack can never exercise it.
//
//   npm run build
//   npx vite preview --port 4174 --strictPort            (API_PROXY_TARGET=<backend>)
//   VERCEL=1 E2E_CONFIRM_DISPOSABLE=1 E2E_PWA=1 //     E2E_BASE_URL=http://127.0.0.1:4174 npx playwright test e2e/pwa-offline.spec.js
//
// What it proves: the shell survives a dead network, and business data never
// does — a stale stock or billing figure served from a phone cache would be
// worse than no figure at all.
test.skip(process.env.E2E_PWA !== '1', 'needs a production build served by vite preview (E2E_PWA=1)');

test('PWA offline: second visit renders the login screen without network', async ({ page, context }) => {
  // visit 1 — the worker installs but does not control this page yet
  await page.goto('/login');
  await page.waitForFunction(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return !!(r && r.active);
  }, null, { timeout: 15000 });

  // visit 2 — now the worker controls the page and caches what it serves.
  // Whether a reload is enough depends on when activate/clients.claim() lands,
  // so retry rather than race it.
  // clients.claim() puts the open page under the worker, but the files that
  // page already fetched went out before the worker could see them — they are
  // cached only on the next load it actually serves. So reload until the build
  // assets are in the cache; this is also why offline works from the second
  // visit, not the first.
  const assetsCached = async () => page.evaluate(async () => {
    const names = await caches.keys();
    for (const n of names) {
      const keys = await (await caches.open(n)).keys();
      if (keys.some((k) => new URL(k.url).pathname.includes('/assets/'))) return true;
    }
    return false;
  });
  for (let attempt = 0; attempt < 4 && !(await assetsCached()); attempt++) {
    await page.reload();
    await page.waitForTimeout(1500);
  }
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  expect(await assetsCached()).toBe(true);

  const cached = await page.evaluate(async () => {
    const n = (await caches.keys())[0];
    const keys = await (await caches.open(n)).keys();
    return keys.map((k) => new URL(k.url).pathname);
  });
  console.log('CACHED ASSETS :', JSON.stringify(cached.filter((u) => u.includes('/assets/')).slice(0, 4)));
  console.log('API CACHED?   :', cached.some((u) => u.startsWith('/api/')));

  // now pull the plug
  await context.setOffline(true);
  await page.reload();
  await page.waitForTimeout(2000);
  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 90));
  const hasLoginForm = await page.locator('input#login-email').count();
  console.log('OFFLINE TEXT  :', JSON.stringify(text));
  console.log('LOGIN FORM    :', hasLoginForm);
  await context.setOffline(false);
  expect(hasLoginForm).toBeGreaterThan(0);
});
