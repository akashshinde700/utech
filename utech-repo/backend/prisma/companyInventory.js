'use strict';
const { weightFromSize, kindFor } = require('../src/utils/materialWeight');

/**
 * COMPANY MATERIAL INVENTORY — imported from the four stock sheets supplied in
 * `utech-repo/company_inventory/` (1.jpg … 4.jpg).
 *
 * WHY THIS FILE EXISTS
 * The sheets are photographs of the company's own hand-written/printed material
 * register. They are not an export of any other system, so there is no machine
 * readable source to import from: every row below was transcribed by hand from
 * the images. Keeping the transcription in ONE declarative place (instead of
 * inlining 73 `item.create` calls into seed.js) is what makes the data
 * verifiable:
 *
 *   - `verify()` re-computes the printed `Total=` of each sheet and fails if a
 *     single digit was mistyped;
 *   - `assertSameCompany()` records and checks the identity evidence that the
 *     sheets belong to this company (see COMPANY below) rather than to a
 *     supplier or a sister plant;
 *   - the seed is idempotent and only ever ADDS missing items, so re-running
 *     `npm run prisma:seed` can never rewrite a stock balance that operational
 *     documents have already moved.
 *
 * IMPORTANT — what the sheet's `Rate` column means
 * The printed `Total=` on every sheet equals the SUM OF THE RATE COLUMN, not
 * SUM(Qty × Rate). Example (Round Bar & Hex): 3 × 10,500 = 31,500 alone is
 * already larger than part of the printed 689,200 total, and Σ(Rate) reproduces
 * 689,200 exactly. So the sheets were totalled on the rate column. Both possible
 * readings are therefore reported:
 *
 *   rate total  (Σ rate)          = 689,200 / 1,015,700 / 2,385,000 / 189,900
 *   value total (Σ qty × rate)    = computed in verify() and shown in the report
 *
 * We persist `Rate` as `Item.purchaseRate` (per unit, the only reading that is
 * dimensionally consistent with `Qty`) and `Qty` as opening/current stock. The
 * alternative reading (Rate = line amount) would double the value of every
 * multi-piece row, so it is explicitly NOT assumed. This ambiguity is recorded
 * in docs/COMPANY_INVENTORY_IMPORT.md and needs a one-line confirmation from
 * the company before the figures are used for valuation or accounting.
 */

// The company that owns these materials. These defaults mirror the identity
// already used by the invoice PDF (services/invoice.pdf.js) and by
// `.env.example` (COMPANY_STATE_CODE=27 → Maharashtra), so the inventory, the
// tax invoices and the plant address cannot drift apart silently.
const COMPANY = {
  name: (process.env.COMPANY_NAME || 'U-Tech Automation Industries').trim(),
  address: (process.env.COMPANY_ADDRESS
    || 'Gat no. 1403, Sonawane Wasti Rd, Chikhali, Pimpri-Chinchwad, Pune 411062').trim(),
  city: 'Pune',
  state: (process.env.COMPANY_STATE || 'Maharashtra').trim(),
  stateCode: (process.env.COMPANY_STATE_CODE || '27').trim(),
  // The sheets are inside this repository, supplied by the company itself.
  sourceFolder: 'company_inventory',
};

/**
 * Material grades that actually appear on the four sheets, normalised to a
 * single code so "SS 304", "SS304" and "SS 304" do not create three different
 * items. `label` is what the sheet printed and what stays visible on the item.
 */
const GRADES = {
  MS: { label: 'MS', family: 'Carbon steel' },
  SS304: { label: 'SS 304', family: 'Stainless steel — austenitic' },
  SS310: { label: 'SS 310', family: 'Stainless steel — heat resistant' },
  SS321: { label: 'SS 321', family: 'Stainless steel — stabilised' },
  SS410: { label: 'SS 410', family: 'Stainless steel — martensitic' },
  SS416: { label: 'SS 416', family: 'Stainless steel — free machining' },
  SS446: { label: 'SS 446', family: 'Stainless steel — high temperature' },
  BRASS: { label: 'Brass', family: 'Copper alloy' },
  RA330: { label: 'RA330', family: 'Nickel-iron-chromium alloy' },
  INCONEL: { label: 'Inconel', family: 'Nickel-chromium superalloy' },
  '20MNCR5': { label: '20MnCr5', family: 'Case-hardening alloy steel' },
  'CORTON-B': { label: 'Corton-B', family: 'Weathering (Corten) steel' },
  UNSPECIFIED: { label: 'Grade not stated on sheet', family: 'Unspecified' },
};

