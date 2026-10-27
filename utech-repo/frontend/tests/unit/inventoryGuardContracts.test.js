import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// UI CONTRACT GUARDS — audit pass 2026-10-27
//
//   AUD-210  GRN cancellation must not silently reverse into negative stock
//   AUD-211  a sales return cannot restore stock without a physical receipt
//
// Source-level guards, same technique as jobcardFormPayload/navPermissionContract:
// they pin the wiring that the Playwright suite exercises end-to-end, and fail
// loudly if someone "simplifies" the screen back into the unsafe shape.

const FRONTEND = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(FRONTEND, rel), 'utf8').replace(/\r/g, '');

describe('AUD-210 — GRN cancel dialog contract', () => {
  const src = read('src/pages/purchase/GRNView.jsx');

  it('sends an explicit force flag with the cancellation, defaulting to false', () => {
    expect(src).toMatch(/api\.delete\(`\/grns\/\$\{id\}`, \{ data: \{ reason: reason\.trim\(\), force \} \}\)/);
    expect(src).toMatch(/async function cancelGrn\(force = false\)/);
  });

  it('surfaces the server shortfall instead of a generic toast', () => {
    expect(src).toMatch(/no longer on hand/);
    expect(src).toMatch(/role="alert"/);
  });

  it('only offers the forced reversal to a stock administrator', () => {
    expect(src).toMatch(/hasPermission\(user, 'stock\.adjust'\)/);
    expect(src).toMatch(/shortfall && canForce/);
  });
});

describe('AUD-211 — sales return physical receipt contract', () => {
  const src = read('src/pages/salesReturns/SalesReturnForm.jsx');

  it('records the receipt through the dedicated endpoint', () => {
    expect(src).toMatch(/`\/sales-returns\/\$\{id\}\/receipt`/);
    expect(src).toMatch(/returnChallanNo/);
    expect(src).toMatch(/receivedAt/);
  });

  it('cannot process a return until the receipt is recorded', () => {
    // the gate + the disabled button that mirrors the server rule
    expect(src).toMatch(/const hasReceipt = !!\(data\?\.returnChallanNo && data\?\.receivedAt\)/);
    expect(src).toMatch(/disabled=\{!hasReceipt\}/);
  });

  it('sends an empty (validated) body to process, never client-supplied proof', () => {
    expect(src).toMatch(/api\.post\(`\/sales-returns\/\$\{id\}\/process`, \{\}\)/);
  });

  it('shows the recorded proof, so the operator sees what the ledger is based on', () => {
    expect(src).toMatch(/Receipt recorded/);
    expect(src).toMatch(/data\.dispatchChallan\?\.number/);
  });
});
