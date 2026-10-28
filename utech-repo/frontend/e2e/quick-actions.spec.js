import { test, expect } from '@playwright/test';

async function login(page) {
  await page.goto('/login');
  await page.locator('#login-email').fill('admin@utech.local');
  await page.locator('#login-password').fill('Admin@123');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/$/);
}

test('quick navigation supports keyboard search, selection, and safe typing', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /Search pages and actions/ }).first().focus();
  await page.keyboard.press('Control+Shift+k');
  const dialog = page.getByRole('dialog', { name: 'Quick navigation' });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole('searchbox', { name: 'Search pages and actions' });
  await expect(search).toBeFocused();
  await search.fill('invoices');
  await expect(dialog.getByRole('option', { name: /Invoices/ }).first()).toBeVisible();
  await search.press('Enter');
  await expect(page).toHaveURL(/\/invoices$/);
  await expect(dialog).toBeHidden();

  // Slash is a convenience search key outside fields, but must remain ordinary
  // text when a user is typing into a page's search field.
  await page.getByRole('button', { name: /Search pages and actions/ }).first().focus();
  await page.keyboard.press('/');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  const pageSearch = page.getByPlaceholder('Search invoice # or party');
  await pageSearch.focus();
  await page.keyboard.type('/');
  await expect(pageSearch).toHaveValue('/');
  await expect(dialog).toBeHidden();
});

test('quick navigation searches permitted actions and supports arrow selection', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /Search pages and actions/ }).first().focus();
  await page.keyboard.press('Control+Shift+k');
  const dialog = page.getByRole('dialog', { name: 'Quick navigation' });
  const search = dialog.getByRole('searchbox', { name: 'Search pages and actions' });
  await search.fill('new invoice');
  await expect(dialog.getByRole('option', { name: /New Invoice/ })).toBeVisible();
  await search.press('ArrowDown');
  await search.press('ArrowUp');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/invoices\/new$/);
});
