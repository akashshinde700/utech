'use strict';

// The calculator's numbers end up on quotations, so they get the same
// treatment as the GST math: fixed vectors, unit conversions and the failure
// modes (missing dimension, length mode on a plate, table value on a bar).

import { describe, it, expect } from 'vitest';
const {
  METALS,
  SHAPES,
  UNIT_TO_MM,
  KG_TO_LB,
  LBFT_TO_KGM,
  catalog,
  profiles,
  calculate,
} = require('../../src/services/metalCalculator');

const calc = (input) => calculate({ unit: 'mm', weightUnit: 'kg', pieces: 1, ...input });
const steel = { metal: 'Steel' };

describe('catalogue mirrors the APK', () => {
  it('ships the APK\'s 22 metals with their exact densities', () => {
    // metals added for this plant sit alongside them, flagged, and must never
    // change the ported 22
    expect(METALS.filter((m) => !m.addedForPlant)).toHaveLength(22);
    const byName = Object.fromEntries(METALS.map((m) => [m.name, m.density]));
    expect(byName.Steel).toBe(7.85);
    expect(byName.Aluminum).toBe(2.73);
    expect(byName.Copper).toBe(8.93);
    expect(byName['SS 316/321']).toBe(7.94);
    expect(byName.Teflon).toBe(2.2);
    expect(byName.Platinum).toBe(21.45);
    expect(byName.Molybdenum).toBe(10.28);
  });

  it('ships the APK\'s 11 shapes and unit constants', () => {
    expect(SHAPES).toHaveLength(11);
    expect(SHAPES.map((s) => s.id)).toEqual([
      'roundbar', 'pipe', 'squarebar', 'squaretube', 'flatbar', 'hexagon',
      'sheet', 'angle', 'beam', 'channel', 'tprofile',
    ]);
    expect(UNIT_TO_MM).toMatchObject({ mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, yd: 914.4 });
    expect(KG_TO_LB).toBe(2.204622);
    expect(LBFT_TO_KGM).toBe(1.48816273);
  });

  it('exposes the reference profile tables recovered from the APK', () => {
    const meta = catalog().standardProfiles;
    expect(meta.familyCount).toBe(97);
    expect(meta.profileCount).toBe(2925);
    expect(meta.shapeKeys).toEqual(['angle', 'beam', 'channel']);
  });
});

