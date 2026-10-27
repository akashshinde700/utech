import { describe, expect, it } from 'vitest';
import { trackedQuantity } from '../../src/lib/quantityValidation';

describe('customer material quantity validation', () => {
  it('accepts valid three-place quantities and optional blank weights', () => {
    expect(trackedQuantity('1.234')).toBeNull();
    expect(trackedQuantity('', 'Weight', { optional: true })).toBeNull();
  });
  it('explains values that cannot fit the stock columns', () => {
    expect(trackedQuantity('0.0001')).toMatch(/3 decimal places/);
    expect(trackedQuantity('100000000000')).toMatch(/limit/);
    expect(trackedQuantity('-1')).toMatch(/greater than 0/);
  });
});
