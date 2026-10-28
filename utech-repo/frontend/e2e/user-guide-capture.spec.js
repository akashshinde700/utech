import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Screenshot capture for the Hinglish user manual
// (docs/user-guide/Utech-ERP-User-Guide-Hinglish.docx).
//
// This spec is documentation tooling, not a regression check: it walks the real
// UI in the order the manual explains it, saves a PNG per step and writes a
// manifest (step number, file, Hinglish heading + caption) that the docx builder
// reads from ../scripts/build-user-guide-docx.js.
//
// Run it only against a disposable demo database:
//   SHOTS_DIR=../docs/user-guide/screenshots npx playwright test user-guide-capture.spec.js
// It creates customers, items, a PO, a GRN, a dispatch, an invoice with a
// payment, a BOM, a production batch and a customer-material lot in that demo DB.

const SHOTS_DIR = path.resolve(process.env.SHOTS_DIR || path.join(process.cwd(), 'docs/user-guide/screenshots'));
const manifest = [];
let step = 0;

const pad = (n) => String(n).padStart(2, '0');

// Retina-quality captures: 1440 logical px wide at 2x, so the docx pictures stay
// readable when the reader zooms in.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

async function shot(page, slug, title, caption, opts = {}) {
  step += 1;
  const file = `${pad(step)}-${slug}.png`;
  await page.waitForTimeout(opts.settle ?? 500);
  // filling a long form leaves the page scrolled halfway down — start every
  // capture at the top so the page heading is part of the picture
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll('main, [class*="overflow-y-auto"]').forEach((el) => { el.scrollTop = 0; });
  });
  await page.waitForTimeout(150);
  if (opts.annotate) await annotate(page, opts.annotate);
  await page.screenshot({ path: path.join(SHOTS_DIR, file), fullPage: opts.fullPage ?? true });
  if (opts.annotate) await clearAnnotations(page);
  manifest.push({ step, file, title, caption });
  return file;
}

// Draw numbered markers on top of the live page. The highlight divs are removed
// right after the screenshot — nothing is baked into the application markup.
// `focus: true` dims the rest of the screen so the eye lands on the field being
// explained in the caption.
async function annotate(page, marks) {
  // resolve every selector through Playwright (so text= and CSS both work) and
  // draw the badges on an overlay instead of touching the app's own markup
  const rects = [];
  for (const m of marks) {
    try {
      const loc = page.locator(m.selector).first();
      if ((await loc.count()) === 0) continue;
      const box = await loc.boundingBox();
      if (!box || (!box.width && !box.height)) continue;
      rects.push({ ...box, label: m.label || '', focus: !!m.focus });
    } catch {
      // selector that even Playwright cannot parse — skip the marker
    }
  }
  await page.evaluate((items) => {
    const layer = document.createElement('div');
    layer.id = '__guide_overlay';
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000';
    for (const r of items) {
      // a huge spread shadow dims everything except the highlighted box
      const box = document.createElement('div');
      box.style.cssText = `position:absolute;left:${r.x - 4}px;top:${r.y - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;border:3px solid #f59e0b;border-radius:8px;box-shadow:0 0 0 1px rgba(245,158,11,.5)`;
      if (r.focus) box.style.boxShadow = '0 0 0 4000px rgba(15,23,42,0.45), 0 0 14px 2px rgba(245,158,11,.5)';
      layer.appendChild(box);
      if (r.label) {
        const badge = document.createElement('div');
        badge.textContent = r.label;
        badge.style.cssText = `position:absolute;left:${r.x - 13}px;top:${r.y - 15}px;min-width:26px;height:26px;border-radius:9999px;background:#f59e0b;color:#1e293b;font:700 14px/26px system-ui;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.35)`;
        layer.appendChild(badge);
      }
    }
    document.body.appendChild(layer);
  }, rects);
  await page.waitForTimeout(250);
}

async function clearAnnotations(page) {
  await page.evaluate(() => document.getElementById('__guide_overlay')?.remove());
}