describe('weight by dimensions (1 metre, unless stated)', () => {
  it('round bar π/4 D² L ρ', () => {
    const r = calc({ shape: 'roundbar', values: { d: 100, L: 1000 }, ...steel });
    expect(r.areaMm2).toBeCloseTo(7853.98, 1);
    expect(r.kgPerMeter).toBeCloseTo(61.654, 3);
    expect(r.pieceWeightKg).toBeCloseTo(61.654, 3);
    expect(r.formula || r.shape.formula).toMatch(/π\/4/);
  });

  it('pipe subtracts the bore', () => {
    const r = calc({ shape: 'pipe', values: { od: 100, t: 5, L: 1000 }, ...steel });
    expect(r.areaMm2).toBeCloseTo(1492.26, 1);
    expect(r.pieceWeightKg).toBeCloseTo(11.714, 3);
  });

  it('square bar, square tube, flat bar', () => {
    expect(calc({ shape: 'squarebar', values: { a: 25, L: 1000 }, ...steel }).pieceWeightKg).toBeCloseTo(4.906, 3);
    expect(calc({ shape: 'squaretube', values: { a: 50, t: 2, L: 1000 }, ...steel }).pieceWeightKg).toBeCloseTo(3.014, 3);
    expect(calc({ shape: 'flatbar', values: { w: 50, t: 6, L: 1000 }, ...steel }).pieceWeightKg).toBeCloseTo(2.355, 3);
  });

  it('hexagon keeps the APK\'s 0.866 constant', () => {
    const r = calc({ shape: 'hexagon', values: { af: 25, L: 1000 }, ...steel });
    expect(r.areaMm2).toBeCloseTo(0.866 * 625, 2);
    expect(r.pieceWeightKg).toBeCloseTo(4.249, 3);
  });

  it('sheet/plate is A × B × t with no separate length', () => {
    const r = calc({ shape: 'sheet', values: { w: 1000, b: 2000, t: 5 }, ...steel });
    expect(r.pieceWeightKg).toBe(78.5);
    expect(r.kgPerMeter).toBeNull();
    expect(r.lengthMm).toBeNull();
  });

  it('angle, beam, channel and T profile use their section formulas', () => {
    expect(calc({ shape: 'angle', values: { a: 50, b: 50, t: 6, L: 1000 }, ...steel }).pieceWeightKg).toBeCloseTo(4.427, 3);

    const beam = calc({ shape: 'beam', values: { h: 200, b: 100, tw: 5.6, tf: 8.5, L: 1000 }, ...steel });
    expect(beam.areaMm2).toBeCloseTo(2724.8, 1);
    expect(beam.pieceWeightKg).toBeCloseTo(21.39, 2);

    const channel = calc({ shape: 'channel', values: { h: 200, b: 75, tw: 5.5, tf: 9, L: 1000 }, ...steel });
    expect(channel.areaMm2).toBeCloseTo(2400.5, 1);
    expect(channel.pieceWeightKg).toBeCloseTo(18.844, 3);

    const tee = calc({ shape: 'tprofile', values: { h: 100, b: 100, tw: 6, tf: 8, L: 1000 }, ...steel });
    expect(tee.areaMm2).toBeCloseTo(1352, 1);
    expect(tee.pieceWeightKg).toBeCloseTo(10.613, 3);
  });

  it('multiplies by pieces', () => {
    const r = calc({ shape: 'roundbar', values: { d: 100, L: 1000 }, pieces: 3, ...steel });
    expect(r.totalWeightKg).toBeCloseTo(184.961, 3);
    expect(r.totalLengthMm).toBe(3000);
  });
});

describe('units', () => {
  it('accepts imperial dimensions (4 in × 1 ft)', () => {
    const r = calculate({
      shape: 'roundbar', unit: 'in', weightUnit: 'lb', mode: 'weight',
      values: { d: 4, L: 12 }, metal: 'Steel',
    });
    expect(r.areaMm2).toBeCloseTo(Math.PI / 4 * 101.6 * 101.6, 1);
    expect(r.pieceWeightKg).toBeCloseTo(19.39, 1);
    expect(r.pieceWeight).toBeCloseTo(42.75, 1);
  });

  it('kg/m ↔ lb/ft uses the APK constant', () => {
    const r = calc({ shape: 'roundbar', values: { d: 100, L: 1000 }, ...steel });
    expect(r.lbPerFoot).toBeCloseTo(61.654 / LBFT_TO_KGM, 2);
  });
});

describe('standard profile tables', () => {
  it('uses the table kg/m instead of recomputing a section', () => {
    const r = calc({
      shape: 'beam', values: { L: 6000 },
      standardProfile: { name: 'IPE 200 - 200x100', kgm: 22.4 },
      ...steel,
    });
    expect(r.kgPerMeter).toBe(22.4);
    expect(r.pieceWeightKg).toBe(134.4);
    expect(r.areaMm2).toBeCloseTo(2853.5, 1); // implied by kg/m at 7.85
  });

  it('separates catalogue families and filters by shape/region/search', () => {
    const beams = profiles({ shape: 'beam' }).families;
    expect(beams.length).toBeGreaterThan(40);
    expect(beams.every((f) => f.shape === 'beam')).toBe(true);

    const india = profiles({ shape: 'beam', region: 'India / IS 808' }).families;
    expect(india.some((f) => f.family === 'ISMB')).toBe(true);

    const hits = profiles({ search: 'IPE 200' }).families;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((f) => f.profiles.every((p) => p.name.toLowerCase().includes('ipe 200')))).toBe(true);
  });
});