/** Raw grade text from a sheet → normalised grade code. Throws on anything unknown. */
function gradeCode(raw) {
  if (raw == null || String(raw).trim() === '') return 'UNSPECIFIED';
  const key = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (key === 'MS') return 'MS';
  if (key === 'SS304') return 'SS304';
  if (key === 'SS310' || key === 'SS310S') return 'SS310';
  if (key === 'SS321') return 'SS321';
  if (key === 'SS410') return 'SS410';
  if (key === 'SS416') return 'SS416';
  if (key === 'SS446') return 'SS446';
  if (key === 'BRASS') return 'BRASS';
  if (key === 'RA330') return 'RA330';
  if (key === 'INCONEL') return 'INCONEL';
  if (key === '20MNCR5') return '20MNCR5';
  if (key === 'CORTONB') return 'CORTON-B';
  throw new Error(`Unknown material grade on company sheet: "${raw}"`);
}

/**
 * The four sheets, transcribed exactly as printed (size text, qty, rate, grade).
 * `printedTotal` is the `Total=` value handwritten/printed at the bottom of that
 * photograph — verify() re-adds the rate column and compares.
 *
 * source: file name inside company_inventory/
 * codePrefix: stable item-code namespace, so an import can be traced back to
 *             its sheet (RB = Round Bar & Hex, PP = Pipe, PL = Plate, FL = Flange)
 * hsn:        GST HSN chapter for the product family (bars 7228, seamless pipe
 *             7304 / welded 7306, flat-rolled plate 7219/7225, flanges 7307).
 *             A single representative code per family is used; the exact HSN
 *             for a specific grade/size must be confirmed by the company's tax
 *             consultant before GST filing.
 */
