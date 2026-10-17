'use strict';
const { z } = require('zod');

// Purchase-return payloads — same gap as salesReturn.schema.js: the routes
// imported `validate` without calling it, so an unvalidated body reached the
// controller and a non-numeric qty became NaN in the money columns.

const lineSchema = z.object({
  grnLineId: z.number().int(),
  itemId: z.number().int().optional().nullable(),
  description: z.string().min(1),
  qty: z.number().positive(),
  rate: z.number().nonnegative(),
  gstRate: z.number().min(0).max(100).default(18),
  reason: z.string().optional().nullable(),
});

// a return has to be anchored to a GRN or a PO; the controller enforces that
// too, and says so in its own words
const createPurchaseReturnSchema = z.object({
  grnId: z.number().int().optional().nullable(),
  poId: z.number().int().optional().nullable(),
  partyId: z.number().int().optional().nullable(),
  date: z.coerce.date(),
  reason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  creditNoteNo: z.string().optional().nullable(),
  isIntraState: z.boolean().optional(),
  lines: z.array(lineSchema).min(1),
});

const updatePurchaseReturnSchema = z.object({
  grnId: z.number().int().optional().nullable(),
  poId: z.number().int().optional().nullable(),
  partyId: z.number().int().optional().nullable(),
  date: z.coerce.date().optional(),
  reason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  creditNoteNo: z.string().optional().nullable(),
  isIntraState: z.boolean().optional(),
  lines: z.array(lineSchema).min(1).optional(),
});

module.exports = { createPurchaseReturnSchema, updatePurchaseReturnSchema };
