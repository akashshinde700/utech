import { test, expect } from '@playwright/test';

// These workflows write real records. `npm run test:e2e` starts an isolated,
// seeded in-memory backend. Never point them at a production database.
test.beforeAll(() => {
  if (process.env.E2E_USE_DEMO !== '1' && process.env.E2E_CONFIRM_DISPOSABLE !== '1') {
    throw new Error('Workflow tests modify data. Use npm run test:e2e or set E2E_CONFIRM_DISPOSABLE=1 for a disposable external environment.');
  }
});

test.setTimeout(90_000);
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
  const response = await page.request.fetch(url, { method, headers: { Authorization: `Bearer ${token}` }, ...(data === undefined ? {} : { data }) });
  const text = await response.text();
  expect(response.status(), `${method} ${url}: ${text}`).toBe(expected);
  return text ? JSON.parse(text) : null;
}
async function createItem(page, token, name, extra = {}) {
  return api(page, token, 'POST', '/api/items', { name, type: 'RAW_MATERIAL', openingStock: 0, purchaseRate: 50, saleRate: 100, gstRate: 0, ...extra }, 201);
}
async function itemStock(page, token, id) {
  const item = await api(page, token, 'GET', `/api/items/${id}`);
  return Number(item.currentStock);
}
async function choose(page, trigger, text) {
  await trigger.click({ noWaitAfter: true });
  const filter = page.getByRole('combobox', { name: 'Filter options' });
  await filter.fill(text);
  await page.getByRole('option').filter({ hasText: text }).first().click();
}
async function createdBy(page, urlPath, action) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith(urlPath) && r.request().method() === 'POST', { timeout: 10000 }),
    action(),
  ]);
  const body = await response.json();
  expect(response.status(), `${urlPath}: ${JSON.stringify(body)}`).toBe(201);
  return body;
}