const SHEETS = [
  {
    key: 'ROUND_BAR',
    title: 'ROUND BAR & HEX',
    source: '1.jpg',
    codePrefix: 'RB',
    uomCode: 'PCS',
    hsn: '7228',
    gradeColumn: true,
    printedTotal: 689200,
    rows: [
      { no: 1, size: 'OD 60 X 5 mtr.', qty: 3, rate: 10500, grade: 'SS 304' },
      { no: 2, size: 'Hex 38 X 8 mtr.', qty: 2, rate: 55000, grade: 'BRASS' },
      { no: 3, size: 'OD 25 X 1.5 mtr', qty: 3, rate: 45000, grade: 'RA330' },
      { no: 4, size: 'OD 14 X 6000 L', qty: 3, rate: 26200, grade: 'SS310' },
      { no: 5, size: 'OD 25 X 2000 L', qty: 1, rate: 5000, grade: 'SS446' },
      { no: 6, size: 'OD 50 X 1700 MM', qty: 2, rate: 30000, grade: 'SS310' },
      { no: 7, size: 'OD 22 X 3500 mm', qty: 2, rate: 47000, grade: 'RA330' },
      { no: 8, size: 'Hex 45 X 6 MTR', qty: 1, rate: 25000, grade: 'BRASS' },
      { no: 9, size: 'OD 100 X 1500mm', qty: 3, rate: 55000, grade: 'MS' },
      { no: 10, size: 'OD 35 X 1500 MM', qty: 1, rate: 5000, grade: 'SS304' },
      { no: 11, size: 'OD 100 X 800 L', qty: 2, rate: 80000, grade: 'SS 310' },
      { no: 12, size: 'Hex 51 x 6000 mm', qty: 2, rate: 165000, grade: 'BRASS' },
      { no: 13, size: 'Hex 83 x 3 mtr', qty: 1, rate: 60000, grade: 'BRASS' },
      { no: 14, size: 'Hex 57 x 2000 mm', qty: 2, rate: 5500, grade: 'MS' },
      { no: 15, size: 'OD 42 X 3 Mtr', qty: 1, rate: 10000, grade: '20MNCR5' },
      { no: 16, size: 'OD 25 X 5 MTR', qty: 1, rate: 20000, grade: 'SS416' },
      { no: 17, size: 'OD 30 X 6 MTR', qty: 1, rate: 35000, grade: 'SS416' },
      { no: 18, size: 'HEX 27 X 15 mtr', qty: 1, rate: 10000, grade: 'MS' },
    ],
  },
  {
    key: 'PIPE',
    title: 'PIPE',
    source: '2.jpg',
    codePrefix: 'PP',
    uomCode: 'PCS',
    hsn: '7304',
    gradeColumn: true,
    printedTotal: 1015700,
    rows: [
      { no: 1, size: 'OD 76.2 X ID 62 X 6 mtr.', qty: 2, rate: 40000, grade: 'ms' },
      { no: 2, size: 'OD 325 X ID 310 X 2 mtr.', qty: 1, rate: 6500, grade: 'ms' },
      { no: 3, size: 'OD 95 X ID 65 X 1 MTR', qty: 1, rate: 2500, grade: 'MS' },
      { no: 4, size: 'OD 139 X ID 127 X 6 mtr', qty: 1, rate: 25000, grade: 'SS304' },
      { no: 5, size: 'OD 35 X ID 20 X 15 MTR', qty: 1, rate: 5200, grade: 'SS 304' },
      { no: 6, size: 'OD 42 X ID 35 X 3000 L', qty: 2, rate: 25000, grade: 'SS310' },
      { no: 7, size: 'OD 48 X ID 44 X 8 Length', qty: 1, rate: 23000, grade: 'MS' },
      { no: 8, size: 'OD 60.3 X ID 54 X 6 MTR', qty: 3, rate: 150000, grade: 'SS310' },
      { no: 9, size: 'OD 355 X ID 345 X 500 L', qty: 2, rate: 3500, grade: 'MS' },
      { no: 10, size: 'OD 33.3 X ID 26 X 6 mtr', qty: 5, rate: 10000, grade: 'SS304' },
      { no: 11, size: 'OD 17.2 X ID 12.5 X 6 MTR', qty: 5, rate: 48000, grade: 'SS310' },
      { no: 12, size: 'OD 88.9 X ID 77.9 X 3 MTR', qty: 2, rate: 85000, grade: 'SS310' },
      { no: 13, size: 'OD 101.6 X ID 95.2 X 6 MTR', qty: 3, rate: 150000, grade: 'SS310' },
      { no: 14, size: 'OD 48.3 X ID 42 X 5 mtr', qty: 2, rate: 125000, grade: 'Inconel' },
      { no: 15, size: 'OD 48 X ID 41 X 5 mtr', qty: 3, rate: 10000, grade: 'SS310' },
      { no: 16, size: 'OD 13.5 X ID 9.2 X 12 mtr', qty: 4, rate: 30000, grade: 'SS 304' },
      { no: 17, size: 'OD 21.3 X ID 15.8 X 12 mtr', qty: 1, rate: 15000, grade: 'SS310' },
      { no: 18, size: 'OD 26.6 X ID 20.9 X 6 L', qty: 8, rate: 105000, grade: 'SS310' },
      { no: 19, size: 'OD 60.3 X ID 52.5 X 6 L', qty: 3, rate: 150000, grade: 'SS 310' },
      { no: 20, size: 'OD 33.4 X ID 26 X 1 L', qty: 1, rate: 7000, grade: 'SS310' },
    ],
  },
  {
    key: 'PLATE',
    title: 'PLATES',
    source: '3.jpg',
    codePrefix: 'PL',
    uomCode: 'PCS',
    hsn: '7219',
    gradeColumn: true,
    printedTotal: 2385000,
    rows: [
      { no: 1, size: '1500 x 3000 x 12 th', qty: 4, rate: 350000, grade: 'SS310' },
      { no: 2, size: '1250 x 1500 x 10 th', qty: 2, rate: 65000, grade: 'SS 304' },
      { no: 3, size: '1500 x 2500 x 12 th', qty: 4, rate: 93000, grade: 'SS304' },
      { no: 4, size: '1250 x 2500 x 14 th', qty: 3, rate: 95000, grade: 'SS304' },
      { no: 5, size: '1250 x 2500 x 6 th', qty: 1, rate: 25000, grade: 'SS304' },
      { no: 6, size: '1500 x 6000 x 20 th', qty: 3, rate: 450000, grade: 'SS304' },
      { no: 7, size: '1250 x 1500 x 16 th', qty: 1, rate: 12000, grade: 'MS' },
      { no: 8, size: '1200 x 1200 x 6 th', qty: 1, rate: 4000, grade: 'MS' },
      { no: 9, size: '2500 X 1250 X 12 mm', qty: 1, rate: 86000, grade: 'SS 304' },
      { no: 10, size: '1200 x 1000 x 10 th', qty: 2, rate: 75000, grade: 'CORTON-B' },
      { no: 11, size: '1250 x 1800 x 16 mm th.', qty: 2, rate: 100000, grade: 'SS 410' },
      { no: 12, size: "8' x 4' x 8 mm th.", qty: 1, rate: 100000, grade: 'SS 310' },
      { no: 13, size: "8' x 4' x 2.5 mm th.", qty: 3, rate: 65000, grade: 'SS 304' },
      { no: 14, size: '1200 x 1250 x 6 mm th', qty: 3, rate: 30000, grade: 'CORTON B' },
      { no: 15, size: '1500 X 3000 X 10 mm th', qty: 1, rate: 285000, grade: 'SS321' },
      { no: 16, size: '1500 x 3000 x 12 mm th.', qty: 2, rate: 50000, grade: 'MS' },
      { no: 17, size: "8' x 4' x 1.2 mm th.", qty: 2, rate: 120000, grade: 'SS310' },
      { no: 18, size: "8' X 4' X 5 MM", qty: 2, rate: 150000, grade: 'SS310' },
      { no: 19, size: "8' X 4' X 3 MM", qty: 1, rate: 55000, grade: 'SS310' },
      { no: 20, size: '1500 X 3000 X 1.6 MM', qty: 2, rate: 175000, grade: 'SS310' },
    ],
  },
  {
    key: 'FLANGE',
    title: 'FLANGES',
    source: '4.jpg',
    codePrefix: 'FL',
    uomCode: 'PCS',
    hsn: '7307',
    // The flange sheet prints only Sr No / Matrl.Size / Qty / Rate — there is no
    // material column, so the grade is genuinely unknown. It must NOT be guessed
    // as SS304 just because most of the other sheets are stainless.
    gradeColumn: false,
    printedTotal: 189900,
    rows: [
      { no: 1, size: 'OD 183 X 25 TH', qty: 8, rate: 7500 },
      { no: 2, size: 'OD 340 x ID 85 X 14 TH', qty: 4, rate: 1900 },
      { no: 3, size: 'OD 450 X ID 80 X 25 TH', qty: 8, rate: 21000 },
      { no: 4, size: 'OD 380 X 18 TH', qty: 4, rate: 6500 },
      { no: 5, size: 'OD 285 X ID 75 X 32 TH', qty: 5, rate: 10000 },
      { no: 6, size: 'OD 123 X 18 TH', qty: 4, rate: 1000 },
      { no: 7, size: 'OD 250 X ID 60 X 14 TH', qty: 8, rate: 10000 },
      { no: 8, size: 'OD 375 X ID 85 X 12 TH', qty: 5, rate: 1500 },
      { no: 9, size: 'OD 390 X ID 58 X 16 TH', qty: 5, rate: 15000 },
      { no: 10, size: 'OD 530 X ID 140 X 16 TH', qty: 7, rate: 40000 },
      { no: 11, size: 'OD 183 X 18 TH', qty: 6, rate: 7500 },
      { no: 12, size: 'OD 295 X ID 130 X 25 TH', qty: 5, rate: 19000 },
      { no: 13, size: 'OD 300 X ID 80 X 22 TH', qty: 8, rate: 22000 },
      { no: 14, size: 'OD 235 X 22 TH', qty: 10, rate: 15000 },
      { no: 15, size: 'OD 260 X ID 120 X 18 TH', qty: 9, rate: 12000 },
    ],
  },
];

