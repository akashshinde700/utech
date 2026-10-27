import { test, expect } from '@playwright/test';

// INVENTORY & RETURN SAFEGUARDS — audit pass 2026-10-27 (AUD-210 / AUD-211)
//
// These run against the isolated, seeded in-memory backend that
// `npm run test:e2e` starts (never a real database). They drive the real
// browser dialogs and prove the two rules through the UI:
//
//   AUD-210  cancelling a GRN whose stock is already gone is REFUSED, and the
//            forced negative reversal only exists as an explicit second click
//            for a stock administrator.
//   AUD-211  a sales return cannot put stock back until the physical return
//            receipt (challan no. + received date) is recorded.

test.beforeAll(() => {
  if (process.env.E2E_USE_DEMO !== '1' && process.env.E2E_CONFIRM_DISPOSABLE !== '1') {
    throw new Error('Workflow tests modify data. Use npm run test:e2e or set E2E_CONFIRM_DISPOSABLE=1 for a disposable external environment.');
  }
});

test.setTimeout(120_000);
const today = () => new Date().toISOString().slice(0, 10);

async function login(page) {
  await page.goto('/login');
  await page.locator('#login-email').fill('admin@utech.local');
  await page.locator('#login-password').fill('Admin@123');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/$/);
  return page.evaluate(() => localStorage.getItem('utech.token'));
}

async function api(page, token, method, url, data, expected = 200) {
  const response = await page.request.fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    ...(data === undefined ? {} : { data }),
  });
  const text = await response.text();
  expect(response.status(), `${method} ${url}: ${text}`).toBe(expected);
  return text ? JSON.parse(text) : null;
}

async function stockOf(page, token, itemId) {
  const item = await api(page, token, 'GET', `/api/items/${itemId}`);
  return Number(item.currentStock);
}

async function findParty(page, token, type, name) {
  const params = new URLSearchParams({ type, pageSize: '100', q: name });
  const list = await api(page, token, 'GET', `/api/parties?${params}`);
  const party = list.items.find((p) => p.name === name);
  expect(party, `${type} ${name} missing from the seed`).toBeTruthy();
  return party;
}

// ---------------------------------------------------------------------------
// AUD-210 — GRN cancellation
// ---------------------------------------------------------------------------

