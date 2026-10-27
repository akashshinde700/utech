import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const { weightFromSize, kindFor, FACTORS } = require('../../src/utils/materialWeight');

// The plant's own formulas, supplied 27 Oct 2026:
//   plate  W × L × T × 0.0000085
//   round  Ø × Ø × L × 0.0000065     (hex measured the same way)
// Pipe and flange have no agreed formula and must stay unknown.

describe('materialWeight — the plant formulas', () => {
  it('uses exactly the agreed factors', () => {
    expect(FACTORS).toEqual({ plate: 0.0000085, round: 0.0000065 });
  });

  it('plate: 1500 x 3000 x 12 th = 459 kg', () => {
    expect(weightFromSize('1500 x 3000 x 12 th', 'plate').kg).toBe(459);
  });

  it('round: OD 60 X 5 mtr. = 117 kg (metres become millimetres)', () => {
    expect(weightFromSize('OD 60 X 5 mtr.', 'round').kg).toBe(117);
  });

  it('round: a length already in mm is not converted again', () => {
    expect(weightFromSize('OD 25 X 2000 L', 'round').kg).toBe(8.125);
  });

  it('hex bar is measured like a round bar', () => {
    expect(weightFromSize('Hex 38 X 8 mtr.', 'round').kg).toBe(75.088);
  });

  it("plate in feet: 8' X 4' X 3 MM", () => {
    // 8ft = 2438.4 mm, 4ft = 1219.2 mm
    expect(weightFromSize("8' X 4' X 3 MM", 'plate').kg).toBeCloseTo(75.809, 3);
  });

  it('refuses a size it cannot read', () => {
    expect(weightFromSize('', 'plate')).toBeNull();
    expect(weightFromSize('as drawing', 'round')).toBeNull();
    expect(weightFromSize('1500 x 3000', 'plate')).toBeNull(); // thickness missing
  });
});

describe('materialWeight — which formula applies', () => {
  it('plate and round are recognised', () => {
    expect(kindFor({ name: 'Plate 1500 x 3000 x 12 th', size: '1500 x 3000 x 12 th' })).toBe('plate');
    expect(kindFor({ name: 'Round Bar OD 60', size: 'OD 60 X 5 mtr.' })).toBe('round');
    expect(kindFor({ name: 'Hex 38', size: 'Hex 38 X 8 mtr.' })).toBe('round');
  });

  it('pipe and flange have no formula yet, and must not fall through to plate', () => {
    expect(kindFor({ name: 'Pipe OD 60.3', size: 'OD 60.3 X ID 54 X 6 MTR' })).toBeNull();
    expect(kindFor({ name: 'Flange OD 183 X 25 TH', size: 'OD 183 X 25 TH' })).toBeNull();
    expect(kindFor({ name: 'Flange', size: 'OD 300 X 150 X 22 TH' })).toBeNull();
  });
});

describe('the frontend copy stays identical', () => {
  it('backend and frontend compute the same way', () => {
    const be = fs.readFileSync(path.resolve(__dirname, '../../src/utils/materialWeight.js'), 'utf8');
    const fe = fs.readFileSync(path.resolve(__dirname, '../../../frontend/src/lib/materialWeight.js'), 'utf8');
    const body = (src) => src
      .replace(/\r/g, '')
      .replace(/^'use strict';\n*/, '')
      .replace(/^export /gm, '')
      .replace(/module\.exports = \{[^}]*\};\n*/, '')
      .replace(/^\/\/ mirrored from.*$/gm, '')
      .trim();
    expect(body(fe)).toBe(body(be));
  });
});
