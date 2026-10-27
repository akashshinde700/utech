import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
const ExcelJS = backendRequire('exceljs');
const today = () => new Date().toISOString().slice(0, 10);

test.beforeAll(() => {
  if (process.env.E2E_USE_DEMO !== '1' && process.env.E2E_CONFIRM_DISPOSABLE !== '1') {
    throw new Error('These write tests require a disposable environment.');
  }
});

test.setTimeout(90_000);

async function login(page) {
  await page.goto('/login');
  await page.locator('#login-email').fill('admin@utech.local');
  await page.locator('#login-password').fill('Admin@123');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/$/);
  return page.evaluate(() => localStorage.getItem('utech.token'));
}

async function api(page, token, method, url, body, expected = 200) {
  const r = await page.request.fetch(url, {
    method, headers: { Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { data: body }),
  });
  const text = await r.text();
  expect(r.status(), `${method} ${url}: ${text}`).toBe(expected);
  return text ? JSON.parse(text) : null;
}

async function newParty(page, token, type) {
  return api(page, token, 'POST', '/api/parties', { name: `Audit ${type} ${Date.now()}-${Math.random()}`, type }, 201);
}

async function newLot(page, token, customerId, qty = 100) {
  return api(page, token, 'POST', '/api/customer-material', {
    customerId, materialDescription: 'Audit customer-owned material', qty, weight: 50,
    receivedDate: today(), uomCode: 'PCS',
  }, 201);
}

async function issue(page, token, vendorId, lotId, quantities, expected = 201) {
  return api(page, token, 'POST', '/api/jobwork', {
    date: today(), partyId: vendorId, materialOwnerType: 'CUSTOMER', customerMaterialLotId: lotId,
    lines: quantities.map((qtySent) => ({ description: 'Customer material', qtySent })),
  }, expected);
}