// Sidebar navigation exactly like a user does it: open the section, click the link.
async function nav(page, section, link) {
  if (await page.getByRole('dialog').count()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  const sectionBtn = page.getByRole('button', { name: section, exact: true });
  if (await sectionBtn.count()) {
    const expanded = await sectionBtn.getAttribute('aria-expanded');
    if (expanded !== 'true') await sectionBtn.click();
  }
  await page.getByRole('link', { name: link, exact: true }).first().click();
  await page.waitForLoadState('networkidle');
}

async function choose(page, trigger, text) {
  await trigger.click({ noWaitAfter: true });
  const filter = page.getByRole('combobox', { name: 'Filter options' });
  if (await filter.count()) await filter.fill(text);
  await page.getByRole('option').filter({ hasText: text }).first().click();
}

// opens the row that contains `text` and waits for the detail page
async function openRow(page, text, urlPattern) {
  await page.getByRole('row').filter({ hasText: text }).first().click();
  if (urlPattern) {
    try {
      await page.waitForURL(urlPattern, { timeout: 30000 });
    } catch (err) {
      console.log(`openRow("${text}") stayed on ${page.url()} — ${err.message.split('\n')[0]}`);
      throw err;
    }
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);
}

test('capture the Hinglish user-guide screenshots', async ({ page }) => {
  test.setTimeout(600_000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const stamp = String(Date.now()).slice(-4);
  const customerName = `Shree Ganesh Engineering ${stamp}`;
  const vendorName = `Bharat Steel Traders ${stamp}`;
  const itemName = `MS Round Bar 25mm ${stamp}`;
  const finishedName = `Bracket Assembly ${stamp}`;
  const bomName = `Bracket Assembly BOM ${stamp}`;

  // ---------------------------------------------------------------- 1. login
  await page.goto('/login', { waitUntil: 'networkidle' });
  await shot(page, 'login-screen', 'Login screen', 'App kholein — sabse pehle yeh login screen aayegi. Admin se mila hua email aur password daalein, phir "Sign in" dabayein.', {
    annotate: [
      { selector: 'input#login-email', label: '1' },
      { selector: 'input#login-password', label: '2' },
      { selector: 'button[type="submit"]', label: '3' },
    ],
  });
  await page.locator('#login-email').fill('admin@utech.local');
  await page.locator('#login-password').fill('Admin@123');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/$/, { timeout: 30000 });
  await page.waitForLoadState('networkidle');

  // ------------------------------------------------------------ 2. dashboard
  await shot(page, 'dashboard', 'Dashboard (ghar ka panna)', 'Login karne ke baad yahi Dashboard khulta hai: sales, active jobcard, pending jobwork, total parties aur total items ek nazar me. Left ka dark menu poore software ka rasta hai. Upar search box se kisi bhi page par seedha ja sakte hain.', {
    annotate: [{ selector: 'aside', label: '1' }, { selector: 'main', label: '2' }],
  });

  // -------------------------------------------------------- 3. sidebar tour
  await page.getByRole('button', { name: 'Company Inventory', exact: true }).click();
  await page.waitForTimeout(400);
  await shot(page, 'sidebar-sections', 'Left menu ke 8 section', 'Menu 8 hisson me bata hua hai: Masters, Task Management, Sales, Company Inventory, Customer Inventory, Stock Management, Analytics aur Admin. Section par click karne se uske pages khulte hain — jaise Company Inventory me Items, BOMs, Production Batches, Purchase Orders aur GRN.', {
    annotate: [{ selector: 'aside nav', label: '1' }],
  });
  await page.getByRole('button', { name: 'Company Inventory', exact: true }).click();

  // ------------------------------------------------------- 4. masters: party
  await nav(page, 'Masters', 'Customers');
  await shot(page, 'customers-list', 'Masters → Customers (customer list)', 'Customer yani jise maal bechte hain. List me naam, phone aur GST detail dikhti hai. Naya customer banane ke liye upar right ka "New customer" button dabayein.', {
    annotate: [{ selector: 'a[href="/parties/new"]', label: '1' }],
  });

  await page.goto('/parties/new?type=CUSTOMER', { waitUntil: 'networkidle' });
  await page.locator('#party-name').fill(customerName);
  await page.locator('#party-phone').fill('9876500011');
  await page.locator('#party-addr1').fill('Plot 12, Chikhali MIDC');
  await page.locator('#party-city').fill('Pune');
  await page.locator('#party-state').fill('Maharashtra');
  await page.locator('#party-pincode').fill('411062');
  await page.waitForTimeout(300);
  await shot(page, 'customer-form', 'Naya customer banana', 'Sirf naam aur type zaroori hai, baaki detail baad me bhi bhar sakte hain. GST wala customer ho to GSTIN daalein — state code aur PAN apne aap bhar jaate hain. Save dabane par customer list me chala jayega.', {
    annotate: [
      { selector: '#party-name', label: '1', focus: true },
      { selector: '#party-type', label: '2' },
      { selector: '#party-gstin', label: '3' },
      { selector: '#party-city', label: '4' },
    ],
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL('**/parties', { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await shot(page, 'customer-saved', 'Customer list me naya customer', 'Save karne ke baad customer list me sabse upar naya customer dikhta hai. Row par click karne se uski detail aur ledger khulti hai.', {
    annotate: [{ selector: 'table tbody tr', label: '1' }],
  });

  await nav(page, 'Masters', 'Vendors');
  await page.goto('/parties/new?type=VENDOR', { waitUntil: 'networkidle' });
  await page.locator('#party-name').fill(vendorName);
  await page.locator('#party-phone').fill('9876500022');
  await page.locator('#party-city').fill('Pune');
  await page.locator('#party-state').fill('Maharashtra');
  await page.waitForTimeout(300);
  await shot(page, 'vendor-form', 'Naya vendor banana', 'Vendor yani jisse maal kharidte hain ya jobwork karwate hain. Type me "Vendor" chuna hua hona chahiye, naam aur phone bharein, phir Save.', {
    annotate: [{ selector: '#party-type', label: '1' }, { selector: '#party-name', label: '2', focus: true }, { selector: '#party-phone', label: '3' }],
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL('**/parties', { timeout: 30000 });
  await page.waitForLoadState('networkidle');

  // -------------------------------------------------------- 5. masters: item
  await nav(page, 'Company Inventory', 'Items');
  await shot(page, 'items-list', 'Company Inventory → Items', 'Company ke apne saare items — 73 raw-material items pehle se bhare hue hain (RB, PP, PL, FL codes). Har row me current stock aur min stock dikhta hai. Naya item "New item" se banta hai.', {
    annotate: [{ selector: 'a[href="/items/new"]', label: '1' }, { selector: 'table', label: '2' }],
  });

  await page.goto('/items/new', { waitUntil: 'networkidle' });
  await page.locator('#item-name').fill(itemName);
  await page.locator('#item-description').fill('25 mm MS round bar, 6 meter length');
  await page.locator('#item-purchase-rate').fill('72');
  await page.locator('#item-sale-rate').fill('95');
  await page.locator('#item-gst-rate').fill('18');
  await page.locator('#item-opening-stock').fill('50');
  await page.locator('#item-min-stock').fill('10');
  await page.waitForTimeout(300);
  await shot(page, 'item-form', 'Naya item banana', 'Item ka naam, UoM, rate aur GST % bharein. "Opening Stock" me aaj physically jitna maal hai woh daalein — item save hone ke baad opening stock lock ho jata hai, isliye ek baar dhyan se bharein. "Min Stock" low-stock alert ka level hai.', {
    annotate: [
      { selector: '#item-name', label: '1' },
      { selector: '#item-uom', label: '2' },
      { selector: '#item-gst-rate', label: '3', focus: true },
      { selector: '#item-opening-stock', label: '4', focus: true },
      { selector: '#item-min-stock', label: '5' },
    ],
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL('**/items', { timeout: 30000 });
  await page.waitForLoadState('networkidle');

  await page.goto('/items/new', { waitUntil: 'networkidle' });
  await page.locator('#item-name').fill(finishedName);
  await page.locator('#item-type').selectOption('FINISHED');
  await page.locator('#item-purchase-rate').fill('180');
  await page.locator('#item-sale-rate').fill('260');
  await page.locator('#item-gst-rate').fill('18');
  await page.locator('#item-opening-stock').fill('5');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL('**/items', { timeout: 30000 });
  await page.waitForLoadState('networkidle');

  // item detail — proves the opening-stock ledger entry exists
  await page.getByPlaceholder(/Search name, code, HSN/i).fill(itemName);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  await openRow(page, itemName, /\/items\/[^/]+$/);
  await shot(page, 'item-detail', 'Item ki detail — stock kitna hai', 'Row par click karne se item ki detail khulti hai. Yahan Current Stock 50 hai — yahi opening stock tha. Neeche ledger me OPENING ki entry dikhti hai. Item rate/GST yahin se badle ja sakte hain (stock opening nahi).', {
    annotate: [{ selector: 'main', label: '1' }],
  });

  // ------------------------------------------------- 6. stock overview/ledger
  await nav(page, 'Stock Management', 'Stock Overview & Ledger');
  await page.waitForLoadState('networkidle');
  await shot(page, 'stock-overview', 'Stock Management → Stock Overview & Ledger', 'Upar company stock ka summary (kitne item, kitne low stock, kitna maal kitne rupaye ka). Neeche "Stock Ledger" me har movement ki history hai: kitna andar aaya (In), kitna bahar gaya (Out) aur uske baad Balance kitna raha.', {
    annotate: [{ selector: 'main', label: '1' }],
  });

  await choose(page, page.locator('#adj-item'), itemName);
  await page.locator('#adj-qty').fill('5');
  await page.locator('#adj-notes').fill('Physical count me 5 zyada mile');
  await page.waitForTimeout(300);
  await shot(page, 'stock-adjustment-form', 'Stock adjustment (correction) bharna', 'Physical ginti me farak mile to right side ke "Manual Adjustment" form me item choose karein. Quantity me +5 likhne par stock 5 badhega, −3 likhne par 3 ghat jayega. Reason likhna zaroori hai — woh audit log me jata hai.', {
    annotate: [
      { selector: '#adj-item', label: '1', focus: true },
      { selector: '#adj-qty', label: '2', focus: true },
      { selector: '#adj-notes', label: '3' },
    ],
  });
  await page.getByRole('button', { name: 'Apply Adjustment' }).click();
  await page.waitForTimeout(700);
  await shot(page, 'stock-adjustment-confirm', 'Confirm dialog', 'System ek baar poochhta hai — kis item par kitna adjustment lagega. Sahi lage to "Apply adjustment" dabayein, warna Cancel.', {
    annotate: [{ selector: '[role="dialog"]', label: '1' }],
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Apply adjustment' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
  await shot(page, 'stock-ledger-after-adjustment', 'Ledger me entry aa gayi', 'Ab ledger me sabse upar ADJUSTMENT ki row hai: In = 5 aur Balance = 55 (50 + 5). Har row ke baad ka balance yahin dikhta hai, isliye galti pakadna aasan hai.', {
    annotate: [{ selector: 'table', label: '1' }],
  });

  // ------------------------------------------------------------- 7. purchase
  await nav(page, 'Company Inventory', 'Purchase Orders');
  await shot(page, 'po-list', 'Company Inventory → Purchase Orders', 'Vendor ko maal mangwane ka order (PO). Naya PO "New PO" se banega. Dhyan rakhein: PO banane se stock nahi badhta — stock GRN se badhta hai.', {
    annotate: [{ selector: 'a[href="/purchase-orders/new"]', label: '1' }],
  });

  await page.goto('/purchase-orders/new', { waitUntil: 'networkidle' });
  await choose(page, page.locator('#partyId'), vendorName);
  await choose(page, page.locator('#line-0-item'), itemName);
  await page.locator('#line-0-qty').fill('20');
  await page.waitForTimeout(400);
  await shot(page, 'po-form', 'Naya Purchase Order bharna', 'Date, vendor aur item bharein. Item choose karte hi uska rate aur GST apne aap aa jaata hai (yahan 72 aur 18%). Quantity badalne par neeche subtotal/GST/amount apne aap calculate hota hai.', {
    annotate: [
      { selector: '#partyId', label: '1' },
      { selector: '#line-0-item', label: '2' },
      { selector: '#line-0-qty', label: '3', focus: true },
      { selector: 'text=Subtotal', label: '4' },
    ],
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL(/\/purchase-orders(\/|$)/, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(900);
  await openRow(page, 'PENDING_APPROVAL', /\/purchase-orders\/[^/]+$/);
  await shot(page, 'po-detail-pending', 'PO detail — approve karna baaki hai', 'PO save hone par "PENDING_APPROVAL" me jati hai. Upar right me Approve aur Reject button hain. Jis user ke paas approve permission hai wahi approve karega (maker-checker).', {
    annotate: [{ selector: 'text=PENDING_APPROVAL', label: '1' }, { selector: 'button:has-text("Approve")', label: '2', focus: true }],
  });
  const approveBtn = page.getByRole('button', { name: 'Approve', exact: true });
  if (await approveBtn.count()) {
    await approveBtn.first().click();
    await page.waitForTimeout(700);
    await shot(page, 'po-approve-dialog', 'PO approve karne ki confirmation', 'Confirm dialog me "Approve" dabane par PO approved ho jati hai. Ab vendor ko PO bhej sakte hain aur maal aane par isi PO se GRN banega.', {
      annotate: [{ selector: '[role="dialog"]', label: '1' }],
    });
    await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await shot(page, 'po-approved', 'PO approved ho gayi', 'Status badal kar APPROVED ho gaya. Ab "Create GRN" se seedha receipt bana sakte hain, ya GRN page se yeh PO choose kar sakte hain.', {
      annotate: [{ selector: 'text=APPROVED', label: '1' }],
    });
  }

  // ------------------------------------------------------------------ 8. GRN
  await page.goto('/grns/new', { waitUntil: 'networkidle' });
  await choose(page, page.locator('#partyId'), vendorName);
  await choose(page, page.locator('#line-0-item'), itemName);
  await page.locator('#line-0-qty').fill('10');
  await page.waitForTimeout(300);
  const rejected = page.getByLabel('Line 1 rejected quantity');
  if (await rejected.count()) await rejected.fill('2');
  await page.waitForTimeout(400);
  await shot(page, 'grn-form', 'GRN — maal aaya (Stock In)', 'Vendor se maal aane par GRN banayein. Qty 10 me se 2 reject hue, to Accepted apne aap 8 ho gaya — sirf yehi 8 stock me judega, reject ki hui 2 nahi. PO se aaye maal ke liye upar Purchase Order choose karein, lines apne aap bhar jaati hain.', {
    annotate: [
      { selector: '#partyId', label: '1' },
      { selector: '#line-0-item', label: '2' },
      { selector: '#line-0-qty', label: '3' },
      { selector: '[aria-label="Line 1 accepted quantity"]', label: '4', focus: true },
      { selector: '[aria-label="Line 1 rejected quantity"]', label: '5' },
    ],
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL('**/grns', { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  await shot(page, 'grn-saved', 'GRN save — list me dikh raha hai', 'GRN list me naya GRN "ACCEPTED" status ke saath aata hai. Row par click karke detail, PDF aur "Cancel GRN" milta hai.', {
    annotate: [{ selector: 'table tbody tr', label: '1' }],
  });
  await openRow(page, 'GRN-', /\/grns\/[^/]+$/);
  await shot(page, 'grn-detail', 'GRN detail — accepted quantity', 'Detail me accepted quantity (8) aur status dikhta hai. Galti ho to yahin se "Cancel GRN" + reason de sakte hain — cancel karne par woh 8 stock wapas kam ho jayega.', {
    annotate: [{ selector: 'main', label: '1' }],
  });

  // ------------------------------------------------------------- 9. dispatch
  await nav(page, 'Sales', 'Dispatch');
  await shot(page, 'dispatch-list', 'Sales → Dispatch', 'Customer ko physical maal bhejne ka record (Delivery Challan). Naya challan "New dispatch" se banta hai. Row me status aur "Delivered"/cancel ka option hota hai.', {
    annotate: [{ selector: 'a[href="/dispatch/new"]', label: '1' }],
  });
  await page.goto('/dispatch/new', { waitUntil: 'networkidle' });
  await choose(page, page.locator('#partyId'), customerName);
  await choose(page, page.locator('#line-0-item'), itemName);
  await page.locator('#line-0-qty').fill('4');
  await page.locator('#vehicleNo').fill('MH 14 AB 1234');
  await page.waitForTimeout(400);
  await shot(page, 'dispatch-form', 'Naya Delivery Challan (dispatch)', 'Customer, item aur quantity bharein — vehicle, driver aur e-way bill optional hain. Dhyan rakhein: Save karte hi 4 quantity stock se kam ho jayegi. Available stock se zyada quantity save nahi hogi.', {
    annotate: [
      { selector: '#partyId', label: '1' },
      { selector: '#line-0-item', label: '2' },
      { selector: '#line-0-qty', label: '3', focus: true },
      { selector: '#vehicleNo', label: '4' },
    ],
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL('**/dispatch', { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await shot(page, 'dispatch-saved', 'Challan ban gaya — stock kam ho gaya', 'Naya challan list me aa gaya. Galti ho to row ke "Cancel dispatch" se cancel karein — stock wapas jud jayega. Delivered challan yahan se cancel nahi hota.', {
    annotate: [{ selector: 'table tbody tr', label: '1' }],
  });

  // -------------------------------------------------------------- 10. invoice
  await nav(page, 'Sales', 'Invoices');
  await shot(page, 'invoices-list', 'Sales → Invoices', 'Saare bills ki list — number, party, total, balance aur status (ISSUED / PAID). Naya bill "New Invoice" se banta hai.', {
    annotate: [{ selector: 'a[href="/invoices/new"]', label: '1' }],
  });
  await page.goto('/invoices/new', { waitUntil: 'networkidle' });
  await choose(page, page.locator('#invoice-party'), customerName);
  await choose(page, page.getByRole('button', { name: '— manual —' }).first(), itemName);
  const line = page.locator('table tbody tr').first();
  await line.locator('input').nth(2).fill('4');
  await page.waitForTimeout(700);
  await shot(page, 'invoice-form', 'Naya Invoice (bill) banana', 'Party, item, qty aur rate bharein — GST % item se aa jata hai. "GST Type" same state (CGST+SGST) ya doosre state (IGST) ka hota hai. Neeche total apne aap calculate hota hai. Invoice banane se stock nahi ghatta — uske liye dispatch hota hai.', {
    annotate: [
      { selector: '#invoice-party', label: '1' },
      { selector: 'table tbody tr', label: '2', focus: true },
      { selector: '#invoice-gst-type', label: '3' },
    ],
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL('**/invoices', { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  await openRow(page, customerName, /\/invoices\/[^/]+$/);
  await shot(page, 'invoice-view', 'Banaya hua Invoice', 'Invoice detail: line items, subtotal, CGST/SGST (same state) aur total. ₹380 par 18% GST = ₹68.40, round off ke baad total ₹448. Upar PDF, Edit aur "Record payment" ke button hain.', {
    annotate: [{ selector: 'main', label: '1' }],
  });

  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.waitForTimeout(600);
  await page.locator('#pay-amount').fill('100');
  await page.waitForTimeout(300);
  await shot(page, 'payment-form', 'Payment record karna', 'Customer ne paisa diya to "Record payment" me amount, date aur mode (Cash / Bank / UPI) daalein. Balance due se zyada amount nahi daal sakte; paise 2 decimal tak hi.', {
    annotate: [{ selector: '#pay-amount', label: '1', focus: true }, { selector: '#pay-mode', label: '2' }],
  });
  await page.getByRole('button', { name: 'Save payment' }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await shot(page, 'payment-saved', 'Payment jud gaya', 'Invoice par "Paid" badh gaya aur "Balance" kam ho gaya. Poora paisa aane par status PAID ho jata hai. Payment ke baad invoice edit/cancel par rok lagti hai — galti ho to accounts se correction karayein.', {
    annotate: [{ selector: 'main', label: '1' }],
  });

  // ------------------------------------------------- 11. production & BOM
  await nav(page, 'Company Inventory', 'BOMs');
  await shot(page, 'bom-list', 'BOM (Bill of Materials)', 'BOM yani recipe: ek finished product banane me kaun-kaun sa raw material aur kitna lagega. BOM banane se stock nahi badalta — sirf plan banta hai.', {
    annotate: [{ selector: 'main', label: '1' }],
  });
  await page.goto('/boms/new', { waitUntil: 'networkidle' });
  await page.locator('#bom-code').fill(`BOM-${stamp}`);
  await page.locator('#bom-name').fill(bomName);
  await choose(page, page.locator('#bom-finished-item'), finishedName);
  await page.getByRole('button', { name: /Add Component/i }).click();
  await choose(page, page.locator('#bom-item-0'), itemName);
  await page.getByLabel('Quantity for component 1').fill('0.5');
  await page.waitForTimeout(400);
  await shot(page, 'bom-form', 'Naya BOM banana', 'Code aur naam dein, "Finished Item" choose karein (jo banta hai), phir "Add Component" dabakar raw material aur uski quantity daalein. Yahan 1 bracket me 0.5 kg bar lagegi.', {
    annotate: [
      { selector: '#bom-code', label: '1' },
      { selector: '#bom-name', label: '2' },
      { selector: '#bom-finished-item', label: '3' },
      { selector: '#bom-item-0', label: '4', focus: true },
      { selector: '[aria-label="Quantity for component 1"]', label: '5', focus: true },
    ],
  });
  await page.getByRole('button', { name: 'Save BOM', exact: true }).click();
  await page.waitForURL('**/boms', { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  await shot(page, 'bom-saved', 'BOM save ho gaya', 'Recipe list me save ho gayi. Ab production batch banate waqt isi BOM ko choose karenge — material lines apne aap aa jayengi.', {
    annotate: [{ selector: 'table', label: '1' }],
  });

  await nav(page, 'Company Inventory', 'Production Batches');
  await shot(page, 'production-list', 'Production Batches', 'Ek batch yani ek shift me bana hua maal. Status PLANNED → IN_PROGRESS → COMPLETED. Batch complete karne par raw material ghatta hai aur finished item badhta hai.', {
    annotate: [{ selector: 'a[href="/production/batches/new"]', label: '1' }, { selector: 'table', label: '2' }],
  });
  await page.goto('/production/batches/new', { waitUntil: 'networkidle' });
  await choose(page, page.locator('#batch-shift'), 'Morning Shift');
  await choose(page, page.locator('#batch-item'), finishedName);
  await choose(page, page.locator('#batch-bom'), bomName);
  await page.locator('#batch-qty').fill('10');
  await page.waitForTimeout(600);
  await shot(page, 'production-form', 'Naya production batch', 'Shift, date, item aur planned quantity bharein. BOM choose karne par material ki lines (kitna raw material lagega) apne aap aa jaati hain.', {
    annotate: [
      { selector: '#batch-shift', label: '1' },
      { selector: '#batch-item', label: '2' },
      { selector: '#batch-bom', label: '3' },
      { selector: '#batch-qty', label: '4', focus: true },
    ],
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL('**/production/batches', { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await openRow(page, 'Morning Shift', /\/production\/batches\/[^/]+$/);
  await shot(page, 'production-batch-open', 'Batch khul gaya', 'Batch PLANNED status me hai. Pehle "Start" dabayein, phir actual material consumption (kitna material really laga) check karke "Save Changes" karein, aur ant me "Complete" me produced quantity daalein.', {
    annotate: [{ selector: 'main', label: '1' }],
  });
  const startBtn = page.getByRole('button', { name: 'Start', exact: true });
  if (await startBtn.count()) {
    await startBtn.click();
    await page.waitForTimeout(700);
    await shot(page, 'production-start-confirm', 'Start ki confirmation', '"Start" dabane par system confirm karta hai — theek hai to "Start batch" dabayein. Iske baad batch IN_PROGRESS ho jata hai.', {
      annotate: [{ selector: '[role="dialog"]', label: '1' }],
    });
    await page.getByRole('dialog').getByRole('button', { name: /Start batch/i }).click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
  }
  await shot(page, 'production-batch-started', 'Batch IN_PROGRESS — actual material bharein', 'Ab actual quantities edit ho sakti hain. Material jo use nahi hua uski quantity 0 kar dein, phir "Save Changes" karein.', {
    annotate: [{ selector: 'main', label: '1' }],
  });

  // ------------------------------------------- 12. customer material/jobwork
  await nav(page, 'Customer Inventory', 'Customer Material');
  await shot(page, 'customer-material-list', 'Customer Inventory → Customer Material', 'Customer ka apna maal jo kaam ke liye aapke paas aaya hai. Yeh company stock se bilkul alag ledger hai — yahan ki quantity company item ke stock me nahi milti.', {
    annotate: [{ selector: 'main', label: '1' }],
  });
  await page.goto('/customer-material/new', { waitUntil: 'networkidle' });
  await choose(page, page.locator('#cm-customer'), customerName);
  await page.locator('#cm-desc').fill('Customer ke forging blanks');
  await page.locator('#cm-qty').fill('40');
  await page.locator('#cm-lot').fill(`LOT-${stamp}`);
  await page.locator('#cm-location').fill('Store-A');
  await page.waitForTimeout(400);
  await shot(page, 'customer-material-form', 'Customer ka maal inward karna', 'Customer, material ka description aur quantity bharein. Heat/lot number aur location likhna acchi practice hai taaki maal trace ho sake. Yeh 40 pcs company stock me NAHI judengi — alag customer lot ledger me jayengi.', {
    annotate: [
      { selector: '#cm-customer', label: '1' },
      { selector: '#cm-desc', label: '2' },
      { selector: '#cm-qty', label: '3', focus: true },
      { selector: '#cm-lot', label: '4' },
    ],
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL(/customer-material/, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);

  await nav(page, 'Customer Inventory', 'Vendor Dispatch (Jobwork)');
  await shot(page, 'jobwork-list', 'Jobwork — vendor ko maal bhejna', 'Maal vendor ko process karwane bhejna. Bhejne par quantity stock/lot se kam hoti hai, wapas aane par "Receive" karke badhti hai.', {
    annotate: [{ selector: 'main', label: '1' }],
  });

  // -------------------------------------------------- 13. returns & reports
  await nav(page, 'Company Inventory', 'Purchase Returns');
  await shot(page, 'purchase-returns', 'Purchase Returns', 'Kharab ya galat maal vendor ko wapas bhejne ka record. Return process hone par hi stock par asar padta hai.', {
    annotate: [{ selector: 'main', label: '1' }],
  });
  await nav(page, 'Sales', 'Returns');
  await shot(page, 'sales-returns', 'Sales Returns', 'Customer se maal wapas aana. Dhyan rakhein: sirf tab stock badhta hai jab "Physical Receipt" record ho chuka ho (return challan number + received date ke saath).', {
    annotate: [{ selector: 'main', label: '1' }],
  });

  await nav(page, 'Analytics', 'Reports');
  await shot(page, 'reports', 'Analytics → Reports', 'Yahan se business reports dekhi ja sakti hain aur Excel/PDF me download hoti hain — sales, purchase, stock jaise sabhi reports.', {
    annotate: [{ selector: 'main', label: '1' }],
  });
  await nav(page, 'Analytics', 'Inventory Analytics');
  await shot(page, 'inventory-analytics', 'Inventory Analytics', 'Grafik me dikhta hai kaunsa maal zyada pada hai, kaunsa khatam ho raha hai aur kitna paisa stock me fasa hai.', {
    annotate: [{ selector: 'main', label: '1' }],
  });

  // -------------------------------------------------------------- 14. admin
  await nav(page, 'Admin', 'Users');
  await shot(page, 'users', 'Admin → Users', 'Naya user banana, uska role set karna aur password reset karna yahin se hota hai. Har user ko sirf uske kaam ka access dein.', {
    annotate: [{ selector: 'main', label: '1' }],
  });
  await nav(page, 'Admin', 'Roles');
  await shot(page, 'roles', 'Admin → Roles', 'Role me permissions set hoti hain — read / create / update / delete. Kisi user ko koi link ya button na dikhe to samajh lijiye ki uske role me woh permission nahi hai.', {
    annotate: [{ selector: 'main', label: '1' }],
  });

  // ------------------------------------------------------ 15. metal calculator
  await nav(page, 'Masters', 'Metal Calculator');
  await page.waitForLoadState('networkidle');
  await shot(page, 'metal-calculator', 'Masters → Metal Calculator', 'Weight aur price nikaalne ka tool — round bar, pipe, plate jaise 11 shapes aur 22 metals. Sirf calculation hai, stock par koi asar nahi hota; number copy karke apne document me use karein.', {
    annotate: [{ selector: 'main', label: '1' }],
  });

  // ------------------------------------------------------- 16. global search
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Search pages and actions \(Ctrl or Command Shift K\)/ }).first().click();
  await page.getByLabel('Search pages and actions', { exact: true }).fill('invoice');
  await page.waitForTimeout(900);
  await shot(page, 'global-search', 'Global search (Ctrl + K)', 'Kisi bhi page ka naam ya action type karke seedha wahan pahunch sakte hain — jaise "invoice" likhne par invoice, naya invoice aur dispatch ke options milte hain. Shortcut: Ctrl + K.', {
    annotate: [{ selector: '[role="dialog"], header', label: '1' }],
  });
  await page.keyboard.press('Escape');

  // ------------------------------------------------------ 17. mobile layout
  await page.setViewportSize({ width: 400, height: 860 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await shot(page, 'mobile-dashboard', 'Mobile par software', 'Mobile par bhi sab screens chalti hain. Upar left ka ☰ menu button dabakar sidebar khulega; tables ko side me scroll kiya ja sakta hai.', {
    annotate: [{ selector: 'header', label: '1' }],
    fullPage: false,
  });

  fs.writeFileSync(path.join(SHOTS_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Captured ${manifest.length} screenshots into ${SHOTS_DIR}`);
});
