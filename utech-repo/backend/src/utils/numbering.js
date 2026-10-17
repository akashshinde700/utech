'use strict';

// Generate sequential document numbers, e.g. INV-2026-00001
//
// Numbers come from the NumberSequence table (one row per prefix+year key)
// instead of the old max+1 read-then-write, which handed out duplicate
// numbers under concurrency and then failed the whole business operation
// with a 409 on the unique index. Allocation is atomic: a single
// transaction takes the key's row lock (SELECT ... FOR UPDATE) before
// incrementing, with a small in-process mutex as belt-and-braces so
// same-process callers queue up instead of round-tripping row locks.
const dayjs = require('dayjs');
const prisma = require('../config/prisma');

const PREFIXES = {
  invoice: 'INV',
  quotation: 'QT',
  vendorQuotation: 'VQ',
  jobcard: 'JC',
  jobwork: 'JW',
  dispatch: 'DC',
  party: 'P',
  item: 'IT',
  customerMaterialLot: 'CML',
  vendorWorkOrder: 'VWO',
};

// One promise chain per key: each allocation starts only after the previous
// one for the same key settled (kept detached so rejections never deadlock
// the chain).
const keyLocks = new Map();
function withKeyLock(key, fn) {
  const prev = keyLocks.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  keyLocks.set(key, run.catch(() => {}));
  return run;
}

// Atomically allocate the next integer for `key`. The first-ever allocation
// for a key seeds the sequence from the real max existing document number, so
// documents created before the sequence table never collide.
//
// The increment is a single UPDATE ... (current = current + 1) executed by the
// database, so two processes can never read the same value: the second one
// blocks on the row lock and gets the next number. This works on every Prisma
// provider (the old MySQL-only `FOR UPDATE` raw SQL did not), and no explicit
// row lock is needed because update-with-increment is atomic on its own.
async function allocateOn(tx, key, computeStart) {
  const existing = await tx.numberSequence.findUnique({
    where: { key },
    select: { current: true },
  });
  if (existing) {
    const updated = await tx.numberSequence.update({
      where: { key },
      data: { current: { increment: 1 } },
      select: { current: true },
    });
    return updated.current;
  }
  const start = Math.max(1, await computeStart(tx));
  await tx.numberSequence.create({ data: { key, current: start } });
  return start;
}

async function allocate(key, computeStart, db = null) {
  // Callers that already hold a transaction must pass it in: opening a second
  // transaction on the global client while the first is still open needs a
  // second pooled connection and deadlocked the request (5s timeout) whenever
  // the pool had one free slot — e.g. sending a vendor work order.
  if (db) return allocateOn(db, key, computeStart);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.$transaction((tx) => allocateOn(tx, key, computeStart));
    } catch (e) {
      // two processes seeding the same new key race the INSERT — the loser
      // retries once and lands on the atomic-increment path above
      const duplicate = e && (e.code === 'P2002' || e.code === 'P2010' || /duplicate|unique/i.test(String(e.message)));
      if (!duplicate || attempt === 1) throw e;
    }
  }
}

function extractSeq(value) {
  const m = value && String(value).match(/-(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

async function nextNumber(model, kind, field = 'number', db = null) {
  const prefix = PREFIXES[kind] || kind.toUpperCase().slice(0, 3);
  const yr = dayjs().format('YY');
  const pattern = `${prefix}-${yr}-`;
  const key = `${model}:${prefix}-${yr}`;
  const n = await withKeyLock(key, () => allocate(key, async (tx) => {
    const last = await tx[model].findFirst({
      where: { [field]: { startsWith: pattern } },
      orderBy: { id: 'desc' },
      select: { [field]: true },
    });
    const seq = extractSeq(last && last[field]);
    return seq == null ? 1 : seq + 1;
  }, db));
  return `${prefix}-${yr}-${String(n).padStart(5, '0')}`;
}

async function nextCode(model, kind, db = null) {
  const prefix = PREFIXES[kind] || kind.toUpperCase().slice(0, 2);
  const key = `${model}:code:${prefix}`;
  const n = await withKeyLock(key, () => allocate(key, async (tx) => {
    const last = await tx[model].findFirst({
      where: { code: { startsWith: `${prefix}-` } },
      orderBy: { id: 'desc' },
      select: { code: true },
    });
    const seq = extractSeq(last && last.code);
    return seq == null ? 1 : seq + 1;
  }, db));
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

module.exports = { nextNumber, nextCode };