test('GRN cancel refuses to go negative, then allows an explicit forced reversal', async ({ page }) => {
  const token = await login(page);
  const name = `E2E GRN Guard ${Date.now()}`;
  const item = await api(page, token, 'POST', '/api/items', {
    name, type: 'RAW_MATERIAL', openingStock: 0, purchaseRate: 50, saleRate: 100, gstRate: 0,
  }, 201);
  const vendor = await findParty(page, token, 'VENDOR', 'XYZ Traders');
  const customer = await findParty(page, token, 'CUSTOMER', 'Sample Customer Pvt Ltd');

  // receive 5 ...
  const grn = await api(page, token, 'POST', '/api/grns', {
    date: today(), partyId: vendor.id,
    lines: [{ itemId: item.id, qty: 5, qtyAccepted: 5, qtyRejected: 0, rate: 10 }],
  }, 201);
  expect(await stockOf(page, token, item.id)).toBe(5);

  // ... and ship all 5 out, so there is nothing left to give back
  await api(page, token, 'POST', '/api/dispatch', {
    date: today(), partyId: customer.id, lines: [{ itemId: item.id, qty: 5 }],
  }, 201);
  expect(await stockOf(page, token, item.id)).toBe(0);

  await page.goto(`/grns/${grn.id}`);
  await page.getByRole('button', { name: 'Cancel GRN' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#grn-cancel-reason').fill('Booked against the wrong vendor');
  await dialog.getByRole('button', { name: 'Cancel GRN', exact: true }).click();

  // the refusal is explained in the dialog, and no stock moved
  const alert = dialog.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Stock is no longer available');
  await expect(alert).toContainText(name);
  expect(await stockOf(page, token, item.id)).toBe(0);

  // a stock administrator may still force the reversal — one explicit click
  await dialog.getByRole('button', { name: /Reverse anyway/ }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => stockOf(page, token, item.id)).toBe(-5);

  const cancelled = await api(page, token, 'GET', `/api/grns/${grn.id}`);
  expect(cancelled.status).toBe('CANCELLED');
  const ledger = await api(page, token, 'GET', `/api/items/${item.id}/stock`);
  expect(ledger[ledger.length - 1].refType).toBe('GRN_CANCEL');
  expect(ledger[ledger.length - 1].notes).toMatch(/forced negative-stock reversal/i);
});

// ---------------------------------------------------------------------------
// AUD-211 — sales return physical receipt
// ---------------------------------------------------------------------------

test('sales return cannot restore stock without a physical receipt', async ({ page }) => {
  const token = await login(page);
  const name = `E2E Return Guard ${Date.now()}`;
  const item = await api(page, token, 'POST', '/api/items', {
    name, type: 'FINISHED', openingStock: 20, purchaseRate: 50, saleRate: 100, gstRate: 0,
  }, 201);
  const customer = await findParty(page, token, 'CUSTOMER', 'Sample Customer Pvt Ltd');

  const invoice = await api(page, token, 'POST', '/api/invoices', {
    date: today(), partyId: customer.id, isIntraState: true, discount: 0,
    lines: [{ itemId: item.id, description: name, qty: 10, rate: 100, gstRate: 0 }],
  }, 201);

  const salesReturn = await api(page, token, 'POST', '/api/sales-returns', {
    invoiceId: invoice.id, date: today(),
    lines: [{
      invoiceLineId: invoice.lines[0].id, itemId: item.id, description: name,
      qty: 2, rate: 100, gstRate: 0,
    }],
  }, 201);
  await api(page, token, 'POST', `/api/sales-returns/${salesReturn.id}/approve`);

  // the server refuses to put stock back with no proof
  const refused = await api(page, token, 'POST', `/api/sales-returns/${salesReturn.id}/process`, {}, 400);
  expect(refused.message).toMatch(/physical return receipt/i);
  expect(await stockOf(page, token, item.id)).toBe(20);

  // ... and the screen says the same thing: Process is disabled, with a hint
  await page.goto(`/sales-returns/${salesReturn.id}`);
  const processButton = page.getByRole('button', { name: 'Process', exact: true });
  await expect(processButton).toBeDisabled();
  await expect(page.getByText('Record the physical receipt (challan no. + received date) to process this return.')).toBeVisible();

  // record the receipt through the form
  await page.locator('#return-challan-no').fill(`RC-${Date.now()}`);
  await page.locator('#return-received-at').fill(today());
  await page.getByRole('button', { name: 'Record receipt' }).click();
  await expect(page.getByText('Receipt recorded', { exact: true })).toBeVisible();
  expect(await stockOf(page, token, item.id), 'recording proof must not move stock').toBe(20);

  // now processing is allowed and restores the returned quantity
  await expect(processButton).toBeEnabled();
  await processButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('RC-');
  await dialog.getByRole('button', { name: 'Process', exact: true }).click();
  await expect.poll(() => stockOf(page, token, item.id)).toBe(22);

  const processed = await api(page, token, 'GET', `/api/sales-returns/${salesReturn.id}`);
  expect(processed.status).toBe('PROCESSED');
  expect(processed.returnChallanNo).toMatch(/^RC-/);
  expect(processed.receivedBy?.email).toBe('admin@utech.local');
});

test('sales return receipt is validated: no future dates, no foreign dispatch challans', async ({ page }) => {
  const token = await login(page);
  const name = `E2E Return Validation ${Date.now()}`;
  const item = await api(page, token, 'POST', '/api/items', {
    name, type: 'FINISHED', openingStock: 20, purchaseRate: 50, saleRate: 100, gstRate: 0,
  }, 201);
  const customer = await findParty(page, token, 'CUSTOMER', 'Sample Customer Pvt Ltd');
  const vendor = await findParty(page, token, 'VENDOR', 'XYZ Traders');

  const invoice = await api(page, token, 'POST', '/api/invoices', {
    date: today(), partyId: customer.id, isIntraState: true, discount: 0,
    lines: [{ itemId: item.id, description: name, qty: 5, rate: 100, gstRate: 0 }],
  }, 201);
  const salesReturn = await api(page, token, 'POST', '/api/sales-returns', {
    invoiceId: invoice.id, date: today(),
    lines: [{ invoiceLineId: invoice.lines[0].id, itemId: item.id, description: name, qty: 2, rate: 100, gstRate: 0 }],
  }, 201);

  const future = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const futureRes = await api(page, token, 'POST', `/api/sales-returns/${salesReturn.id}/receipt`, {
    returnChallanNo: 'RC-FUTURE', receivedAt: future,
  }, 400);
  expect(futureRes.message).toMatch(/future/i);

  // a dispatch challan that does not exist cannot prove this return
  const foreign = await api(page, token, 'POST', `/api/sales-returns/${salesReturn.id}/receipt`, {
    returnChallanNo: 'RC-FOREIGN', receivedAt: today(), dispatchChallanId: 999999,
  }, 404);
  expect(foreign.message).toMatch(/not found/i);

  // the return is still a draft, and stock never moved
  expect((await api(page, token, 'GET', `/api/sales-returns/${salesReturn.id}`)).status).toBe('DRAFT');
  expect(await stockOf(page, token, item.id)).toBe(20);
  expect(vendor.id).toBeTruthy();
});