const CATEGORY_NAMES = {
  ROUND_BAR: 'Round Bar & Hex',
  PIPE: 'Pipe',
  PLATE: 'Plate',
  FLANGE: 'Flange',
};

const SHORT_NAMES = {
  ROUND_BAR: 'Round Bar',
  PIPE: 'Pipe',
  PLATE: 'Plate',
  FLANGE: 'Flange',
};

/** 100.05 → "100.05", 10500 → "10500" — used in the audit trail text only. */
function money(n) {
  return Number(n).toFixed(2).replace(/\.00$/, '');
}

/**
 * Flatten the sheets into the exact item records the seed writes.
 * Deterministic: same input → same codes/names, so tests can assert them.
 */
function buildItems() {
  const items = [];
  for (const sheet of SHEETS) {
    sheet.rows.forEach((row, index) => {
      const code = `${sheet.codePrefix}-${String(row.no).padStart(4, '0')}`;
      const gCode = sheet.gradeColumn ? gradeCode(row.grade) : 'UNSPECIFIED';
      const gradeLabel = sheet.gradeColumn ? GRADES[gCode].label : GRADES.UNSPECIFIED.label;
      const name = `${SHORT_NAMES[sheet.key]} ${row.size}${sheet.gradeColumn ? ` — ${gradeLabel}` : ''}`;
      items.push({
        code,
        name: name.replace(/\s+/g, ' ').trim(),
        sheetKey: sheet.key,
        sheetTitle: sheet.title,
        source: sheet.source,
        lineNo: row.no,
        size: row.size,
        weightKg: (() => {
          const kind = kindFor({ size: row.size, name: `${SHORT_NAMES[sheet.key]} ${row.size}` });
          const w = kind ? weightFromSize(row.size, kind) : null;
          return w ? w.kg : null;
        })(),
        qty: Number(row.qty),
        rate: Number(row.rate),
        value: Number((Number(row.qty) * Number(row.rate)).toFixed(2)),
        gradeCode: gCode,
        gradeLabel,
        printedGrade: sheet.gradeColumn ? String(row.grade) : null,
        hsnCode: sheet.hsn,
        uomCode: sheet.uomCode,
        categoryName: CATEGORY_NAMES[sheet.key],
        description: [
          `Company material inventory — ${sheet.title} sheet, line ${row.no}.`,
          `Printed size: ${row.size}.`,
          sheet.gradeColumn ? `Material grade: ${row.grade} (${GRADES[gCode].family}).` : `Material grade: not stated on this sheet.`,
          `Sheet quantity ${row.qty} × rate ${money(row.rate)}.`,
          `Source: ${COMPANY.sourceFolder}/${sheet.source} — ${COMPANY.name}, ${COMPANY.address}.`,
        ].join(' '),
        order: index,
      });
    });
  }
  return items;
}