// Opening stock, a correction, purchasing and dispatch are all posted through
// the actual browser forms; the ledger and balances are checked through HTTP.
test('store: opening stock, +/- adjustments, GRN, dispatch, ledger and reversal', async ({ page }) => {
  const token = await login(page);
  const name = `E2E Store Material ${Date.now()}`;
  await page.goto('/items/new');
  await page.locator('#item-name').fill(name);
  await page.locator('#item-opening-stock').fill('10');
  await page.locator('#item-purchase-rate').fill('50');
  await page.locator('#item-sale-rate').fill('100');
  await page.locator('#item-gst-rate').fill('0');
  const item = await createdBy(page, '/api/items', () => page.getByRole('button', { name: 'Save', exact: true }).click());
  expect(await itemStock(page, token, item.id)).toBe(10);
  let ledger = await api(page, token, 'GET', `/api/items/${item.id}/stock`);
  expect(ledger.map((r) => [r.refType, Number(r.qtyIn), Number(r.qtyOut), Number(r.balance)])).toEqual([['OPENING', 10, 0, 10]]);
  expect(Number.isNaN(Date.parse(ledger[0].date))).toBe(false);

  await page.goto('/stock');
  await choose(page, page.locator('#adj-item'), name);
  await page.locator('#adj-qty').fill('5');
  await page.locator('#adj-notes').fill('Count correction in');
  await page.getByRole('button', { name: 'Apply Adjustment' }).click();
  const confirmIn = page.getByRole('dialog');
  await expect(confirmIn).toContainText('5');
  await confirmIn.getByRole('button', { name: 'Apply adjustment' }).click();
  await expect.poll(() => itemStock(page, token, item.id)).toBe(15);
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Apply Adjustment' })).toBeEnabled();
  await choose(page, page.locator('#adj-item'), name);
  await page.locator('#adj-qty').fill('-3');
  await page.locator('#adj-notes').fill('Count correction out');
  await page.getByRole('button', { name: 'Apply Adjustment' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Apply adjustment' }).click();
  await expect.poll(() => itemStock(page, token, item.id)).toBe(12);
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Apply Adjustment' })).toBeEnabled();

  await page.getByRole('link', { name: 'Receive stock' }).click();
  await page.waitForURL('**/grns/new');
  await choose(page, page.locator('#partyId'), 'XYZ Traders');
  await choose(page, page.locator('#line-0-item'), name);
  await page.locator('#line-0-qty').fill('8');
  await expect(page.getByLabel('Line 1 accepted quantity')).toHaveValue('8');
  await page.getByLabel('Line 1 rejected quantity').fill('2');
  await expect(page.getByLabel('Line 1 accepted quantity')).toHaveValue('6');
  const grn = await createdBy(page, '/api/grns', () => page.getByRole('button', { name: 'Save', exact: true }).click());
  expect(await itemStock(page, token, item.id)).toBe(18);
  expect(Number(grn.lines[0].qtyAccepted)).toBe(6);

  await page.waitForURL('**/grns');
  await page.getByRole('button', { name: 'Sales', exact: true }).click();
  await page.getByRole('link', { name: 'Dispatch', exact: true }).click();
  await page.getByRole('link', { name: 'New dispatch' }).click();
  await choose(page, page.locator('#partyId'), 'Sample Customer Pvt Ltd');
  await choose(page, page.locator('#line-0-item'), name);
  await page.locator('#line-0-qty').fill('4');
  await expect(page.locator('#partyId')).toContainText('Sample Customer Pvt Ltd');
  await expect(page.locator('#line-0-item')).toContainText(name);
  const dispatch = await createdBy(page, '/api/dispatch', () => page.getByRole('button', { name: 'Save', exact: true }).click());
  expect(await itemStock(page, token, item.id)).toBe(14);
  // Insufficient stock must not leave a partial document or ledger movement.
  const customer = (await api(page, token, 'GET', '/api/parties?type=CUSTOMER&pageSize=100&q=Sample%20Customer')).items.find((p) => p.name === 'Sample Customer Pvt Ltd');
  await api(page, token, 'POST', '/api/dispatch', { date: today(), partyId: customer.id, lines: [{ itemId: item.id, qty: 999 }] }, 400);
  expect(await itemStock(page, token, item.id)).toBe(14);
  ledger = await api(page, token, 'GET', `/api/items/${item.id}/stock`);
  expect(ledger.map((r) => [r.refType, Number(r.qtyIn), Number(r.qtyOut), Number(r.balance)])).toEqual([
    ['OPENING', 10, 0, 10], ['ADJUSTMENT', 5, 0, 15], ['ADJUSTMENT', 0, 3, 12], ['GRN', 6, 0, 18], ['DISPATCH', 0, 4, 14],
  ]);
  await page.waitForURL('**/dispatch');
  await page.getByRole('row').filter({ hasText: dispatch.number }).getByRole('button', { name: 'Cancel dispatch' }).click();
  const [cancelResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith(`/api/dispatch/${dispatch.id}/status/CANCELLED`) && r.request().method() === 'POST'),
    page.getByRole('dialog').getByRole('button', { name: 'Cancel dispatch' }).click(),
  ]);
  expect(cancelResponse.status()).toBe(200);
  await api(page, token, 'POST', `/api/dispatch/${dispatch.id}/status/CANCELLED`, undefined, 400);
  expect(await itemStock(page, token, item.id)).toBe(18);
  await api(page, token, 'DELETE', `/api/grns/${grn.id}`, { reason: 'E2E reversal' });
  expect(await itemStock(page, token, item.id)).toBe(12);
  await api(page, token, 'DELETE', `/api/grns/${grn.id}`, { reason: 'again' }, 400);
  expect(await itemStock(page, token, item.id)).toBe(12);
});

