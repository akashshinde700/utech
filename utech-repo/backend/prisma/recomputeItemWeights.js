'use strict';

/**
 * CLI: recompute Item.weightKg for every item from its size + metal, using the
 * metal calculator.
 *
 *   npm run items:recompute-weights          # show what would change
 *   npm run items:recompute-weights -- --apply
 *
 * Weight is a DERIVED field: size × shape × density. Whenever that chain
 * changes — a corrected size, a metal picked, a density fixed, or the engine
 * itself replaced — the stored figure has to follow, or the item and the
 * calculator page start disagreeing.
 *
 * It touches `weightKg` and nothing else. Stock, rates and the ledger are
 * owned by operational documents and are never written here.
 */

const { weightForItem } = require('../src/utils/materialWeight');

const APPLY = process.argv.includes('--apply');

function fmt(v) {
  return v == null ? '—' : `${Number(v)} kg`;
}

async function main() {
  const prisma = require('../src/config/prisma');
  const items = await prisma.item.findMany({
    select: { id: true, code: true, name: true, size: true, metal: true, shape: true, weightKg: true },
    orderBy: { code: 'asc' },
  });

  const changes = [];
  for (const item of items) {
    const computed = weightForItem(item);
    const next = computed ? computed.kg : null;
    const current = item.weightKg == null ? null : Number(item.weightKg);
    if (next === current) continue;
    changes.push({ item, current, next });
  }

  if (!changes.length) {
    console.log(`All ${items.length} item weights already match their size and metal. Nothing to do.`);
    return;
  }

  console.log(`${changes.length} of ${items.length} item(s) would change:\n`);
  for (const c of changes.slice(0, 40)) {
    console.log(`  ${c.item.code.padEnd(9)} ${String(c.item.size || '').slice(0, 26).padEnd(28)} ${fmt(c.current).padStart(12)} -> ${fmt(c.next)}`);
  }
  if (changes.length > 40) console.log(`  … and ${changes.length - 40} more`);

  if (!APPLY) {
    console.log('\nNothing was written. Re-run with --apply to save these weights.');
    return;
  }

  for (const c of changes) {
    await prisma.item.update({ where: { id: c.item.id }, data: { weightKg: c.next } });
  }
  console.log(`\nUpdated ${changes.length} item weight(s). Stock, rates and the ledger were not touched.`);
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(async () => {
    try { await require('../src/config/prisma').$disconnect(); } catch { /* nothing to close */ }
  });
