import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { amountInWordsINR as feWords } from '../../src/lib/numberToWords';

// The screen invoice (frontend) and the printed PDF (backend) must read the
// same amount in words. src/utils/numberToWords.js carries an explicit
// "kept byte-for-byte in sync with the frontend copy" contract, so this test
// executes BOTH implementations over the same inputs and compares.
const requireCjs = createRequire(import.meta.url);
const { amountInWordsINR: beWords } = requireCjs('../../../backend/src/utils/numberToWords');

describe('amount-in-words parity: frontend (screen) vs backend (printed PDF)', () => {
  const amounts = [
    0, 1, 0.5, 0.01, 0.99, 1.01, 10, 21, 99.99, 100, 105, 999, 1000, 1001,
    12345, 100000, 100001, 123456, 1000000, 10000000, 12345678, 99999999.99,
    123456789.5, -1, -1500, -0.5, 10.995, 1e9, 1234567.89,
  ];

  it.each(amounts)('amount %s renders identically in both', (amount) => {
    const fe = feWords(amount);
    const be = beWords(amount);
    expect(fe).toBe(be);
  });

  it('agrees across a 5000-value sweep', () => {
    for (let i = 0; i < 5000; i += 1) {
      const amount = (i * 13.37) - 1000;
      expect(feWords(amount), `amount ${amount}`).toBe(beWords(amount));
    }
  });

  it('never emits undefined or NaN on the printed document', () => {
    for (const amount of amounts) {
      expect(beWords(amount)).not.toMatch(/undefined|NaN/);
      expect(feWords(amount)).not.toMatch(/undefined|NaN/);
    }
  });
});