test('PO-linked receipt accepts only outstanding quantities and rolls back on rejection', async ({ page }) => {
  const token = await login(page);
  const name = `E2E PO Material ${Date.now()}`;
  const item = await createItem(page, token, name);
  const other = await createItem(page, token, `${name} Other`);
  const vendor = (await api(page, token, 'GET', '/api/parties?type=VENDOR&pageSize=100&q=XYZ%20Traders')).items.find((p) => p.name === 'XYZ Traders');
  const po = await api(page, token, 'POST', '/api/purchase-orders', {
    date: today(), partyId: vendor.id,
    lines: [{ itemId: item.id, description: name, qty: 10, rate: 0, gstRate: 0 }, { description: 'Custom tooling work', qty: 2, rate: 12, gstRate: 0 }],
  }, 201);
  await api(page, token, 'POST', `/api/purchase-orders/${po.id}/approve`);

  await page.goto('/grns/new');
  await choose(page, page.locator('#poId'), po.number);
  await expect(page.locator('#partyId')).toContainText('XYZ Traders');
  await expect(page.locator('#partyId')).toBeDisabled();
  await expect(page.locator('#line-0-qty')).toHaveValue('10');
  await expect(page.getByText('Custom tooling work')).toBeVisible();
  await page.locator('#line-0-qty').fill('5');
  await expect(page.getByLabel('Line 1 accepted quantity')).toHaveValue('5');
  const grn = await createdBy(page, '/api/grns', () => page.getByRole('button', { name: 'Save', exact: true }).click());
  expect(await itemStock(page, token, item.id)).toBe(5);
  expect(grn.lines[0].rate).not.toBeNull();
  expect(Number(grn.lines[0].rate)).toBe(0);
  let after = await api(page, token, 'GET', `/api/purchase-orders/${po.id}`);
  expect(after.lines.map((l) => Number(l.qtyReceived))).toEqual([5, 2]);

  const poLineId = after.lines[0].id;
  await api(page, token, 'POST', '/api/grns', { date: today(), poId: po.id, partyId: vendor.id, lines: [{ poLineId, itemId: item.id, qty: 6, qtyAccepted: 6 }] }, 400);
  await api(page, token, 'POST', '/api/grns', { date: today(), poId: po.id, partyId: vendor.id, lines: [{ poLineId, itemId: other.id, qty: 1, qtyAccepted: 1 }] }, 400);
  await api(page, token, 'POST', '/api/grns', { date: today(), poId: po.id, partyId: vendor.id, lines: [{ poLineId, itemId: item.id, qty: 3, qtyAccepted: 3 }, { poLineId, itemId: item.id, qty: 3, qtyAccepted: 3 }] }, 400);
  expect(await itemStock(page, token, item.id)).toBe(5);
  after = await api(page, token, 'GET', `/api/purchase-orders/${po.id}`);
  expect(after.lines.map((l) => Number(l.qtyReceived))).toEqual([5, 2]);
  await api(page, token, 'DELETE', `/api/grns/${grn.id}`, { reason: 'E2E reversal' });
  expect(await itemStock(page, token, item.id)).toBe(0);
  after = await api(page, token, 'GET', `/api/purchase-orders/${po.id}`);
  expect(after.lines.map((l) => Number(l.qtyReceived))).toEqual([0, 0]);
});

