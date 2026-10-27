import { describe, it, expect } from 'vitest';
const { shapeFromSize, weightForItem, parseDimensions } = require('../../src/utils/materialWeight');
const { calculate } = require('../../src/services/metalCalculator');

// An item's weight is read off its free-text size and then weighed by the
// metal calculator — the same engine the calculator page uses, so the two can
// never give different answers for the same material.

describe('reading the register size', () => {
  it('converts the units the register mixes', () => {
    expect(parseDimensions('OD 60 X 5 mtr.').map((d) => d.mm)).toEqual([60, 5000]);
    expect(parseDimensions("8' X 4' X 3 MM").map((d) => d.mm)).toEqual([2438.4, 1219.2, 3]);
    expect(parseDimensions('OD 50 X 1700 MM').map((d) => d.mm)).toEqual([50, 1700]);
  });

  it('recognises each family the sheets contain', () => {
    expect(shapeFromSize('OD 60 X 5 mtr.', 'Round Bar').shape).toBe('roundbar');
    expect(shapeFromSize('Hex 38 X 8 mtr.', 'Hex').shape).toBe('hexagon');
    expect(shapeFromSize('1500 x 3000 x 12 th', 'Plate').shape).toBe('sheet');
    expect(shapeFromSize('OD 60.3 X ID 54 X 6 MTR', 'Pipe').shape).toBe('pipe');
  });

  it('weighs a flange as a disc, and a bored flange as a ring', () => {
    expect(shapeFromSize('OD 183 X 25 TH', 'Flange')).toMatchObject({ shape: 'roundbar', values: { d: 183, L: 25 } });
    expect(shapeFromSize('OD 340 x ID 85 X 14 TH', 'Flange')).toMatchObject({ shape: 'pipe', values: { od: 340, t: 127.5, L: 14 } });
  });

  it('turns a pipe OD/ID into the wall thickness the engine wants', () => {
    expect(shapeFromSize('OD 60.3 X ID 54 X 6 MTR', 'Pipe').values).toEqual({ od: 60.3, t: 3.15, L: 6000 });
  });

  it('refuses a size it cannot read', () => {
    expect(shapeFromSize('', 'Plate')).toBeNull();
    expect(shapeFromSize('as per drawing', 'Plate')).toBeNull();
    expect(shapeFromSize('1500 x 3000', 'Plate')).toBeNull(); // thickness missing
  });
});

describe('weighing the item', () => {
  it('matches the metal calculator exactly', () => {
    const viaItem = weightForItem({ size: 'OD 60 X 5 mtr.', name: 'Round Bar', metal: 'SS 304/310' });
    const viaCalculator = calculate({
      shape: 'roundbar', metal: 'SS 304/310', unit: 'mm', weightUnit: 'kg', pieces: 1,
      values: { d: 60, L: 5000 },
    });
    expect(viaItem.kg).toBe(viaCalculator.pieceWeightKg);
  });

  it('weighs the same size differently for different metals', () => {
    const ss = weightForItem({ size: '1500 x 3000 x 12 th', name: 'Plate', metal: 'SS 304/310' }).kg;
    const ms = weightForItem({ size: '1500 x 3000 x 12 th', name: 'Plate', metal: 'Steel' }).kg;
    expect(ss).toBeGreaterThan(ms); // 7.92 vs 7.85 g/cm³
  });

  it('has no weight until the metal is known', () => {
    expect(weightForItem({ size: 'OD 60 X 5 mtr.', name: 'Round Bar', metal: null })).toBeNull();
    expect(weightForItem({ size: 'OD 60 X 5 mtr.', name: 'Round Bar', metal: 'Unobtainium' })).toBeNull();
  });

  it('has no weight when the size cannot be read', () => {
    expect(weightForItem({ size: 'as per drawing', name: 'Plate', metal: 'Steel' })).toBeNull();
  });
});
