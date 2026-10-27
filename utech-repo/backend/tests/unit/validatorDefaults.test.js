'use strict';

// AUD-212 — Zod v4 regression guard.
//
// `.partial()` no longer "protects" a field from its own `.default()`: the
// default is produced even when the client never sent the key. Every update
// endpoint treats an absent key as "leave the stored value alone", so the
// upgrade silently rewrote rows — most dangerously `operations: []`, which the
// jobcard update reads as "replace all" and which deleted every Task Progress
// item on the card (AUD-201).
//
// `partialNoDefaults()` in validators/partial.js strips defaults before making
// the object partial. These tests pin the contract for both directions:
// updates must not invent keys, creates must still apply their defaults.

import { describe, it, expect } from 'vitest';

const { updateJobcardSchema, createJobcardSchema } = require('../../src/validators/jobcard.schema');
const { updateInvoiceSchema, createInvoiceSchema } = require('../../src/validators/invoice.schema');
const { updateItemSchema } = require('../../src/validators/item.schema');
const { partialNoDefaults } = require('../../src/validators/partial');
const { z } = require('zod');

describe('AUD-212 — update schemas never re-inject defaults', () => {
  it('an empty jobcard edit stays empty (no lines, no operations)', () => {
    const parsed = updateJobcardSchema.parse({});
    expect(parsed).toEqual({});
    expect(parsed).not.toHaveProperty('operations');
    expect(parsed).not.toHaveProperty('lines');
    expect(parsed).not.toHaveProperty('qtyOrdered');
  });

  it('an empty invoice edit stays empty (no isIntraState/discount flip)', () => {
    expect(updateInvoiceSchema.parse({})).toEqual({});
  });

  it('an empty item edit stays empty', () => {
    expect(updateItemSchema.parse({})).toEqual({});
  });

  it('still validates the fields that ARE sent', () => {
    expect(updateJobcardSchema.safeParse({ qtyProduced: -1 }).success).toBe(false);
    expect(updateJobcardSchema.parse({ remarks: 'hi' })).toEqual({ remarks: 'hi' });
  });

  it('create payloads keep their defaults', () => {
    const created = createJobcardSchema.parse({ date: '2026-03-01' });
    expect(created.operations).toEqual([]);
    expect(created.lines).toEqual([]);
    expect(created.qtyOrdered).toBe(0);

    const invoice = createInvoiceSchema.parse({
      date: '2026-03-01', partyId: 2, lines: [{ itemId: 5, description: 'x', qty: 2, rate: 100 }],
    });
    expect(invoice.isIntraState).toBe(true);
    expect(invoice.discount).toBe(0);
  });

  it('partialNoDefaults strips nested defaults declared on the field only', () => {
    const schema = partialNoDefaults(z.object({
      count: z.number().default(7),
      note: z.string().optional(),
    }));
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ count: 0 })).toEqual({ count: 0 });
  });
});
