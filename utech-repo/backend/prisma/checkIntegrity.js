'use strict';

/**
 * CLI: re-derive every cached total in the database and report what does not
 * add up.
 *
 *   npm run db:check-integrity
 *
 * Read-only. It never writes a correction: a stock or payment figure that
 * disagrees with its ledger is a question about what actually happened in the
 * plant, and the answer is not something a script can guess. Exit code 1 means
 * something drifted, so this can also run as a post-deploy gate.
 *
 * See `src/services/integrityCheck.js` for why these three caches exist and
 * which columns carry an id with no foreign key behind it.
 */

const {
  reconcileStock,
  reconcileInvoicePayments,
  checkInvoiceStatus,
  findOrphans,
  reconcileCustomerLots,
  buildReport,
} = require('../src/services/integrityCheck');

const ids = (rows) => new Set(rows.map((r) => Number(r.id)));

async function collect(prisma) {
  const [items, ledger, invoices, payments, lots] = await Promise.all([
    prisma.item.findMany({ select: { id: true, code: true, name: true, currentStock: true } }),
    prisma.stockLedger.findMany({
      select: { itemId: true, qtyIn: true, qtyOut: true, ownerType: true, customerMaterialLotId: true },
    }),
    prisma.invoice.findMany({ select: { id: true, number: true, total: true, amountPaid: true, status: true } }),
    prisma.invoicePayment.findMany({ select: { invoiceId: true, amount: true } }),
    prisma.customerMaterialLot.findMany({ select: { id: true, inwardNumber: true } }),
  ]);

  // the logical foreign keys: an id column with no constraint behind it, so
  // the database cannot refuse an orphan
  const [bomItems, srLines, prLines, jobcards, projects, challans, invoiceLines, grnLines, parties] =
    await Promise.all([
      prisma.bomItem.findMany({ select: { id: true, itemId: true } }),
      prisma.salesReturnLine.findMany({ select: { id: true, invoiceLineId: true } }),
      prisma.purchaseReturnLine.findMany({ select: { id: true, grnLineId: true } }),
      prisma.jobcard.findMany({ select: { id: true, itemId: true } }),
      prisma.project.findMany({ select: { id: true, partyId: true } }),
      prisma.dispatchChallan.findMany({ select: { id: true, invoiceId: true } }),
      prisma.invoiceLine.findMany({ select: { id: true } }),
      prisma.grnLine.findMany({ select: { id: true } }),
      prisma.party.findMany({ select: { id: true } }),
    ]);

  return {
    items, ledger, invoices, payments, lots,
    references: [
      { label: 'BomItem.itemId -> Item', rows: bomItems, column: 'itemId', validIds: ids(items) },
      { label: 'SalesReturnLine.invoiceLineId -> InvoiceLine', rows: srLines, column: 'invoiceLineId', validIds: ids(invoiceLines) },
      { label: 'PurchaseReturnLine.grnLineId -> GrnLine', rows: prLines, column: 'grnLineId', validIds: ids(grnLines) },
      { label: 'Jobcard.itemId -> Item', rows: jobcards, column: 'itemId', validIds: ids(items) },
      { label: 'Project.partyId -> Party', rows: projects, column: 'partyId', validIds: ids(parties) },
      { label: 'DispatchChallan.invoiceId -> Invoice', rows: challans, column: 'invoiceId', validIds: ids(invoices) },
    ],
  };
}

function report(data) {
  return buildReport([
    { id: 'stock', label: 'Item.currentStock vs company stock ledger', findings: reconcileStock(data) },
    { id: 'payments', label: 'Invoice.amountPaid vs recorded payments', findings: reconcileInvoicePayments(data) },
    { id: 'invoice-status', label: 'Invoice status vs amount paid', findings: checkInvoiceStatus(data) },
    { id: 'customer-lots', label: 'Customer material lots vs their ledger', findings: reconcileCustomerLots(data) },
    { id: 'orphans', label: 'Logical foreign keys with no constraint behind them', findings: findOrphans(data.references) },
  ]);
}

async function main() {
  const prisma = require('../src/config/prisma');
  const data = await collect(prisma);
  const result = report(data);

  console.log(`Integrity check — ${data.items.length} items, ${data.ledger.length} ledger rows, ${data.invoices.length} invoices\n`);
  for (const check of result.checks) {
    console.log(`  [${check.status === 'OK' ? 'OK   ' : 'DRIFT'}] ${check.label}${check.count ? ` — ${check.count}` : ''}`);
    for (const f of check.findings.slice(0, 20)) console.log(`           ${JSON.stringify(f)}`);
    if (check.count > 20) console.log(`           … and ${check.count - 20} more`);
  }

  if (result.ok) {
    console.log('\nEvery cached total matches the rows it is derived from.');
  } else {
    console.log('\nSomething does not add up. Nothing was changed — the ledger is the record of what happened,');
    console.log('so a drifting cache needs a decision (and usually an ADJUSTMENT entry), not a silent overwrite.');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main()
    .catch((e) => { console.error(e.message); process.exitCode = 1; })
    .finally(async () => {
      try { await require('../src/config/prisma').$disconnect(); } catch { /* nothing to close */ }
    });
}

module.exports = { collect, report };