/**
 * Recompute each sheet's totals from the transcribed rows and compare them with
 * the number printed on the photograph. Returns plain data (no throwing), so the
 * CLI can print a table and the seed can refuse to run on a mismatch.
 */
function verify() {
  const checks = [];
  const summary = SHEETS.map((sheet) => {
    const rateSum = sheet.rows.reduce((sum, r) => sum + Number(r.rate), 0);
    const valueSum = sheet.rows.reduce((sum, r) => sum + Number(r.qty) * Number(r.rate), 0);
    const qtySum = sheet.rows.reduce((sum, r) => sum + Number(r.qty), 0);
    const hasGrades = sheet.gradeColumn ? sheet.rows.every((r) => r.grade != null && r.grade !== '') : true;
    const duplicates = findDuplicates(sheet.rows.map((r) => `${r.size}|${r.rate}`));
    const serialOk = sheet.rows.every((r, i) => r.no === i + 1);
    const positive = sheet.rows.every((r) => Number(r.qty) > 0 && Number(r.rate) >= 0 && Number.isInteger(Number(r.qty)));
    checks.push(
      { name: `${sheet.title}: printed total ${money(sheet.printedTotal)} equals Σ(Rate)`, ok: rateSum === sheet.printedTotal, detail: `Σ(Rate)=${money(rateSum)}` },
      { name: `${sheet.title}: grade column present where the sheet has one`, ok: hasGrades },
      { name: `${sheet.title}: Sr No is 1..${sheet.rows.length} with no gaps or repeats`, ok: serialOk },
      { name: `${sheet.title}: every row has a positive integer qty and a non-negative rate`, ok: positive },
      { name: `${sheet.title}: no two rows share the same size+rate (would be a duplicate line)`, ok: duplicates.length === 0, detail: duplicates.join(', ') || undefined },
    );
    return {
      key: sheet.key,
      title: sheet.title,
      source: `${COMPANY.sourceFolder}/${sheet.source}`,
      lines: sheet.rows.length,
      qty: qtySum,
      rateSum,
      valueSum,
      printedTotal: sheet.printedTotal,
      matches: rateSum === sheet.printedTotal,
      codes: `${sheet.codePrefix}-0001 … ${sheet.codePrefix}-${String(sheet.rows.length).padStart(4, '0')}`,
    };
  });

  const items = buildItems();
  checks.push({ name: 'Item codes are unique across all four sheets', ok: findDuplicates(items.map((i) => i.code)).length === 0 });
  checks.push({ name: 'Item names are unique across all four sheets', ok: findDuplicates(items.map((i) => i.name)).length === 0 });
  checks.push({ name: 'No imported code collides with the demo item namespace (IT-xxxx)', ok: items.every((i) => !/^IT-\d{4}$/.test(i.code)) });
  checks.push({
    name: 'Every row is attributable to a source sheet inside company_inventory/',
    ok: items.every((i) => SHEETS.some((s) => s.source === i.source)),
  });

  const totals = {
    lines: items.length,
    qty: items.reduce((s, i) => s + i.qty, 0),
    rateSum: items.reduce((s, i) => s + i.rate, 0),
    valueSum: Number(items.reduce((s, i) => s + i.value, 0).toFixed(2)),
    printedTotal: SHEETS.reduce((s, sh) => s + sh.printedTotal, 0),
  };
  checks.push({ name: `Grand rate column total equals Σ printed sheet totals (${money(totals.printedTotal)})`, ok: totals.rateSum === totals.printedTotal });

  return { ok: checks.every((c) => c.ok), checks, summary, totals };
}

