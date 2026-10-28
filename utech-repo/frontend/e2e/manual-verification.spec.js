import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
const ExcelJS = backendRequire('exceljs');
const today = () => new Date().toISOString().slice(0, 10);
const stamp = Date.now();

test.beforeAll(() => {
  if (process.env.E2E_USE_DEMO !== '1' && process.env.E2E_CONFIRM_DISPOSABLE !== '1') {
    throw new Error('These write tests require a disposable environment.');
  }
});
test.setTimeout(120_000);

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

async function pdfText(bytes) {
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => it.str).join(' '));
  }
  const size = (await doc.getPage(1)).getViewport({ scale: 1 });
  await doc.destroy();
  return { pages, width: size.width, height: size.height };
}

// ---------------------------------------------------------------------------
test('sidebar collapse resizes content, persists, and leaves no phantom blank scroll area', async ({ page }) => {
  await login(page);
  const aside = page.locator('aside');
  const main = page.locator('main');

  const expanded = { aside: (await aside.boundingBox()).width, main: (await main.boundingBox()).width };
  expect(expanded.aside).toBeGreaterThan(200);

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect.poll(async () => (await aside.boundingBox()).width).toBeLessThan(80);
  const collapsed = { aside: (await aside.boundingBox()).width, main: (await main.boundingBox()).width };
  // content actually reclaims the freed width (not just a narrower sidebar)
  expect(collapsed.main - expanded.main).toBeGreaterThan(150);
  // every destination stays reachable from the rail, labelled for AT + tooltip
  await expect(page.getByRole('link', { name: 'Items' })).toHaveAttribute('title', 'Items');

  // collapsed state survives navigation AND a full reload
  await page.getByRole('link', { name: 'Items' }).click();
  await page.waitForURL('**/items');
  expect((await aside.boundingBox()).width).toBeLessThan(80);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  expect((await aside.boundingBox()).width).toBeLessThan(80);
  expect(await page.evaluate(() => localStorage.getItem('utech.sidebar.collapsed'))).toBe('true');

  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect.poll(async () => (await aside.boundingBox()).width).toBeGreaterThan(200);

  // No phantom blank scroll: on every page, the scrollable height must be
  // explained by the actual content bottom (within shell padding), never by
  // an empty reserved area below the content.
  for (const path of ['/', '/items', '/invoices', '/reports', '/quality', '/stock']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const m = await page.evaluate(() => {
      const mainEl = document.querySelector('main');
      const content = mainEl.firstElementChild;
      const rect = content.getBoundingClientRect();
      return {
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
        contentBottom: rect.bottom + window.scrollY,
      };
    });
    expect(
      m.scrollHeight - Math.max(m.innerHeight, m.contentBottom),
      `${path}: scroll area extends ${m.scrollHeight - m.contentBottom}px past the content`,
    ).toBeLessThanOrEqual(48);
  }

  // Mobile: drawer opens/closes, page never scrolls sideways
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/items');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('button', { name: 'Close navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Close navigation' }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// Hand calculation this test cross-checks (worked out on paper first):
//   GRN: received 100, rejected 5            -> stock 95
//   Customer lot: 100 pcs / 50 kg inward
//     reserve card A 40 pcs / 20 kg, card B 30 pcs / 15 kg
//     -> unallocated 100-40-30 = 30 pcs, 50-20-15 = 15 kg
//     consume 25 pcs / 10 kg -> on-hand 75 pcs / 40 kg, still reserved 30/15
//   Invoice: 40 x 250 = 10,000 ; 10 x 100 = 1,000 ; subtotal 11,000
//     discount 500 -> taxable 10,500 ; GST 18% = 1,890 (CGST 945 + SGST 945)
//     total = 12,390 ; invoice alone must NOT move stock (still 95)
//   Dispatch 40 -> stock 95-40 = 55 ; ledger balances [95, 55]
//   Pay 12,390 -> PAID, party ledger debit 12,390 / credit 12,390
test('inward -> job cards (remaining qty/weight) -> certificate -> invoice, hand-checked', async ({ page }) => {
  const token = await login(page);
  const vendor = await api(page, token, 'POST', '/api/parties', { name: `Verify Vendor ${stamp}`, type: 'VENDOR', stateCode: '27' }, 201);
  const customer = await api(page, token, 'POST', '/api/parties', { name: `Verify Customer ${stamp}`, type: 'CUSTOMER', stateCode: '27' }, 201);
  const item = await api(page, token, 'POST', '/api/items', {
    name: `Verify Shaft ${stamp}`, type: 'RAW_MATERIAL', openingStock: 0, purchaseRate: 200, saleRate: 250, gstRate: 18,
  }, 201);

  // --- inward (GRN) ---------------------------------------------------------
  const grn = await api(page, token, 'POST', '/api/grns', {
    date: today(), partyId: vendor.id,
    lines: [{ itemId: item.id, qty: 100, qtyAccepted: 95, qtyRejected: 5, rate: 200 }],
  }, 201);
  expect(Number(grn.lines[0].qtyAccepted)).toBe(95);
  let stock = await api(page, token, 'GET', `/api/items/${item.id}`);
  expect(Number(stock.currentStock)).toBe(95);

  // --- job cards -------------------------------------------------------------
  const cardA = await api(page, token, 'POST', '/api/jobcards', {
    date: today(), partyId: customer.id, itemId: item.id, itemDescription: 'Verify shaft job', qtyOrdered: 40,
    lines: [{ itemId: item.id, qty: 40 }],
  }, 201);
  const cardB = await api(page, token, 'POST', '/api/jobcards', {
    date: today(), partyId: customer.id, itemId: item.id, itemDescription: 'Verify shaft job B', qtyOrdered: 30,
    lines: [{ itemId: item.id, qty: 30 }],
  }, 201);

  // --- customer inward -> reservations -> remaining --------------------------
  const lot = await api(page, token, 'POST', '/api/customer-material', {
    customerId: customer.id, materialDescription: 'Customer shaft blanks', qty: 100, weight: 50,
    receivedDate: today(), uomCode: 'PCS',
  }, 201);
  await api(page, token, 'POST', `/api/customer-material/${lot.id}/allocations`, { jobcardId: cardA.id, qty: 40, weight: 20 }, 201);
  await api(page, token, 'POST', `/api/customer-material/${lot.id}/allocations`, { jobcardId: cardB.id, qty: 30, weight: 15 }, 201);
  let saved = await api(page, token, 'GET', `/api/customer-material/${lot.id}`);
  expect([Number(saved.unallocatedQty), Number(saved.unallocatedWeight)]).toEqual([30, 15]);
  // over-reserving the remaining 30 must be refused
  await api(page, token, 'POST', `/api/customer-material/${lot.id}/allocations`, { jobcardId: cardA.id, qty: 31, weight: 1 }, 400);

  // Intended workflow (CustomerMaterialAllocations.jsx): a reservation is
  // released before the physical movement. Release card A's 40/20, then
  // consume 25/10 -> on-hand 75/40, only card B's 30/15 still reserved,
  // unallocated = (75-30) pcs / (40-15) kg = 45 / 25.
  const allocA = saved.allocations.find((a) => a.jobcardId === cardA.id);
  await api(page, token, 'POST', `/api/customer-material/${lot.id}/allocations/${allocA.id}/release`, { reason: 'Issuing to production' });
  await api(page, token, 'POST', `/api/customer-material/${lot.id}/consume`, { qty: 25, weight: 10 });
  saved = await api(page, token, 'GET', `/api/customer-material/${lot.id}`);
  expect([Number(saved.availableQty), Number(saved.currentWeight), Number(saved.reservedQty), Number(saved.reservedWeight)])
    .toEqual([75, 40, 30, 15]);
  expect([Number(saved.unallocatedQty), Number(saved.unallocatedWeight)]).toEqual([45, 25]);

  // --- quality certificate against job card A --------------------------------
  const certNo = `CERT-VERIFY-${stamp}`;
  const qc = await api(page, token, 'POST', '/api/quality', {
    date: today(), refType: 'JOBCARD', refId: cardA.id, result: 'PASS',
    inspectorName: 'Verify Inspector', certificateNo: certNo,
    lines: [{ parameter: 'Outer diameter', expected: '25.00 mm', actual: '25.01 mm', result: 'PASS' }],
  }, 201);

  // --- invoice (hand-calculated above) ---------------------------------------
  const invoice = await api(page, token, 'POST', '/api/invoices', {
    date: today(), partyId: customer.id, isIntraState: true, discount: 500,
    lines: [
      { itemId: item.id, description: 'Verify shaft machining', qty: 40, rate: 250, gstRate: 18 },
      { description: 'Inspection & packing', qty: 10, rate: 100, gstRate: 18 },
    ],
  }, 201);
  expect([Number(invoice.subtotal), Number(invoice.discount), Number(invoice.cgst), Number(invoice.sgst), Number(invoice.igst), Number(invoice.total)])
    .toEqual([11000, 500, 945, 945, 0, 12390]);
  stock = await api(page, token, 'GET', `/api/items/${item.id}`);
  expect(Number(stock.currentStock)).toBe(95); // billing does not move stock

  // --- dispatch moves stock; ledger invariant --------------------------------
  await api(page, token, 'POST', '/api/dispatch', {
    date: today(), partyId: customer.id, lines: [{ itemId: item.id, qty: 40 }],
  }, 201);
  stock = await api(page, token, 'GET', `/api/items/${item.id}`);
  expect(Number(stock.currentStock)).toBe(55);
  const ledger = await api(page, token, 'GET', `/api/items/${item.id}/stock`);
  const walked = ledger.reduce((bal, r) => bal + Number(r.qtyIn) - Number(r.qtyOut), 0);
  expect(walked).toBe(55); // opening + in - out = closing, recomputed independently
  expect(ledger.map((r) => Number(r.balance))).toEqual([95, 55]);

  const paid = await api(page, token, 'POST', `/api/invoices/${invoice.id}/payments`, { date: today(), amount: 12390, mode: 'BANK' });
  expect([paid.status, Number(paid.amountPaid)]).toEqual(['PAID', 12390]);

  // --- certificate print sheet (real print-to-PDF via Chromium) --------------
  await page.goto(`/quality/${qc.id}/certificate`);
  await expect(page.getByText(certNo)).toBeVisible();
  await expect(page.getByText(cardA.number)).toBeVisible();
  const certPdf = await page.pdf({ format: 'A4', printBackground: true });
  const cert = await pdfText(certPdf);
  // pdf text extraction can split long identifiers at a line wrap
  // ("CERT-VERIFY- 1793..."), so compare with wraps removed
  const certText = cert.pages.join(' ').replace(/-\s+/g, '-').replace(/\s+/g, ' ');
  expect(certText).toContain(certNo);
  expect(certText).toContain('PASS');
  expect(certText).not.toContain('Main navigation'); // no sidebar/UI chrome on paper
  expect(Math.abs(cert.width - 595)).toBeLessThan(2); // A4 portrait
  expect(Math.abs(cert.height - 842)).toBeLessThan(2);

  // --- invoice PDF (server-generated) ----------------------------------------
  const pdfRes = await page.request.get(`/api/invoices/${invoice.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
  expect(pdfRes.status()).toBe(200);
  const inv = await pdfText(await pdfRes.body());
  const invText = inv.pages.join(' ').replace(/\s+/g, ' ');
  expect(invText).toContain(invoice.number);
  expect(invText).toContain(`Verify Customer ${stamp}`);
  expect(invText).toMatch(/12,?390/);

  // --- Excel: UI-downloaded invoices workbook, inspected cell-by-cell --------
  await page.goto('/reports');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Download Invoices report/i }).click(),
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await download.path());
  const sheet = workbook.getWorksheet('Invoices');
  const header = sheet.getRow(1).values.slice(1);
  const numCol = header.indexOf('Number') + 1;
  const totalCol = header.indexOf('Total') + 1;
  const paidCol = header.indexOf('Paid') + 1;
  let found = null;
  sheet.eachRow((row, n) => { if (n > 1 && row.getCell(numCol).value === invoice.number) found = row; });
  expect(found, 'invoice row present in downloaded workbook').not.toBeNull();
  expect(Number(found.getCell(totalCol).value)).toBe(12390);
  expect(Number(found.getCell(paidCol).value)).toBe(12390);

  // --- Excel: stock ledger workbook agrees with the API ledger ----------------
  const ledRes = await page.request.get('/api/reports/stock-ledger.xlsx', { headers: { Authorization: `Bearer ${token}` } });
  expect(ledRes.status()).toBe(200);
  const ledWb = new ExcelJS.Workbook();
  await ledWb.xlsx.load(await ledRes.body());
  const ledSheet = ledWb.getWorksheet('Stock Ledger');
  const rows = [];
  ledSheet.eachRow((row, n) => { if (n > 1) rows.push(row.values.slice(1)); });
  const mine = rows.filter((r) => String(r[2] || '').includes(`Verify Shaft ${stamp}`));
  expect(mine.map((r) => [r[4], Number(r[6]), Number(r[7]), Number(r[8])]))
    .toEqual(expect.arrayContaining([['GRN', 95, 0, 95], ['DISPATCH', 0, 40, 55]]));
});
