'use strict';

// Company material inventory imported from the four photographed stock sheets
// in utech-repo/company_inventory/ (Round Bar & Hex, Pipe, Plates, Flanges).
//
// These tests are the guard rail around the hand transcription: they prove the
// rows reproduce each sheet's printed Total=, that every line is attributable to
// the company and a source sheet, and that seeding is additive/idempotent so a
// re-run can never re-stock or re-price materials an operational document has
// already moved.
import { beforeAll, describe, expect, it } from 'vitest';

const inventory = require('../../prisma/companyInventory');
const { createInMemoryPrisma } = require('../../src/config/inMemoryPrisma');

describe('company inventory source data', () => {
  it('transcribes all four sheets with the expected line counts', () => {
    const { summary, totals } = inventory.verify();
    expect(summary.map((s) => [s.title, s.lines])).toEqual([
      ['ROUND BAR & HEX', 18],
      ['PIPE', 20],
      ['PLATES', 20],
      ['FLANGES', 15],
    ]);
    expect(totals.lines).toBe(73);
    expect(totals.qty).toBe(220);
  });

  it('reproduces every printed Total= exactly from the rate column', () => {
    const { ok, summary, checks } = inventory.verify();
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(ok).toBe(true);
    expect(summary.map((s) => s.rateSum)).toEqual([689200, 1015700, 2385000, 189900]);
    expect(summary.map((s) => s.rateSum)).toEqual(summary.map((s) => s.printedTotal));
  });

  it('reports the qty × rate reading separately instead of silently assuming it', () => {
    const { totals } = inventory.verify();
    // The printed totals are NOT qty × rate — this is the documented ambiguity.
    expect(totals.valueSum).toBe(11677400);
    expect(totals.valueSum).not.toBe(totals.printedTotal);
  });

  it('proves the sheets belong to this company (identity, plant, state, grades)', () => {
    const identity = inventory.assertSameCompany();
    expect(identity.checks.filter((c) => !c.ok)).toEqual([]);
    expect(identity.company.name).toBe('U-Tech Automation Industries');
    expect(identity.company.stateCode).toBe('27');
    expect(identity.company.address).toMatch(/Chikhali/);
  });

  it('never invents a material grade for the flange sheet, which has no grade column', () => {
    const items = inventory.buildItems();
    const unspecified = items.filter((i) => i.gradeCode === 'UNSPECIFIED');
    expect(unspecified).toHaveLength(15);
    expect(new Set(unspecified.map((i) => i.sheetKey))).toEqual(new Set(['FLANGE']));
  });

  it('normalises grade spellings so SS 304 / SS304 do not become two different items', () => {
    const items = inventory.buildItems();
    const ss304 = items.filter((i) => i.gradeCode === 'SS304');
    expect(ss304.length).toBeGreaterThan(1);
    expect(ss304.every((i) => i.gradeLabel === 'SS 304')).toBe(true);
    expect(items.filter((i) => i.sheetKey === 'PIPE' && i.gradeCode === 'MS')).toHaveLength(5);
  });

  it('generates unique, traceable item codes and names', () => {
    const items = inventory.buildItems();
    expect(new Set(items.map((i) => i.code)).size).toBe(items.length);
    expect(new Set(items.map((i) => i.name)).size).toBe(items.length);
    expect(items[0].code).toBe('RB-0001');
    expect(items.at(-1).code).toBe('FL-0015');
    expect(items.every((i) => i.description.includes('U-Tech Automation Industries'))).toBe(true);
    expect(items.every((i) => i.description.includes(i.source))).toBe(true);
  });

  it('rejects an unknown grade instead of importing it as junk', () => {
    expect(() => inventory.gradeCode('UNOBTANIUM')).toThrow(/Unknown material grade/);
  });
});

describe('company inventory seed into the database', () => {
  let prisma;

  beforeAll(() => {
    prisma = createInMemoryPrisma();
  });

  it('creates one item per sheet line with matching opening stock and ledger row', async () => {
    const result = await inventory.seedCompanyInventory(prisma);
    expect(result.created).toBe(73);
    expect(result.skipped).toBe(0);
    expect(result.ledgerRows).toBe(73);

    const items = await prisma.item.findMany({ where: { code: { startsWith: 'RB-' } } });
    expect(items).toHaveLength(18);
    const first = await prisma.item.findUnique({ where: { code: 'RB-0001' } });
    expect(first.name).toMatch(/Round Bar OD 60 X 5 mtr/);
    expect(first.type).toBe('RAW_MATERIAL');
    expect(Number(first.currentStock)).toBe(3);
    expect(Number(first.openingStock)).toBe(3);
    expect(Number(first.purchaseRate)).toBe(10500);
    expect(first.hsnCode).toBe('7228');

    const ledger = await prisma.stockLedger.findMany({ where: { itemId: first.id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].refType).toBe('OPENING');
    expect(Number(ledger[0].qtyIn)).toBe(3);
    expect(Number(ledger[0].balance)).toBe(3);
    expect(ledger[0].ownerType).toBe('COMPANY');

    const categories = await prisma.itemCategory.findMany();
    expect(categories.map((c) => c.name).sort()).toEqual(['Flange', 'Pipe', 'Plate', 'Round Bar & Hex']);
  });

  it('is idempotent: a second run adds nothing and never rewrites a moved balance', async () => {
    const first = await prisma.item.findUnique({ where: { code: 'PP-0008' } });
    // simulate an operational movement after the import
    await prisma.item.update({ where: { id: first.id }, data: { currentStock: 1 } });

    const second = await inventory.seedCompanyInventory(prisma);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(73);
    expect(second.ledgerRows).toBe(0);

    const after = await prisma.item.findUnique({ where: { code: 'PP-0008' } });
    expect(Number(after.currentStock)).toBe(1); // untouched
    expect(await prisma.item.count()).toBe(73);
    expect(await prisma.stockLedger.count({ where: { refType: 'OPENING' } })).toBe(73);
  });

  it('keeps company stock equal to the sum of its own ledger for every imported item', async () => {
    const items = await prisma.item.findMany({ where: { code: { startsWith: 'FL-' } } });
    for (const item of items) {
      const rows = await prisma.stockLedger.findMany({ where: { itemId: item.id } });
      const ledgerTotal = rows.reduce((s, r) => s + Number(r.qtyIn) - Number(r.qtyOut), 0);
      expect(ledgerTotal).toBe(Number(item.currentStock));
    }
  });
});