describe('by length (weight → length)', () => {
  it('1000 kg of IPE 200 is 44.643 m', () => {
    const r = calculate({
      mode: 'length', shape: 'beam', unit: 'm', weightUnit: 'kg',
      totalWeight: 1000, standardProfile: { name: 'IPE 200', kgm: 22.4 }, metal: 'Steel',
    });
    expect(r.lengthMm).toBeCloseTo(44642.86, 1);
    expect(r.length).toBeCloseTo(44.643, 3);
    expect(r.pieces).toBe(1);
  });

  it('accepts the weight in pounds', () => {
    const r = calculate({
      mode: 'length', shape: 'beam', unit: 'm', weightUnit: 'lb',
      totalWeight: 2204.622, standardProfile: { name: 'IPE 200', kgm: 22.4 }, metal: 'Steel',
    });
    expect(r.totalWeightKg).toBeCloseTo(1000, 3);
    expect(r.length).toBeCloseTo(44.643, 3);
  });
});

describe('price', () => {
  it('rate × total weight, rounded to paise', () => {
    const r = calc({
      shape: 'beam', values: { L: 6000 },
      standardProfile: { name: 'IPE 200', kgm: 22.4 }, rate: 75, ...steel,
    });
    expect(r.totalWeightKg).toBe(134.4);
    expect(r.totalPrice).toBe(10080);
    expect(r.currency).toBe('INR');
  });

  it('prices in pounds when lb is selected', () => {
    const r = calculate({
      shape: 'roundbar', unit: 'mm', weightUnit: 'lb', mode: 'weight',
      values: { d: 100, L: 1000 }, rate: 100, metal: 'Steel',
    });
    expect(r.totalPrice).toBeCloseTo(13592.32, 2); // 61.6538 kg = 135.9232 lb × 100
  });
});

describe('rejects nonsense instead of returning NaN', () => {
  it('requires every dimension', () => {
    expect(() => calc({ shape: 'roundbar', values: { d: 100 }, ...steel })).toThrow(/Length/);
    expect(() => calc({ shape: 'pipe', values: { od: 100, L: 1000 }, ...steel })).toThrow(/Wall Thickness/);
  });

  it('rejects impossible hollow and profile dimensions', () => {
    expect(() => calc({ shape: 'pipe', values: { od: 20, t: 11, L: 100 }, ...steel })).toThrow(/Wall thickness/);
    expect(() => calc({ mode: 'length', shape: 'squaretube', totalWeight: 10, values: { a: 20, t: 10 }, ...steel })).toThrow(/Wall thickness/);
    expect(() => calc({ shape: 'angle', values: { a: 10, b: 20, t: 10, L: 100 }, ...steel })).toThrow(/Thickness/);
    expect(() => calc({ shape: 'beam', values: { h: 20, b: 20, tw: 2, tf: 11, L: 100 }, ...steel })).toThrow(/thickness/);
  });

  it('refuses length mode for a plate', () => {
    expect(() => calc({ mode: 'length', shape: 'sheet', totalWeight: 10, values: {}, ...steel }))
      .toThrow(/no length dimension/);
  });

  it('refuses a profile table on a round bar', () => {
    expect(() => calc({
      shape: 'roundbar', values: { d: 10, L: 1000 },
      standardProfile: { name: 'IPE 80', kgm: 6 }, ...steel,
    })).toThrow(/only available for angle, beam and channel/);
  });

  it('validates metal, density and rate', () => {
    expect(() => calc({ shape: 'roundbar', values: { d: 10, L: 1000 }, metal: 'Unobtanium' })).toThrow(/Unknown metal/);
    expect(() => calc({ shape: 'roundbar', values: { d: 10, L: 1000 }, metal: 'Steel', density: 0 })).toThrow(/Density/);
    expect(() => calc({ shape: 'roundbar', values: { d: 10, L: 1000 }, rate: -1, ...steel })).toThrow(/Rate/);
  });
});
