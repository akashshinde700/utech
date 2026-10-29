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

  it('honours an explicit calculator shape even when the item name conflicts', () => {
    expect(shapeFromSize('Round bar: OD 60 mm X 5000 mm', 'Pipe').shape).toBe('roundbar');
    expect(shapeFromSize('Pipe: OD 60 mm X ID 50 mm X 5000 mm', 'Flange').shape).toBe('pipe');
    expect(shapeFromSize('Sheet: 1500 mm X 3000 mm X 12 mm', 'Pipe').shape).toBe('sheet');
    expect(weightForItem({ size: 'Hex: 38 mm X 5000 mm', name: 'Plate', metal: 'Steel' })).not.toBeNull();
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

  it('reads calculator dimensions for every shape and matches the calculator', () => {
    const { SHAPES } = require('../../src/services/metalCalculator');
    const samples = {
      roundbar: [10, 100], pipe: [20, 2, 100], squarebar: [10, 100],
      squaretube: [20, 2, 100], flatbar: [20, 2, 100], hexagon: [10, 100],
      sheet: [20, 100, 2], angle: [20, 20, 2, 100],
      beam: [20, 20, 2, 2, 100], channel: [20, 20, 2, 2, 100],
      tprofile: [20, 20, 2, 2, 100],
    };
    for (const shape of SHAPES) {
      const dimensions = samples[shape.id];
      const size = `Calculator ${shape.id}: ${dimensions.map((n) => `${n} cm`).join(' X ')}`;
      const item = weightForItem({ size, name: 'Pipe', metal: 'Steel' });
      const values = Object.fromEntries(shape.fields.map((f, i) => [f.id, dimensions[i]]));
      expect(item?.kg).toBe(calculate({ shape: shape.id, metal: 'Steel', unit: 'cm', weightUnit: 'kg', pieces: 1, values }).pieceWeightKg);
    }
    expect(shapeFromSize('Calculator pipe: 20 mm X 2 mm', '')).toBeNull();
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

describe('the shape travels beside the size, not inside it', () => {
  // "Calculator pipe: 145 mm X 25 mm X 145 mm" used to be the stored size, so
  // machine bookkeeping sat in a field people read on screen, on exports and on
  // printed documents. The shape moved to Item.shape and the text is now only
  // the dimensions -- but the shape still decides what the numbers MEAN.
  it("reads the dimensions in the shape's own field order", () => {
    expect(shapeFromSize('145 mm X 25 mm X 145 mm', 'Pipe probe', 'pipe'))
      .toMatchObject({ shape: 'pipe', values: { od: 145, t: 25, L: 145 } });
    expect(shapeFromSize('100 mm X 1000 mm', '', 'roundbar'))
      .toMatchObject({ shape: 'roundbar', values: { d: 100, L: 1000 } });
  });

  it('gives the same weight as the prefixed form it replaced', () => {
    const now = weightForItem({ size: '145 mm X 25 mm X 145 mm', name: 'p', metal: 'Steel', shape: 'pipe' });
    const before = weightForItem({ size: 'Calculator pipe: 145 mm X 25 mm X 145 mm', name: 'p', metal: 'Steel' });
    expect(now.kg).toBe(10.728);
    expect(before.kg).toBe(now.kg); // a size kept outside the database still reads
  });

  it('the shape is what separates two readings of the same digits', () => {
    // as a pipe from the calculator: outer diameter, WALL, length
    const asCalculated = weightForItem({ size: '60 mm X 5 mm X 1000 mm', name: 'x', metal: 'Steel', shape: 'pipe' });
    // the same numbers as the stock sheet writes them: outer, INNER, length
    const asWritten = weightForItem({ size: 'OD 60 X ID 5 X 1000 MM', name: 'Pipe', metal: 'Steel' });
    expect(asCalculated.kg).not.toBe(asWritten.kg);
  });

  it('without a shape the text is read by its wording, as the register has always been', () => {
    expect(shapeFromSize('OD 60.3 X ID 54 X 6 MTR', 'Pipe'))
      .toMatchObject({ shape: 'pipe', values: { od: 60.3, t: 3.15, L: 6000 } });
    // bare dimensions and no shape say nothing about what they are
    expect(shapeFromSize('145 mm X 25 mm X 145 mm', '')).toBeNull();
  });

  it('refuses a size that does not fill the shape it claims', () => {
    expect(shapeFromSize('100 mm', '', 'roundbar')).toBeNull();            // too few
    expect(shapeFromSize('100 mm X 50 mm X 10 mm', '', 'roundbar')).toBeNull(); // too many
    expect(shapeFromSize('100 X 1000', '', 'roundbar')).toBeNull();        // no units
    expect(shapeFromSize('100 mm X 0 mm', '', 'roundbar')).toBeNull();     // a zero dimension
    expect(shapeFromSize('100 mm X 1000 mm', '', 'unobtanium')).toBeNull();
  });

  it('accepts the units the calculator can emit', () => {
    expect(shapeFromSize('10 cm X 1 m', '', 'roundbar'))
      .toMatchObject({ values: { d: 100, L: 1000 } });
    expect(shapeFromSize('4 in X 1 ft', '', 'roundbar'))
      .toMatchObject({ values: { d: 101.6, L: 304.8 } });
  });
});
