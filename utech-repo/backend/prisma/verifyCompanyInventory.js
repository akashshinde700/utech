'use strict';

/**
 * CLI: verify the hand-transcribed company material inventory and prove it
 * belongs to this company.
 *
 *   npm run inventory:verify          # print the reconciliation table
 *   npm run inventory:verify -- --json
 *
 * Exits 1 when any check fails, so it can be wired into CI/deploy pipelines.
 * It never connects to the database: this validates the SOURCE data (the four
 * sheets in company_inventory/) before anyone trusts it for a seed or a report.
 */

const { COMPANY, verify, assertSameCompany, SHEETS, buildItems } = require('./companyInventory');

function money(n) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function main() {
  const json = process.argv.includes('--json');
  const company = assertSameCompany();
  const result = verify();
  const items = buildItems();

  if (json) {
    console.log(JSON.stringify({ company: company.company, sameCompany: company.ok, ...result }, null, 2));
    process.exitCode = company.ok && result.ok ? 0 : 1;
    return;
  }

  console.log('');
  console.log(`Company inventory source verification — ${company.company.name}`);
  console.log(`Plant: ${company.company.address}`);
  console.log(`State: ${company.company.state} (${company.company.stateCode})   Source folder: ${company.company.sourceFolder}/`);
  console.log('');

  console.log('Per-sheet reconciliation (transcription vs the printed Total= on the photograph)');
  console.log('─'.repeat(96));
  console.log(
    `${'Sheet'.padEnd(16)}${'File'.padEnd(12)}${'Lines'.padStart(6)}${'Qty'.padStart(6)}` +
    `${'Σ Rate'.padStart(14)}${'Printed'.padStart(14)}${'Σ Qty×Rate'.padStart(15)}  Match`
  );
  console.log('─'.repeat(96));
  for (const sheet of result.summary) {
    console.log(
      `${sheet.title.padEnd(16)}${sheet.source.replace('company_inventory/', '').padEnd(12)}` +
      `${String(sheet.lines).padStart(6)}${String(sheet.qty).padStart(6)}` +
      `${money(sheet.rateSum).padStart(14)}${money(sheet.printedTotal).padStart(14)}` +
      `${money(sheet.valueSum).padStart(15)}  ${sheet.matches ? 'OK' : 'MISMATCH'}`
    );
  }
  console.log('─'.repeat(96));
  console.log(
    `${'TOTAL'.padEnd(34)}${String(result.totals.qty).padStart(6)}` +
    `${money(result.totals.rateSum).padStart(14)}${money(result.totals.printedTotal).padStart(14)}` +
    `${money(result.totals.valueSum).padStart(15)}`
  );
  console.log('');
  console.log(`Item codes: ${SHEETS.map((s) => s.codePrefix).join(', ')} → ${items.length} roll-up lines`);
  console.log('');

  const print = (title, checks) => {
    console.log(title);
    for (const c of checks) {
      console.log(`  ${c.ok ? '✔' : '✗'} ${c.name}${c.detail ? `  [${c.detail}]` : ''}`);
    }
    console.log('');
  };
  print('Same-company evidence', company.checks);

  const failed = [...company.checks, ...result.checks].filter((c) => !c.ok);
  if (failed.length) {
    console.error(`FAILED (${failed.length}):`);
    for (const f of failed) console.error(`  • ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `All ${company.checks.length + result.checks.length} checks passed — the four sheets belong to ` +
    `${COMPANY.name} and every line reconciles with its printed total.`
  );
  console.log('');
}

main();
