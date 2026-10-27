'use strict';
import { describe, expect, it } from 'vitest';
const { createLotSchema, updateLotSchema, dispositionSchema } = require('../../src/validators/customerMaterial.schema');

const valid = { customerId: 1, materialDescription: 'Customer material', qty: 1, receivedDate: '2026-10-01' };

describe('customer material quantities match DECIMAL(14,3)', () => {
  it('accepts representable quantities and original weight', () => {
    expect(createLotSchema.safeParse({ ...valid, qty: 0.001, weight: 1.234 }).success).toBe(true);
  });
  it.each([
    ['inward quantity', createLotSchema, { ...valid, qty: 0.0001 }],
    ['inward weight', createLotSchema, { ...valid, weight: 0.0001 }],
    ['updated weight', updateLotSchema, { weight: 1.2345 }],
    ['disposition quantity', dispositionSchema, { qty: 0.0001 }],
    ['out-of-range quantity', createLotSchema, { ...valid, qty: 100000000000 }],
  ])('rejects an unrepresentable %s', (_label, schema, payload) => {
    expect(schema.safeParse(payload).success).toBe(false);
  });
});