test('invoice preview, zero GST, payment, account ledger and PDF do not move stock', async ({ page }) => {
  const token = await login(page);
  const name = `E2E Invoice Material ${Date.now()}`;
  const item = await createItem(page, token, name, { openingStock: 7 });
  const customer = (await api(page, token, 'GET', '/api/parties?type=CUSTOMER&pageSize=100&q=Sample%20Customer')).items.find((p) => p.name === 'Sample Customer Pvt Ltd');
  await page.goto('/invoices/new');
  await expect(page.getByText('Billing does not move stock.')).toBeVisible();
  await choose(page, page.locator('#invoice-party'), customer.name);
  await choose(page, page.getByRole('button', { name: '— manual —' }).first(), name);
  const row = page.locator('table tbody tr').first();
  await expect(row.locator('input').nth(3)).toHaveValue('100');
  await expect(row.locator('input').nth(4)).toHaveValue('0');
  await row.locator('input').nth(2).fill('3');
  await page.locator('#invoice-discount').fill('25');
  await expect(page.getByText('₹ 275.00', { exact: true }).last()).toBeVisible();
  const invoice = await createdBy(page, '/api/invoices', () => page.getByRole('button', { name: 'Save', exact: true }).click());
  expect([Number(invoice.subtotal), Number(invoice.discount), Number(invoice.cgst), Number(invoice.sgst), Number(invoice.igst), Number(invoice.total)]).toEqual([300, 25, 0, 0, 0, 275]);
  expect(await itemStock(page, token, item.id)).toBe(7);

  // Wait for the create form's redirect before opening the saved document;
  // otherwise it races a hard navigation and can leave the renderer waiting.
  await page.waitForURL('**/invoices');
  await page.getByRole('row').filter({ hasText: invoice.number }).click();
  await page.waitForURL(`**/invoices/${invoice.id}`);
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.locator('#pay-amount').fill('300');
  await page.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByText(/exceeds the remaining balance/i)).toBeVisible();
  await page.locator('#pay-amount').fill('100');
  const [payment] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith(`/api/invoices/${invoice.id}/payments`) && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Save payment' }).click({ noWaitAfter: true }),
  ]);
  expect(payment.status()).toBe(200);
  await expect(page.getByText(/This invoice has payments/)).toBeVisible();
  await api(page, token, 'PUT', `/api/invoices/${invoice.id}`, { discount: 50 }, 400);
  await api(page, token, 'DELETE', `/api/invoices/${invoice.id}`, undefined, 400);
  await api(page, token, 'POST', `/api/invoices/${invoice.id}/payments`, { date: today(), amount: 175.001, mode: 'BANK' }, 400);
  await api(page, token, 'POST', `/api/invoices/${invoice.id}/payments`, { date: today(), amount: 176, mode: 'BANK' }, 400);
  const paid = await api(page, token, 'POST', `/api/invoices/${invoice.id}/payments`, { date: today(), amount: 175, mode: 'BANK' });
  expect([paid.status, Number(paid.amountPaid)]).toEqual(['PAID', 275]);
  expect(await itemStock(page, token, item.id)).toBe(7);
  const partyLedger = await api(page, token, 'GET', `/api/parties/${customer.id}/ledger`);
  const entries = Array.isArray(partyLedger) ? partyLedger : partyLedger.entries;
  expect(entries.filter((e) => e.refId === invoice.id && e.refType === 'invoice').map((e) => Number(e.debit))).toEqual([275]);
  expect(entries.filter((e) => e.refId === invoice.id && e.refType === 'payment').map((e) => Number(e.credit)).sort((a, b) => a - b)).toEqual([100, 175]);
  const pdf = await page.request.get(`/api/invoices/${invoice.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
});

test('production consumes saved actual quantities; customer material stays separate', async ({ page }) => {
  const token = await login(page);
  const raw = await createItem(page, token, `E2E Raw ${Date.now()}`, { openingStock: 20 });
  const unused = await createItem(page, token, `E2E Unused ${Date.now()}`, { openingStock: 9 });
  const finished = await createItem(page, token, `E2E Finished ${Date.now()}`, { type: 'FINISHED', openingStock: 2 });
  const customer = (await api(page, token, 'GET', '/api/parties?type=CUSTOMER&pageSize=100&q=Sample%20Customer')).items.find((p) => p.name === 'Sample Customer Pvt Ltd');
  const shifts = await api(page, token, 'GET', '/api/production/shifts');
  const batch = await api(page, token, 'POST', '/api/production/batches', {
    date: today(), shiftId: shifts[0].id, itemId: finished.id, qtyPlanned: 3,
    materialConsumptions: [{ itemId: raw.id, qtyPlanned: 4 }, { itemId: unused.id, qtyPlanned: 5, qtyConsumed: 0 }],
  }, 201);
  expect(batch.materialConsumptions.map((m) => Number(m.qtyConsumed))).toEqual([4, 0]);
  await api(page, token, 'POST', `/api/production/batches/${batch.id}/start`);
  await page.goto(`/production/batches/${batch.id}`);
  await expect(page.getByRole('heading', { name: /Production Batch/ })).toBeVisible();
  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  await page.locator('#qty-produced').fill('3');
  await page.getByRole('dialog').getByRole('button', { name: 'Complete batch' }).click();
  await expect.poll(() => itemStock(page, token, finished.id)).toBe(5);
  expect(await itemStock(page, token, raw.id)).toBe(16);
  expect(await itemStock(page, token, unused.id)).toBe(9);
  await api(page, token, 'POST', `/api/production/batches/${batch.id}/complete`, { qtyProduced: 3 }, 400);

  const lot = await api(page, token, 'POST', '/api/customer-material', { customerId: customer.id, itemId: raw.id, materialDescription: 'Customer-owned material', qty: 10, receivedDate: today() }, 201);
  await api(page, token, 'POST', `/api/customer-material/${lot.id}/consume`, { qty: 3 });
  const lotAfter = await api(page, token, 'GET', `/api/customer-material/${lot.id}`);
  expect(Number(lotAfter.availableQty)).toBe(7);
  expect(await itemStock(page, token, raw.id)).toBe(16);
  await api(page, token, 'POST', `/api/customer-material/${lot.id}/consume`, { qty: 8 }, 400);
  expect(await itemStock(page, token, raw.id)).toBe(16);
});

test('mobile store page scrolls and ledger can be read horizontally', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto('/stock');
  await expect(page.getByText('Manual Adjustment')).toBeVisible();
  await page.locator('#adj-qty').scrollIntoViewIfNeeded();
  const metrics = await page.evaluate(() => {
    const table = document.querySelector('table');
    return { scrollY: window.scrollY, tableWidth: table.scrollWidth, wrapperWidth: table.parentElement.clientWidth };
  });
  expect(metrics.scrollY).toBeGreaterThan(0);
  expect(metrics.tableWidth).toBeGreaterThan(metrics.wrapperWidth);
});

test('purchase, receipt, dispatch and invoice selectors find records beyond the first 100', async ({ page }) => {
  const token = await login(page);
  const suffix = Date.now();
  const oldItem = await createItem(page, token, `E2E Older Item ${suffix}`);
  const oldCustomer = await api(page, token, 'POST', '/api/parties', { name: `E2E Older Customer ${suffix}`, type: 'CUSTOMER' }, 201);
  const oldVendor = await api(page, token, 'POST', '/api/parties', { name: `E2E Older Vendor ${suffix}`, type: 'VENDOR' }, 201);
  // More than a page of newer items/parties, so the normal initial lookup
  // cannot contain the older records. The search must reach the API.
  for (let i = 0; i < 105; i += 1) {
    await createItem(page, token, `E2E Newer Item ${suffix} ${i}`);
    await api(page, token, 'POST', '/api/parties', { name: `E2E Newer Party ${suffix} ${i}`, type: 'BOTH' }, 201);
  }
  const firstItems = (await api(page, token, 'GET', '/api/items?pageSize=100')).items;
  const firstCustomers = (await api(page, token, 'GET', '/api/parties?type=CUSTOMER&pageSize=100')).items;
  expect(firstItems.some((item) => item.id === oldItem.id)).toBe(false);
  expect(firstCustomers.some((party) => party.id === oldCustomer.id)).toBe(false);

  await page.goto('/invoices/new');
  await choose(page, page.locator('#invoice-party'), oldCustomer.name);
  await choose(page, page.getByRole('button', { name: '— manual —' }).first(), oldItem.name);
  await expect(page.locator('#invoice-party')).toContainText(oldCustomer.name);
  await expect(page.locator('table tbody tr').first()).toContainText(oldItem.name);

  await page.goto('/purchase-orders/new');
  await choose(page, page.locator('#partyId'), oldVendor.name);
  await choose(page, page.locator('#line-0-item'), oldItem.name);
  await expect(page.getByLabel('Line 1 rate')).toHaveValue('50');
  await expect(page.locator('#line-0-gstRate')).toHaveValue('0');

  await page.goto('/grns/new');
  await choose(page, page.locator('#partyId'), oldVendor.name);
  await choose(page, page.locator('#line-0-item'), oldItem.name);
  await expect(page.locator('#line-0-item')).toContainText(oldItem.name);

  await page.goto('/dispatch/new');
  await choose(page, page.locator('#partyId'), oldCustomer.name);
  await choose(page, page.locator('#line-0-item'), oldItem.name);
  await expect(page.locator('#line-0-item')).toContainText(oldItem.name);
});

test('jobwork issue and partial returns preserve stock and rejection status', async ({ page }) => {
  const token = await login(page);
  const vendor = (await api(page, token, 'GET', '/api/parties?type=VENDOR&pageSize=100&q=XYZ%20Traders')).items.find((p) => p.name === 'XYZ Traders');
  const item = await createItem(page, token, 'Jobwork item', { openingStock: 10 });
  const jw = await api(page, token, 'POST', '/api/jobwork', {
    date: '2026-01-15', partyId: vendor.id, materialOwnerType: 'COMPANY',
    lines: [{ itemId: item.id, qtySent: 4 }],
  }, 201);
  expect(await itemStock(page, token, item.id)).toBe(6);
  const line = jw.lines[0];
  const duplicate = await page.request.post(`/api/jobwork/${jw.id}/receive`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { lines: [{ id: line.id, qtyReceived: 1 }, { id: line.id, qtyReceived: 1 }] },
  });
  expect(duplicate.status()).toBe(400);
  expect(await itemStock(page, token, item.id)).toBe(6);
  const partial = await api(page, token, 'POST', `/api/jobwork/${jw.id}/receive`, {
    lines: [{ id: line.id, qtyReceived: 2, qtyRejected: 1 }],
  });
  expect(partial.status).toBe('PARTIAL_RECEIVED');
  expect(await itemStock(page, token, item.id)).toBe(9);
  const complete = await api(page, token, 'POST', `/api/jobwork/${jw.id}/receive`, {
    lines: [{ id: line.id, qtyReceived: 1 }],
  });
  expect(complete.status).toBe('REJECTED');
  expect(await itemStock(page, token, item.id)).toBe(10);
});


test('GRN can be cancelled from its detail screen', async ({ page }) => {
  const token = await login(page);
  const item = await createItem(page, token, `GRN reversal ${Date.now()}`);
  const vendor = (await api(page, token, 'GET', '/api/parties?type=VENDOR&pageSize=100&q=XYZ%20Traders')).items.find((p) => p.name === 'XYZ Traders');
  const grn = await api(page, token, 'POST', '/api/grns', {
    date: today(), partyId: vendor.id, lines: [{ itemId: item.id, qty: 6, qtyAccepted: 6 }],
  }, 201);
  expect(await itemStock(page, token, item.id)).toBe(6);
  await page.goto(`/grns/${grn.id}`);
  await page.getByRole('button', { name: 'Cancel GRN' }).click();
  await expect(page.getByRole('dialog')).toContainText('negative');
  await page.locator('#grn-cancel-reason').fill('Receipt correction');
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith(`/api/grns/${grn.id}`) && r.request().method() === 'DELETE'),
    page.getByRole('dialog').getByRole('button', { name: 'Cancel GRN' }).click({ noWaitAfter: true }),
  ]);
  expect(response.status()).toBe(200);
  await expect(page.getByText('CANCELLED', { exact: true })).toBeVisible();
  expect(await itemStock(page, token, item.id)).toBe(0);
});

test('ledger filters by item and includes the entire document end date', async ({ page }) => {
  const token = await login(page);
  const item = await createItem(page, token, `Ledger filter ${Date.now()}`, { openingStock: 0.003 });
  await page.goto('/stock');
  await choose(page, page.locator('#ledger-item'), item.name);
  await page.locator('#ledger-from').fill(today());
  await page.locator('#ledger-to').fill(today());
  const row = page.getByRole('row').filter({ hasText: item.name });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('0.003');
});
