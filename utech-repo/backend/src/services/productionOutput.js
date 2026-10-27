'use strict';
const HttpError = require('../utils/httpError');

// MFG-04 / MFG-05 — production output is owned by the production batches.
//
// A job card's produced/rejected quantity is no longer typed in by hand: it is
// the sum of its COMPLETED batches, recomputed whenever a batch changes. That
// keeps one number instead of two that can drift apart.

const SCRAP_ITEM_CODE = 'SCRAP';

async function syncJobcardOutput(tx, jobcardId) {
  if (!jobcardId) return null;
  const agg = await tx.productionBatch.aggregate({
    where: { jobcardId, status: 'COMPLETED' },
    _sum: { qtyProduced: true, qtyRejected: true },
  });
  const qtyProduced = Number(agg._sum.qtyProduced || 0);
  const qtyRejected = Number(agg._sum.qtyRejected || 0);
  await tx.jobcard.update({ where: { id: jobcardId }, data: { qtyProduced, qtyRejected } });
  return { qtyProduced, qtyRejected };
}

// The scrap register: one catalog item that collects everything rejected on the
// shop floor, so scrap is visible and valuable instead of only a number on a
// batch. Created on first use so no migration or manual setup is needed.
async function getScrapItem(tx) {
  const existing = await tx.item.findUnique({ where: { code: SCRAP_ITEM_CODE } });
  if (existing) return existing;
  return tx.item.create({
    data: {
      code: SCRAP_ITEM_CODE,
      name: 'Production Scrap',
      type: 'CONSUMABLE',
      description: 'Auto-created scrap register: rejected production is written off here.',
    },
  });
}

// Rejected pieces consumed material but never entered finished stock, so the
// finished item's balance is already right — what was missing is the scrap
// itself. Book it in against the scrap item.
async function postScrapWriteOff(tx, stockService, { batch, qtyRejected, date }) {
  const qty = Number(qtyRejected || 0);
  if (!(qty > 0)) return null;
  const scrap = await getScrapItem(tx);
  await stockService.moveCompanyStock({
    tx,
    itemId: scrap.id,
    date: date || new Date(),
    refType: 'SCRAP',
    refId: batch.id,
    qtyIn: qty,
    notes: `Scrap from production batch ${batch.number}` + (batch.item ? ` (${batch.item.name})` : ''),
    skipAudit: true,
  });
  return scrap;
}

// QC-02 — a job card is only finished once its quality check says so.
async function assertQualityPassed(db, jobcardId) {
  const checks = await db.qualityCheck.findMany({
    where: { refType: 'JOBCARD', refId: jobcardId },
    select: { number: true, result: true },
  });
  if (!checks.length) {
    throw new HttpError(400, 'No quality check exists for this project — record one and mark it PASS before completing');
  }
  const open = checks.filter((c) => c.result !== 'PASS');
  if (open.length) {
    const detail = open.map((c) => `${c.number} (${c.result})`).join(', ');
    throw new HttpError(400, `Quality is not cleared: ${detail}. Every quality check must be PASS before the project can be completed.`);
  }
  return checks;
}

module.exports = { syncJobcardOutput, getScrapItem, postScrapWriteOff, assertQualityPassed, SCRAP_ITEM_CODE };
