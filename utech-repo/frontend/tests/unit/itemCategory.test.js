import { describe, it, expect } from 'vitest';
import { categoryIdForShape, categoryNameById } from '../../src/lib/itemCategory';

// The categories this plant keeps are the shapes it buys, so the shape someone
// picks in the material size calculator already answers "what kind of material
// is this". Filling it keeps the classification consistent enough for the Items
// filter and the stock reports to group by — but only ever when the field is
// empty, and only ever with a category that exists here.

const LIVE = [
  { id: 1, name: 'Flange' }, { id: 2, name: 'Hardware' }, { id: 3, name: 'Pipe' },
  { id: 4, name: 'Plastic' }, { id: 5, name: 'Plate' }, { id: 6, name: 'Round Bar & Hex' },
  { id: 7, name: 'Service' }, { id: 8, name: 'Steel' },
];

describe('choosing a category from the calculated shape', () => {
  it('maps the shapes this plant has a category for', () => {
    expect(categoryIdForShape('roundbar', LIVE)).toBe(6);
    expect(categoryIdForShape('hexagon', LIVE)).toBe(6);
    expect(categoryIdForShape('pipe', LIVE)).toBe(3);
    expect(categoryIdForShape('sheet', LIVE)).toBe(5);
  });

  it('leaves alone the shapes that have no obvious home', () => {
    // a square tube is not a pipe to a storekeeper, and a beam is not a plate;
    // guessing would file stock in the wrong place
    for (const shape of ['squaretube', 'squarebar', 'flatbar', 'angle', 'beam', 'channel', 'tprofile']) {
      expect(categoryIdForShape(shape, LIVE)).toBeNull();
    }
  });

  it('picks nothing when this site has no such category', () => {
    expect(categoryIdForShape('pipe', [{ id: 1, name: 'Consumables' }])).toBeNull();
    expect(categoryIdForShape('roundbar', [])).toBeNull();
    expect(categoryIdForShape('roundbar')).toBeNull();
  });

  it('matches a category however it is capitalised or spaced', () => {
    expect(categoryIdForShape('pipe', [{ id: 9, name: '  pipe  ' }])).toBe(9);
    expect(categoryIdForShape('sheet', [{ id: 9, name: 'PLATE' }])).toBe(9);
  });

  it('falls back through the alternatives in order', () => {
    // a site that files round bar under plain "Round Bar"
    expect(categoryIdForShape('roundbar', [{ id: 2, name: 'Round Bar' }])).toBe(2);
    // and one that keeps both: the combined name wins, as the live site has it
    expect(categoryIdForShape('roundbar', [{ id: 2, name: 'Round Bar' }, { id: 3, name: 'Round Bar & Hex' }])).toBe(3);
  });

  it('is not confused by an unknown or empty shape', () => {
    expect(categoryIdForShape('', LIVE)).toBeNull();
    expect(categoryIdForShape(null, LIVE)).toBeNull();
    expect(categoryIdForShape('unobtanium', LIVE)).toBeNull();
  });

  it('names a category for showing back', () => {
    expect(categoryNameById(6, LIVE)).toBe('Round Bar & Hex');
    expect(categoryNameById('6', LIVE)).toBe('Round Bar & Hex');
    expect(categoryNameById(99, LIVE)).toBeNull();
    expect(categoryNameById(null, LIVE)).toBeNull();
  });
});
