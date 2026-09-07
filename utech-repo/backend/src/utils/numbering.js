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
async function allocate(key, computeStart) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // `key` is a reserved word in MySQL — always backtick-quoted here.
        const rows = await tx.$queryRaw`SELECT \`current\` AS c FROM \`NumberSequence\` WHERE \`key\` = ${key} FOR UPDATE`;
        if (rows.length > 0) {
          const n = Number(rows[0].c) + 1;
          await tx.$executeRaw`UPDATE \`NumberSequence\` SET \`current\` = ${n} WHERE \`key\` = ${key}`;
          return n;
        }
        const start = Math.max(1, await computeStart(tx));
        await tx.$executeRaw`INSERT INTO \`NumberSequence\` (\`key\`, \`current\`) VALUES (${key}, ${start})`;
        return start;
      });
    } catch (e) {
      // two processes seeding the same new key race the INSERT — the loser
      // retries once and lands on the locked-increment path above
      const duplicate = e && (e.code === 'P2002' || e.code === 'P2010' || /duplicate/i.test(String(e.message)));
      if (!duplicate || attempt === 1) throw e;
    }
  }
}

function extractSeq(value) {
  const m = value && String(value).match(/-(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

async function nextNumber(model, kind, field = 'number') {
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
  }));
  return `${prefix}-${yr}-${String(n).padStart(5, '0')}`;
}

async function nextCode(model, kind) {
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
  }));
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

module.exports = { nextNumber, nextCode };