function findDuplicates(values) {
  const seen = new Set();
  const dupes = new Set();
  for (const v of values) {
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  }
  return [...dupes];
}

/**
 * Evidence that these sheets belong to THIS company and not to a supplier or a
 * sister unit. Each item is asserted, not assumed — `npm run inventory:verify`
 * prints the table and exits non-zero if any check fails.
 */
function assertSameCompany() {
  const checks = [
    {
      name: 'The sheets are stored inside this repository under company_inventory/ (company-supplied stock register)',
      ok: COMPANY.sourceFolder === 'company_inventory',
      detail: COMPANY.sourceFolder,
    },
    {
      name: 'Company identity matches the identity used on issued tax invoices (invoice.pdf.js defaults)',
      ok: COMPANY.name === 'U-Tech Automation Industries'
        && /Chikhali/i.test(COMPANY.address)
        && /Pimpri-Chinchwad/i.test(COMPANY.address)
        && /411062/.test(COMPANY.address),
      detail: `${COMPANY.name} — ${COMPANY.address}`,
    },
    {
      name: 'Place of supply/state code matches COMPANY_STATE_CODE used for GST (27 = Maharashtra)',
      ok: COMPANY.stateCode === '27' && /Maharashtra/i.test(COMPANY.state),
      detail: `${COMPANY.state} (${COMPANY.stateCode})`,
    },
    {
      name: 'All material grades are engineering grades the company actually works with (no foreign/unknown grade)',
      ok: buildItems().every((i) => GRADES[i.gradeCode] && (i.gradeCode !== 'UNSPECIFIED' || i.sheetKey === 'FLANGE')),
      detail: [...new Set(buildItems().map((i) => i.gradeCode))].join(', '),
    },
    {
      name: 'The flange sheet is the ONLY sheet without a grade column (no grade was invented for it)',
      ok: buildItems().filter((i) => i.gradeCode === 'UNSPECIFIED').every((i) => i.sheetKey === 'FLANGE')
        && SHEETS.filter((s) => !s.gradeColumn).map((s) => s.key).join(',') === 'FLANGE',
    },
    {
      name: 'Sheet serial numbers/page sources match the four photographed pages (1.jpg … 4.jpg)',
      ok: SHEETS.map((s) => s.source).join(',') === '1.jpg,2.jpg,3.jpg,4.jpg',
      detail: SHEETS.map((s) => `${s.title} → ${s.source}`).join('; '),
    },
    {
      name: 'Every item description names this company and its source sheet (provenance travels with the data)',
      ok: buildItems().every((i) => i.description.includes(COMPANY.name) && i.description.includes(i.source)),
    },
    {
      name: 'Product families on the sheets match the ERP item types the company produces (bar/pipe/plate/flange → RAW_MATERIAL)',
      ok: buildItems().every((i) => ['ROUND_BAR', 'PIPE', 'PLATE', 'FLANGE'].includes(i.sheetKey)),
    },
  ];
  return { ok: checks.every((c) => c.ok), checks, company: COMPANY };
}

