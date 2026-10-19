import { test, expect } from '@playwright/test';

async function pickFirstOption(page, selector) {
  await page.locator(selector).first().click();
  await page.locator('[role="listbox"] [role="option"]').first().click();
}

test('U-Tech Smart Manufacturing ERP — Full End-to-End Verification', async ({ page }) => {
  test.setTimeout(120000);

  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror (${page.url()}): ${e.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400 && res.url().includes('/api/')) {
      errors.push(`API ${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });

  // 1. Login & Dashboard
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.fill('input#login-email', 'admin@utech.local');
  await page.fill('input#login-password', 'Admin@123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/');
  await expect(page.locator('main')).toContainText(/Dashboard|Overview|Revenue|Jobcard/i);

  // 2. Navigate across all core ERP modules
  const routes = [
    '/',
    '/parties',
    '/items',
    '/boms',
    '/quotations',
    '/jobcards',
    '/assignments',
    '/my-tasks',
    '/tasks',
    '/processes',
    '/machines',
    '/production',
    '/production/batches',
    '/production/batches/new',
    '/production/shifts',
    '/invoices',
    '/sales-returns',
    '/back-orders',
    '/purchase-orders',
    '/grns',
    '/purchase-returns',
    '/stock',
    '/customer-material',
    '/jobwork',
    '/vendor-work-orders',
    '/dispatch',
    '/quality',
    '/projects',
    '/expenses',
    '/reports',
    '/analytics/sales',
    '/analytics/production',
    '/analytics/inventory',
    '/users',
    '/roles',
    '/departments',
    '/department-subcategories',
  ];

  for (const r of routes) {
    await page.goto(r);
    await expect(page.locator('main')).toBeVisible();
  }

  // 3. Empty-line validation guards on Quotation, BackOrder, and BOM forms
  await page.goto('/quotations/new');
  await pickFirstOption(page, 'form button[aria-haspopup="listbox"]');
  await page.click('button[type="submit"]');
  expect(page.url()).toContain('/quotations/new');

  await page.goto('/back-orders/new');
  await pickFirstOption(page, '#bo-party');
  await page.click('button[type="submit"]');
  expect(page.url()).toContain('/back-orders/new');

  await page.goto('/boms/new');
  await page.fill('#bom-code', 'BOM-EMPTY-TEST');
  await page.fill('#bom-name', 'Empty BOM Guard Test');
  await page.click('button[type="submit"]');
  expect(page.url()).toContain('/boms/new');

  // 4. Create Quotation, Manual Invoice, and Purchase Order
  await page.goto('/quotations/new');
  await pickFirstOption(page, 'form button[aria-haspopup="listbox"]');
  await page.click('button:has-text("Add Item")');
  await page.fill('input[placeholder="Part name"]', 'CNC Turned Shaft');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/quotations**');

  await page.goto('/invoices/new');
  await pickFirstOption(page, '#invoice-party');
  const invRowInputs = page.locator('table tbody tr').first().locator('input');
  await invRowInputs.nth(0).fill('Custom Precision Machining');
  await invRowInputs.nth(2).fill('2');
  await invRowInputs.nth(3).fill('1500');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/invoices**');

  await page.goto('/purchase-orders/new');
  await pickFirstOption(page, '#partyId');
  await pickFirstOption(page, '#line-0-item');
  await page.fill('#line-0-qty', '5');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/purchase-orders');

  expect(errors).toEqual([]);
});
