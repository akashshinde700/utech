'use strict';

/**
 * CLI: import ONLY the company material inventory (the four sheets in
 * company_inventory/) into the configured database — no demo parties, invoices,
 * users or sample items.
 *
 *   npm run inventory:seed
 *
 * Behaviour:
 *   - refuses to run until the transcription and the company identity verify;
 *   - ADDITIVE: an item whose code already exists is skipped, never re-priced
 *     and never re-stocked, so it is safe to run against a live database;
 *   - new items get one OPENING stock-ledger row each, so
 *     Item.currentStock always equals the item's ledger sum;
 *   - in NODE_ENV=production it additionally requires
 *     INVENTORY_IMPORT_CONFIRM=1, because opening stock is a business decision
 *     even when the write itself is additive.
 *
 * Use this instead of `npm run prisma:seed` on a real database: the demo seed
 * also creates sample parties/invoices and the publicly known demo admin.
 */

const { assertSameCompany, verify, seedCompanyInventory, COMPANY } = require('./companyInventory');

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.INVENTORY_IMPORT_CONFIRM !== '1') {
    throw new Error(
      'Refusing to write opening stock in production without INVENTORY_IMPORT_CONFIRM=1. '
      + 'Take a database backup first, then re-run with that variable set.'
    );
  }
  // resolved here (not at module load) so a bad database configuration is
  // reported as one clean line instead of an uncaught require() stack trace
  const prisma = require('../src/config/prisma');
  if (prisma._isInMemory) {
    console.warn('[inventory:seed] No database is configured — writing to temporary in-memory storage (nothing is persisted).');
  }

  const identity = assertSameCompany();
  if (!identity.ok) {
    const failed = identity.checks.filter((c) => !c.ok).map((c) => c.name).join('; ');
    throw new Error(`Company identity checks failed: ${failed}`);
  }
  const result = verify();
  if (!result.ok) {
    const failed = result.checks.filter((c) => !c.ok).map((c) => c.name).join('; ');
    throw new Error(`Transcription checks failed: ${failed}`);
  }

  console.log(`Company:  ${COMPANY.name} — ${COMPANY.address}`);
  console.log(`State:    ${COMPANY.state} (${COMPANY.stateCode})`);
  console.log(`Sheets:   ${result.summary.map((s) => `${s.title} ${s.lines} lines/Σ${s.rateSum}`).join(' | ')}`);
  console.log(`Verified: ${result.totals.lines} lines, Σ rate ${result.totals.rateSum} = printed ${result.totals.printedTotal}`);
  console.log('');

  const seeded = await seedCompanyInventory(prisma, { log: console.log });
  console.log('');
  console.log(`Done. ${seeded.created} created, ${seeded.skipped} already present, ${seeded.ledgerRows} opening ledger row(s) written.`);
  if (seeded.skipped) {
    console.log('Existing items were left untouched — their stock and rate are owned by later documents.');
  }
}

main()
  .catch((err) => {
    console.error(`[inventory:seed] ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      const prisma = require('../src/config/prisma');
      await prisma.$disconnect();
    } catch (_err) {
      // in-memory adapter has nothing to disconnect
    }
  });