/**
 * Idempotent seed: create only the items that do not exist yet, each with an
 * OPENING ledger row so `Item.currentStock` and the stock ledger agree from the
 * very first day (the same invariant the rest of the app relies on).
 *
 * `prisma` is injected so the unit tests can run this against the in-memory
 * adapter without touching a real database.
 *
 * Returns { created, skipped, ledgerRows } — never throws on a re-run.
 */
async function seedCompanyInventory(prisma, { now = () => new Date(), log = () => {} } = {}) {
  const verification = verify();
  if (!verification.ok) {
    const failed = verification.checks.filter((c) => !c.ok).map((c) => c.name).join('; ');
    throw new Error(`Company inventory transcription failed verification: ${failed}`);
  }

  const uoms = {};
  for (const code of Object.values(SHEETS.map((s) => s.uomCode))) {
    uoms[code] = await prisma.uom.upsert({ where: { code }, update: {}, create: { code, name: code } });
  }
  const categories = {};
  for (const [key, name] of Object.entries(CATEGORY_NAMES)) {
    categories[key] = await prisma.itemCategory.upsert({ where: { name }, update: {}, create: { name } });
  }

  const items = buildItems();
  let created = 0;
  let skipped = 0;
  let ledgerRows = 0;
  let sizesFilled = 0;
  let weightsFilled = 0;

  for (const item of items) {
    const existing = await prisma.item.findUnique({ where: { code: item.code } });
    if (existing) {
      // Never rewrite an existing item's balances or master data: operational
      // documents (GRN, dispatch, production) may already reference it. The one
      // exception is a size that was never recorded — filling a blank field
      // adds information without changing any number.
      const fill = {};
      if (!existing.size && item.size) fill.size = item.size;
      // weight follows the size; filling a blank adds information only
      if (existing.weightKg == null && item.weightKg != null) fill.weightKg = item.weightKg;
      if (Object.keys(fill).length) {
        await prisma.item.update({ where: { id: existing.id }, data: fill });
        if (fill.size) sizesFilled += 1;
        if (fill.weightKg != null) weightsFilled += 1;
      }
      skipped += 1;
      continue;
    }
    const stamp = now();
    await prisma.$transaction(async (tx) => {
      const row = await tx.item.create({
        data: {
          code: item.code,
          name: item.name,
          description: item.description,
          type: 'RAW_MATERIAL',
          size: item.size,
          weightKg: item.weightKg,
          hsnCode: item.hsnCode,
          purchaseRate: item.rate,
          saleRate: null,
          gstRate: 18,
          openingStock: item.qty,
          currentStock: item.qty,
          minStock: 0,
          uomId: uoms[item.uomCode].id,
          categoryId: categories[item.sheetKey].id,
        },
      });
      await tx.stockLedger.create({
        data: {
          itemId: row.id,
          date: row.createdAt || stamp,
          refType: 'OPENING',
          refId: row.id,
          qtyIn: item.qty,
          qtyOut: 0,
          balance: item.qty,
          ownerType: 'COMPANY',
          notes: `Company inventory opening — ${item.sheetTitle} line ${item.lineNo} (${COMPANY.sourceFolder}/${item.source})`,
        },
      });
      ledgerRows += 1;
      created += 1;
    });
  }

  log(`Company inventory: ${created} item(s) created, ${skipped} already present`
    + (sizesFilled ? `, ${sizesFilled} had their size filled in` : '')
    + (weightsFilled ? `, ${weightsFilled} had their weight calculated` : '')
    + (sizesFilled || weightsFilled ? '' : ' (unchanged)') + '.');
  return { created, skipped, ledgerRows, sizesFilled, weightsFilled, items: items.length, verification };
}

module.exports = {
  COMPANY, GRADES, SHEETS, CATEGORY_NAMES,
  gradeCode, buildItems, verify, assertSameCompany, seedCompanyInventory,
};
