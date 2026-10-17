import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// JOBCARD FORM PAYLOAD GUARD — AUD-201 (P1)
//
// Editing a jobcard used to wipe every Task Progress item (JobcardOperation)
// on it: the form always sent `operations: []`, and the jobcard update treats a
// sent array as "replace all" — `[]` deleted every task, plus the assignees and
// task comments that cascade from them. The form does not manage operations at
// all; /api/tasks does. So the save payload must never contain the key.
//
// This test reads the form source (same technique as navPermissionContract) so
// the key cannot be reintroduced by a future copy-paste of the old payload.

const FRONTEND = path.resolve(__dirname, '..', '..');

function payloadZone() {
  const src = fs.readFileSync(path.join(FRONTEND, 'src/pages/jobcards/JobcardForm.jsx'), 'utf8');
  // strip line comments so explanatory prose mentioning `operations` does not
  // trip the check — only executable property keys count
  const code = src
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return code;
}

describe('AUD-201 — JobcardForm save payload', () => {
  it('never sets an `operations` property (create or update)', () => {
    const code = payloadZone();
    // any object property named operations would match `operations:` or
    // `operations :` at a property position
    expect(code).not.toMatch(/\boperations\s*:/);
  });

  // Mechanism documentation: THIS is what the old form sent, and this is what
  // the backend does with it. If either side changes, this pair of facts must
  // be revisited together (see backend/tests/api/regressionDefects.test.js).
  it('the backend replaces operations only when the key is present', () => {
    const ctrl = fs.readFileSync(
      path.resolve(FRONTEND, '..', 'backend', 'src/controllers/jobcard.controller.js'),
      'utf8'
    );
    // the replace is gated on the key being present/truthy
    expect(ctrl).toMatch(/if \(operations\) \{[\s\S]*jobcardOperation\.deleteMany/);
  });
});
