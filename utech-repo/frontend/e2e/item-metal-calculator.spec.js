import { test, expect } from '@playwright/test';

test.beforeAll(() => { if (process.env.E2E_USE_DEMO !== '1') throw new Error('Use the disposable demo database.'); });
async function login(page) {
  await page.goto('/login');
  await page.locator('#login-email').fill('admin@utech.local');
  await page.locator('#login-password').fill('Admin@123');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/$/);
  return page.evaluate(() => localStorage.getItem('utech.token'));
}
async function newItem(page, name) {
  await page.goto('/items/new');
  await page.locator('#item-name').fill(name);
  await page.getByRole('button', { name: 'Calculate material size' }).click();
  await expect(page.locator('#mc-shape')).toBeVisible();
}
async function calculate(page) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/metal-calculator/calculate') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Calculate', exact: true }).click(),
  ]);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function saveAndCheck(page, token, expected) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/items') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Save', exact: true }).click(),
  ]);
  expect(response.status(), await response.text()).toBe(201);
  const created = await response.json();
  const read = await page.request.get(`/api/items/${created.id}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(read.status()).toBe(200);
  const saved = await read.json();
  expect(saved.metal).toBe(expected.metal);
  expect(Number(saved.weightKg)).toBeCloseTo(expected.weight, 3);
  expect(Number(saved.ratePerKg)).toBeCloseTo(expected.rate, 2);
  expect(Number(saved.purchaseRate)).toBeCloseTo(expected.price, 2);
  await page.goto(`/items/${created.id}`);
  await expect.poll(async () => Number(await page.locator('#item-rate-per-kg').inputValue())).toBe(expected.rate);
  await expect.poll(async () => Number(await page.locator('#item-purchase-rate').inputValue())).toBe(expected.price);
  await expect(page.getByText(new RegExp(`${expected.weight} kg`)).first()).toBeVisible();
}

test('add steel round bar with calculator weight and ₹100/kg', async ({ page }) => {
  const token = await login(page);
  await newItem(page, 'PW steel round 100x1000');
  await page.locator('#mc-shape').selectOption('roundbar');
  await page.locator('#mc-d').fill('100');
  await page.locator('#mc-L').fill('1000');
  await page.locator('#mc-rate').fill('100');
  const calc = await calculate(page);
  const expectedWeight = Math.round(Math.PI / 4 * 100 ** 2 * 1000 * 7.85e-6 * 1000) / 1000;
  expect(calc.pieceWeightKg).toBe(expectedWeight);
  expect(calc.totalPrice).toBe(6165.38); // calculator prices the unrounded weight
  await expect(page.locator('#mc-shape')).toBeHidden();
  await expect(page.getByText('61.654 kg', { exact: true })).toBeVisible();
  await expect(page.locator('#item-purchase-rate')).toHaveValue('6165.40');
  await saveAndCheck(page, token, { metal: 'Steel', weight: 61.654, rate: 100, price: 6165.40 });
});

test('add steel pipe from OD, wall thickness and ₹75/kg', async ({ page }) => {
  const token = await login(page);
  await newItem(page, 'PW steel pipe 60x5x3000');
  await page.locator('#mc-shape').selectOption('pipe');
  await page.locator('#mc-od').fill('60');
  await page.locator('#mc-t').fill('5');
  await page.locator('#mc-L').fill('3000');
  await page.locator('#mc-rate').fill('75');
  const calc = await calculate(page);
  const expectedWeight = Math.round(Math.PI / 4 * (60 ** 2 - 50 ** 2) * 3000 * 7.85e-6 * 1000) / 1000;
  expect(calc.pieceWeightKg).toBe(expectedWeight);
  await expect(page.locator('#mc-shape')).toBeHidden();
  await expect(page.getByText('20.346 kg', { exact: true })).toBeVisible();
  await expect(page.locator('#item-purchase-rate')).toHaveValue('1525.95');
  await saveAndCheck(page, token, { metal: 'Steel', weight: 20.346, rate: 75, price: 1525.95 });
});

test('add aluminium plate with a different metal and ₹120/kg', async ({ page }) => {
  const token = await login(page);
  await newItem(page, 'PW aluminium plate 500x1000x10');
  await page.locator('#mc-shape').selectOption('sheet');
  await page.locator('#mc-metal').click();
  await page.getByRole('combobox', { name: 'Filter options' }).fill('Aluminum');
  await page.getByRole('option', { name: /Aluminum/ }).first().click();
  await page.locator('#mc-w').fill('500');
  await page.locator('#mc-b').fill('1000');
  await page.locator('#mc-t').fill('10');
  await page.locator('#mc-rate').fill('120');
  const calc = await calculate(page);
  expect(calc.pieceWeightKg).toBeCloseTo(500 * 1000 * 10 * 2.73e-6, 3);
  await expect(page.locator('#mc-shape')).toBeHidden();
  await expect(page.getByText('13.65 kg', { exact: true })).toBeVisible();
  await expect(page.locator('#item-purchase-rate')).toHaveValue('1638.00');
  await saveAndCheck(page, token, { metal: 'Aluminum', weight: 13.65, rate: 120, price: 1638 });
});


test('calculate length from weight, then save a one-piece item', async ({ page }) => {
  const token = await login(page);
  await newItem(page, 'PW length mode steel bar');
  await page.locator('#mc-shape').selectOption('roundbar');
  await page.getByLabel('Calculate', { exact: true }).selectOption('length');
  await page.locator('#mc-d').fill('100');
  await page.locator('#mc-total-weight').fill('61.654');
  await page.locator('#mc-rate').fill('125');
  const calc = await calculate(page);
  const expectedLength = Math.round((61.654 / (Math.PI / 4 * 100 ** 2 * 7.85e-3) * 1000) * 100) / 100;
  expect(calc.lengthMm).toBe(expectedLength);
  await expect(page.locator('#mc-shape')).toBeHidden();
  await expect(page.locator('#item-size')).toHaveValue(`100 mm X ${expectedLength} mm`);
  await expect(page.getByText('61.654 kg', { exact: true })).toBeVisible();
  await expect(page.locator('#item-purchase-rate')).toHaveValue('7706.75');
  await saveAndCheck(page, token, { metal: 'Steel', weight: 61.654, rate: 125, price: 7706.75 });
});

test('invalid pipe wall thickness cannot be calculated or applied', async ({ page }) => {
  await login(page);
  await newItem(page, 'PW invalid pipe');
  await page.locator('#mc-shape').selectOption('pipe');
  await page.locator('#mc-od').fill('60');
  await page.locator('#mc-t').fill('35');
  await page.locator('#mc-L').fill('3000');
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/metal-calculator/calculate') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Calculate', exact: true }).click(),
  ]);
  expect(response.status()).toBe(400);
  expect(await response.text()).toContain('Wall thickness');
  await expect(page.locator('#mc-shape')).toBeVisible();
  await expect(page.locator('#item-size')).toHaveValue('');
});

test('lb-based rate converts to ₹/kg before item pricing', async ({ page }) => {
  const token = await login(page);
  await newItem(page, 'PW bar rate per lb');
  await page.locator('#mc-shape').selectOption('roundbar');
  await page.locator('#mc-d').fill('100');
  await page.locator('#mc-L').fill('1000');
  await page.locator('#mc-weight-unit').selectOption('lb');
  await page.locator('#mc-rate').fill('10');
  const calc = await calculate(page);
  expect(calc.rateUnit).toBe('lb');
  expect(calc.pieceWeightKg).toBe(61.654);
  await expect(page.locator('#mc-shape')).toBeHidden();
  await expect(page.locator('#item-rate-per-kg')).toHaveValue('22.05');
  await expect(page.getByText('61.654 kg', { exact: true })).toBeVisible();
  await expect(page.locator('#item-purchase-rate')).toHaveValue('1359.47');
  await saveAndCheck(page, token, { metal: 'Steel', weight: 61.654, rate: 22.05, price: 1359.47 });
});

test('edit an item without re-entering dimensions, calculate a new price and save', async ({ page }) => {
  const token = await login(page);
  await newItem(page, 'PW edit calculator');
  await page.locator('#mc-d').fill('100');
  await page.locator('#mc-L').fill('1000');
  await page.locator('#mc-rate').fill('100');
  await calculate(page);
  await expect(page.locator('#mc-shape')).toBeHidden();
  await expect(page.locator('#item-purchase-rate')).toHaveValue('6165.40');
  const [createdResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/items') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Save', exact: true }).click(),
  ]);
  expect(createdResponse.status()).toBe(201);
  const { id } = await createdResponse.json();
  await page.goto(`/items/${id}`);
  await expect(page.locator('#item-size')).toHaveValue('100 mm X 1000 mm');
  await page.getByRole('button', { name: 'Calculate material size' }).click();
  await expect(page.locator('#mc-d')).toHaveValue('100');
  await expect(page.locator('#mc-L')).toHaveValue('1000');
  await expect(page.locator('#mc-rate')).toHaveValue('100');
  await expect(page.getByRole('button', { name: 'By weight' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Metric', exact: true })).toHaveCount(0);
  await page.locator('#mc-rate').fill('75');
  await calculate(page);
  await expect(page.locator('#mc-shape')).toBeHidden();
  await expect(page.locator('#item-purchase-rate')).toHaveValue('4624.05');
  await page.locator('#item-rate-per-kg').fill('80');
  await expect(page.locator('#item-purchase-rate')).toHaveValue('4932.32');
  const [updated] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith(`/api/items/${id}`) && r.request().method() === 'PUT'),
    page.getByRole('button', { name: 'Save', exact: true }).click(),
  ]);
  expect(updated.ok(), await updated.text()).toBeTruthy();
  const read = await page.request.get(`/api/items/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  const item = await read.json();
  expect(Number(item.ratePerKg)).toBe(80);
  expect(Number(item.purchaseRate)).toBe(4932.32);
  expect(Number(item.weightKg)).toBe(61.654);
});

test('edit a legacy stock-sheet size and reuse parsed dimensions', async ({ page }) => {
  const token = await login(page);
  const response = await page.request.post('/api/items', {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'PW legacy round bar', type: 'RAW_MATERIAL', size: 'OD 60 X 5 mtr.', metal: 'Steel', ratePerKg: 100, purchaseRate: 500, gstRate: 18 },
  });
  expect(response.status()).toBe(201);
  const { id } = await response.json();
  await page.goto(`/items/${id}`);
  await expect(page.getByText('110.977 kg', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Calculate material size' }).click();
  await expect(page.locator('#mc-d')).toHaveValue('60');
  await expect(page.locator('#mc-L')).toHaveValue('5000');
  await expect(page.locator('#mc-rate')).toHaveValue('100');
  await calculate(page);
  await expect(page.locator('#item-purchase-rate')).toHaveValue('11097.70');
});
