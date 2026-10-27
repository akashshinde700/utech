'use strict';
import { describe, expect, it } from 'vitest';
const { createGrnSchema } = require('../../src/validators/purchase.schema');
const { createVendorWorkOrderSchema, receiveVendorWorkOrderSchema } = require('../../src/validators/vendorWorkOrder.schema');

const grn = (line) => ({ date: '2026-10-01', lines: [{ description: 'Part', qty: 0.3, qtyAccepted: 0.1, qtyRejected: 0.2, ...line }] });
describe('vendor quantity precision', () => {
  it('accepts exact three-place GRN splits without binary floating-point rejection', () => {
    expect(createGrnSchema.safeParse(grn({})).success).toBe(true);
  });
  it('rejects GRN quantities the decimal stock columns cannot represent', () => {
    expect(createGrnSchema.safeParse(grn({ qty: 0.3001, qtyAccepted: 0.3, qtyRejected: 0 })).success).toBe(false);
  });
  it('rejects vendor-work-order issue and return quantities beyond three places', () => {
    expect(createVendorWorkOrderSchema.safeParse({ partyId: 1, lines: [{ description: 'Part', qtySent: 0.0001 }] }).success).toBe(false);
    expect(receiveVendorWorkOrderSchema.safeParse({ lines: [{ id: 1, qtyReceived: 0.0001 }] }).success).toBe(false);
  });
});