async function pdfPages(response) {
  const bytes = new Uint8Array(await response.body());
  const doc = await getDocument({ data: bytes, useSystemFonts: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const text = await (await doc.getPage(i)).getTextContent();
    pages.push(text.items.filter((item) => typeof item.str === 'string'));
  }
  await doc.destroy();
  return pages;
}

test('customer inward: split issues, rejections, vendor status and rollback reconcile', async ({ page }) => {
  const token = await login(page);
  const customer = await newParty(page, token, 'CUSTOMER');
  const vendor = await newParty(page, token, 'VENDOR');
  const lot = await newLot(page, token, customer.id);
  const first = await issue(page, token, vendor.id, lot.id, [40]);
  const second = await issue(page, token, vendor.id, lot.id, [30]);
  let saved = await api(page, token, 'GET', `/api/customer-material/${lot.id}`);
  expect([Number(saved.availableQty), saved.status]).toEqual([30, 'AT_VENDOR']);

  await issue(page, token, vendor.id, lot.id, [31], 400);
  saved = await api(page, token, 'GET', `/api/customer-material/${lot.id}`);
  expect(Number(saved.availableQty)).toBe(30);
  expect(saved.stockLedger.map((row) => Number(row.balance))).toEqual([100, 60, 30]);

  await api(page, token, 'POST', `/api/jobwork/${first.id}/receive`, {
    lines: [{ id: first.lines[0].id, qtyReceived: 35, qtyRejected: 5 }],
  });
  saved = await api(page, token, 'GET', `/api/customer-material/${lot.id}`);
  expect([Number(saved.availableQty), saved.status]).toEqual([70, 'AT_VENDOR']);
  await api(page, token, 'POST', `/api/jobwork/${second.id}/receive`, {
    lines: [{ id: second.lines[0].id, qtyReceived: 30, qtyRejected: 0 }],
  });
  saved = await api(page, token, 'GET', `/api/customer-material/${lot.id}`);
  expect([Number(saved.availableQty), saved.status]).toEqual([100, 'IN_PROCESS']);
  const net = saved.stockLedger.reduce((sum, row) => sum + Number(row.qtyIn) - Number(row.qtyOut), 0);
  expect(net).toBe(100);
  // Original inward weight stays unchanged; unmeasured movements make the
  // separate on-hand weight unknown until a physical reconciliation.
  expect(Number(saved.weight)).toBe(50);
  expect(saved.currentWeight).toBeNull();

  const rollbackLot = await newLot(page, token, customer.id, 10);
  await issue(page, token, vendor.id, rollbackLot.id, [5, 6], 400);
  const after = await api(page, token, 'GET', `/api/customer-material/${rollbackLot.id}`);
  expect([Number(after.availableQty), after.status, after.stockLedger.length]).toEqual([10, 'RECEIVED', 1]);
  const challans = await api(page, token, 'GET', '/api/jobwork?pageSize=100');
  expect(challans.items.some((row) => row.customerMaterialLotId === rollbackLot.id)).toBe(false);
});

test('UI reserves one inward across job cards with measured quantity and weight', async ({ page }) => {
  const token = await login(page);
  const customer = await newParty(page, token, 'CUSTOMER');
  const lot = await newLot(page, token, customer.id);
  const cards = [];
  for (let i = 0; i < 2; i++) cards.push(await api(page, token, 'POST', '/api/jobcards', { date: today(), partyId: customer.id }, 201));
  await page.goto(`/customer-material/${lot.id}`);
  const section = page.getByRole('region', { name: 'Job card material reservations' });
  await expect(section).toContainText('Unallocated qty: 100');
  await expect(section).toContainText('Unallocated weight: 50');
  for (const [card, qty, weight] of [[cards[0], '40', '20'], [cards[1], '30', '15']]) {
    await page.locator('#allocation-card').click();
    await page.getByRole('option', { name: card.number, exact: true }).click();
    await page.locator('#allocation-qty').fill(qty);
    await page.locator('#allocation-weight').fill(weight);
    await section.getByRole('button', { name: 'Reserve material' }).click();
    await expect(section.getByRole('row', { name: new RegExp(card.number) })).toContainText('Reserved');
  }
  await expect(section).toContainText('Unallocated qty: 30');
  await expect(section).toContainText('Unallocated weight: 15');
  const firstRow = section.getByRole('row', { name: new RegExp(cards[0].number) });
  await firstRow.getByRole('button', { name: 'Release' }).click();
  const dialog = page.getByRole('dialog', { name: 'Release reservation' });
  await dialog.locator('#release-reason').fill('Unused reservation');
  await dialog.getByRole('button', { name: 'Release', exact: true }).click();
  await expect(section).toContainText('Unallocated qty: 70');
  await expect(section).toContainText('Unallocated weight: 35');
  await page.getByRole('button', { name: 'Mark Consumed' }).click();
  const action = page.getByRole('dialog', { name: 'Mark Consumed' });
  await action.locator('#cm-action-qty').fill('25');
  await action.locator('#cm-action-weight').fill('10');
  await action.getByRole('button', { name: 'Confirm' }).click();
  await expect(section).toContainText('Unallocated qty: 45');
  await expect(section).toContainText('Unallocated weight: 25');
  const saved = await api(page, token, 'GET', `/api/customer-material/${lot.id}`);
  expect([saved.availableQty, saved.currentWeight, saved.reservedQty, saved.reservedWeight]).toEqual([75, 40, 30, 15]);
});

test('a lost reservation response warns before retry even when the save committed', async ({ page }) => {
  const token = await login(page);
  const customer = await newParty(page, token, 'CUSTOMER');
  const lot = await newLot(page, token, customer.id);
  const card = await api(page, token, 'POST', '/api/jobcards', { date: today(), partyId: customer.id }, 201);
  await page.goto(`/customer-material/${lot.id}`);
  await page.locator('#allocation-card').click();
  await page.getByRole('option', { name: card.number, exact: true }).click();
  await page.locator('#allocation-qty').fill('10');
  await page.locator('#allocation-weight').fill('5');
  await page.route(`**/api/customer-material/${lot.id}/allocations`, async (route) => {
    await route.fetch(); // let the disposable backend commit, then lose the response
    await route.abort();
  });
  await page.getByRole('button', { name: 'Reserve material' }).click();
  await expect(page.getByText('Reservation result is uncertain. Refresh and verify before retrying.')).toBeVisible();
  const saved = await api(page, token, 'GET', `/api/customer-material/${lot.id}`);
  expect([saved.reservedQty, saved.reservedWeight, saved.allocations.length]).toEqual([10, 5, 1]);
});

test('a failed drawing upload reports the saved job card instead of inviting a duplicate', async ({ page }) => {
  const token = await login(page);
  const projectNumber = `UPLOAD-FAIL-${Date.now()}`;
  await page.goto('/jobcards/new');
  await page.locator('#jc-qtyOrdered').fill('1');
  await page.locator('#jc-projectNumber').fill(projectNumber);
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'drawing.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await page.route('**/api/attachments/JOBCARD/**', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 503, json: { message: 'Injected upload failure' } });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL(/\/jobcards\/\d+$/);
  await expect(page.getByText('Job card saved, but one or more files may not have uploaded. Verify its attachments before retrying.')).toBeVisible();
  const id = Number(new URL(page.url()).pathname.split('/').pop());
  expect((await api(page, token, 'GET', `/api/jobcards/${id}`)).projectNumber).toBe(projectNumber);
  expect(await api(page, token, 'GET', `/api/attachments/JOBCARD/${id}`)).toEqual([]);
});

test('customer jobwork UI carries measured issue and return weights into the lot ledger', async ({ page }) => {
  const token = await login(page);
  const customer = await newParty(page, token, 'CUSTOMER');
  const vendor = await newParty(page, token, 'VENDOR');
  const lot = await newLot(page, token, customer.id);
  await page.goto('/jobwork/new');
  await page.getByRole('button', { name: 'Customer Material', exact: true }).click();
  await page.locator('#jw-partyId').click();
  await page.getByRole('option', { name: new RegExp(vendor.name) }).click();
  await page.locator('#jw-customerMaterialLotId').click();
  await page.getByRole('option', { name: new RegExp(lot.inwardNumber) }).click();
  await page.getByLabel('Line 1 description').fill('Measured parts');
  await page.getByLabel('Line 1 quantity').fill('30');
  await page.getByLabel('Line 1 measured weight').fill('15');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL(/\/jobwork$/);
  let saved = await api(page, token, 'GET', `/api/customer-material/${lot.id}`);
  expect([saved.availableQty, saved.currentWeight]).toEqual([70, 35]);
  const row = page.getByRole('row').filter({ hasText: vendor.name });
  await row.getByRole('button', { name: 'Receive' }).click();
  const dialog = page.getByRole('dialog', { name: 'Receive Challan' });
  await dialog.getByLabel('Line 1 — quantity received now').fill('20');
  await dialog.getByLabel('Line 1 — quantity rejected now').fill('10');
  await dialog.getByLabel('Line 1 — measured received weight').fill('10');
  await dialog.getByLabel('Line 1 — measured rejected weight').fill('5');
  await dialog.getByRole('button', { name: 'Receive', exact: true }).click();
  await expect(dialog).toBeHidden();
  saved = await api(page, token, 'GET', `/api/customer-material/${lot.id}`);
  expect([saved.availableQty, saved.currentWeight]).toEqual([100, 50]);
  expect(saved.stockLedger.map((entry) => entry.weightBalance)).toEqual([50, 35, 45, 50]);
});

test('reservation selector searches for job cards beyond the first page', async ({ page }) => {
  const token = await login(page);
  const customer = await newParty(page, token, 'CUSTOMER');
  const lot = await newLot(page, token, customer.id);
  const old = await api(page, token, 'POST', '/api/jobcards', { date: today(), partyId: customer.id }, 201);
  for (let i = 0; i < 101; i++) await api(page, token, 'POST', '/api/jobcards', { date: today(), partyId: customer.id }, 201);
  const firstPage = await api(page, token, 'GET', '/api/jobcards?pageSize=100');
  expect(firstPage.items.some((card) => card.id === old.id)).toBe(false);
  await page.goto(`/customer-material/${lot.id}`);
  await page.locator('#allocation-card').click();
  await page.getByRole('combobox', { name: 'Filter options' }).fill(old.number);
  await page.getByRole('option', { name: old.number, exact: true }).click();
  await expect(page.locator('#allocation-card')).toContainText(old.number);
});

test('simultaneous customer-lot deductions cannot double spend the demo balance', async ({ page }) => {
  const token = await login(page);
  const customer = await newParty(page, token, 'CUSTOMER');
  const lot = await newLot(page, token, customer.id);
  const requests = await Promise.all([1, 2].map(() => page.request.post(`/api/customer-material/${lot.id}/consume`, {
    headers: { Authorization: `Bearer ${token}` }, data: { qty: 60 },
  })));
  expect(requests.map((r) => r.status()).sort()).toEqual([200, 400]);
  const after = await api(page, token, 'GET', `/api/customer-material/${lot.id}`);
  expect(Number(after.availableQty)).toBe(40);
  expect(after.stockLedger.filter((r) => r.refType === 'CUSTOMER_CONSUMPTION')).toHaveLength(1);
});

test('mixed invoice saved, PDF and XLSX report agree on line amounts and total', async ({ page }) => {
  const token = await login(page);
  const customer = await newParty(page, token, 'CUSTOMER');
  const invoice = await api(page, token, 'POST', '/api/invoices', {
    date: today(), partyId: customer.id, isIntraState: true, lines: [
      { description: 'Per piece machining', qty: 12, rate: 45.5, gstRate: 0 },
      { description: 'Per kg finishing', qty: 0.5, rate: 20.15, gstRate: 0 },
      { description: 'Lot setup charge', qty: 1, rate: 2500, gstRate: 0 },
    ],
  }, 201);
  expect(invoice.lines.map((l) => Number(l.amount))).toEqual([546, 10.08, 2500]);
  expect([Number(invoice.subtotal), Number(invoice.roundOff), Number(invoice.total)]).toEqual([3056.08, -0.08, 3056]);

  const saved = await api(page, token, 'GET', `/api/invoices/${invoice.id}`);
  expect(saved.lines.map((l) => Number(l.amount))).toEqual([546, 10.08, 2500]);
  expect(Number(saved.total)).toBe(3056);
  const pdfResponse = await page.request.get(`/api/invoices/${invoice.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
  expect(pdfResponse.status()).toBe(200);
  const pages = await pdfPages(pdfResponse);
  const text = pages.flat().map((item) => item.str).join(' ');
  for (const value of ['Per piece machining', 'Per kg finishing', 'Lot setup charge', '10.08', '3,056.00']) {
    expect(text).toContain(value);
  }
  const totalPage = pages.find((p) => p.some((item) => item.str.includes('Grand Total')));
  expect(totalPage.map((i) => i.str).join(' ')).toContain('3,056.00');

  const response = await page.request.get('/api/reports/invoices.xlsx', { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status()).toBe(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await response.body());
  const sheet = workbook.getWorksheet('Invoices');
  const headers = sheet.getRow(1).values;
  const row = sheet.getRows(2, sheet.rowCount - 1).find((r) => r.getCell(headers.indexOf('Number')).value === invoice.number);
  expect(row).toBeTruthy();
  expect(row.getCell(headers.indexOf('Subtotal')).value).toBe(3056.08);
  expect(row.getCell(headers.indexOf('Total')).value).toBe(3056);
});

test('simultaneous payments do not overpay the same demo invoice', async ({ page }) => {
  const token = await login(page);
  const customer = await newParty(page, token, 'CUSTOMER');
  const invoice = await api(page, token, 'POST', '/api/invoices', {
    date: today(), partyId: customer.id, lines: [{ description: 'Payment race', qty: 1, rate: 100, gstRate: 0 }],
  }, 201);
  const requests = await Promise.all([1, 2].map(() => page.request.post(`/api/invoices/${invoice.id}/payments`, {
    headers: { Authorization: `Bearer ${token}` }, data: { date: today(), amount: 60, mode: 'CASH' },
  })));
  expect(requests.map((r) => r.status()).sort()).toEqual([200, 400]);
  const saved = await api(page, token, 'GET', `/api/invoices/${invoice.id}`);
  expect(Number(saved.amountPaid)).toBe(60);
  expect(saved.payments.map((p) => Number(p.amount))).toEqual([60]);
});

test('long invoice PDF keeps every line and the total on populated pages', async ({ page }) => {
  const token = await login(page);
  const customer = await newParty(page, token, 'CUSTOMER');
  const lines = Array.from({ length: 36 }, (_, i) => ({ description: `Audit row ${String(i + 1).padStart(2, '0')}`, qty: 1, rate: 1, gstRate: 0 }));
  const invoice = await api(page, token, 'POST', '/api/invoices', { date: today(), partyId: customer.id, lines }, 201);
  const response = await page.request.get(`/api/invoices/${invoice.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status()).toBe(200);
  const pages = await pdfPages(response);
  expect(pages.length).toBeGreaterThan(1);
  for (const pg of pages) expect(pg.some((item) => item.str.trim())).toBe(true);
  const text = pages.flat().map((item) => item.str).join(' ');
  for (const line of lines) expect(text.split(line.description)).toHaveLength(2);
  const totalPage = pages.find((p) => p.some((item) => item.str.includes('Grand Total')));
  expect(totalPage.map((i) => i.str).join(' ')).toContain('36.00');
});

test('quotation form previews and saves half-paisa amounts consistently', async ({ page }) => {
  const token = await login(page);
  const customer = await newParty(page, token, 'CUSTOMER');
  const quote = await api(page, token, 'POST', '/api/quotations', {
    date: today(), partyId: customer.id, lines: [{ description: 'Precision quote', qty: 1, rate: 1 }],
  }, 201);
  await page.goto(`/quotations/${quote.id}/edit`);
  const quantity = page.getByPlaceholder('Qty');
  await expect(quantity).toBeVisible();
  await quantity.fill('0.5');
  await page.getByPlaceholder('Rate').fill('20.15');
  await expect(page.getByPlaceholder('Amount')).toHaveValue('10.08');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL(/\/quotations\?type=CUSTOMER/);
  const saved = await api(page, token, 'GET', `/api/quotations/${quote.id}`);
  expect([Number(saved.lines[0].amount), Number(saved.total)]).toEqual([10.08, 10.08]);
});

test('quotation UI sends, approves and converts only after approval', async ({ page }) => {
  const token = await login(page);
  const customer = await newParty(page, token, 'CUSTOMER');
  const quote = await api(page, token, 'POST', '/api/quotations', {
    date: today(), partyId: customer.id, type: 'CUSTOMER',
    lines: [{ description: 'Audit quotation work', qty: 2, rate: 50 }],
  }, 201);
  await api(page, token, 'POST', `/api/quotations/${quote.id}/convert`, undefined, 400);
  await page.goto(`/quotations/${quote.id}`);
  await page.getByRole('button', { name: 'Mark as Sent' }).click();
  await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible();
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByRole('button', { name: 'Convert to Invoice' })).toBeVisible();
  await page.getByRole('button', { name: 'Convert to Invoice' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Convert', exact: true }).click();
  await page.waitForURL(/\/invoices\/\d+$/);
  const converted = await api(page, token, 'GET', `/api/quotations/${quote.id}`);
  expect(converted.status).toBe('CONVERTED');
  const invoiceId = Number(page.url().split('/').pop());
  const invoice = await api(page, token, 'GET', `/api/invoices/${invoiceId}`);
  expect([invoice.quotationId, Number(invoice.total)]).toEqual([quote.id, 100]);
  await api(page, token, 'POST', `/api/quotations/${quote.id}/convert`, undefined, 400);
});
