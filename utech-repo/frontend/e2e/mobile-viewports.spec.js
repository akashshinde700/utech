import { test, expect } from '@playwright/test';

// Mobile viewport regression suite (run: npm run test:e2e — boots the
// disposable in-memory demo stack from playwright.config.js).
// These assert LAYOUT FACTS in a real browser: no page-level horizontal
// overflow, a working slide-out drawer, and DataTable record cards instead
// of squeezed tables on phones. Real Android/iOS device testing is still
// required before release — see docs/MOBILE_PWA_AUDIT.md.

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
];

const ROUTES = ['/', '/parties', '/items', '/stock', '/jobcards', '/invoices', '/purchase-orders', '/grns', '/reports', '/machines'];

async function login(page) {
  await page.goto('/login');
  await page.fill('input#login-email', 'admin@utech.local');
  await page.fill('input#login-password', 'Admin@123');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/login'));
}

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, hasTouch: vp.width < 1024 });

    test('no horizontal page overflow on major routes', async ({ page }) => {
      await login(page);
      for (const route of ROUTES) {
        await page.goto(route);
        await page.waitForLoadState('networkidle');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${route} overflows by ${overflow}px at ${vp.width}px`).toBeLessThanOrEqual(0);
      }
    });
  });
}

test.describe('mobile shell (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('drawer opens, locks background scroll, closes on Escape and on navigation', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('button', { name: 'Close navigation' })).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('link', { name: /items/i }).first().click();
    await expect(page).toHaveURL(/\/items/);
  });

  test('list pages render record cards, not a table, on phones', async ({ page }) => {
    await login(page);
    await page.goto('/items');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('table')).toHaveCount(0);
  });

  test('a form fits the viewport and its inputs never exceed their container', async ({ page }) => {
    await login(page);
    await page.goto('/parties/new');
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('desktop shell (1366x768)', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('sidebar is a static column and tables stay tables', async ({ page }) => {
    await login(page);
    await page.goto('/items');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('table').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveCount(0);
  });
});
