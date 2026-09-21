'use strict';
const { z } = require('zod');

const lineSchema = z.object({
  itemId: z.number().int().positive(),
  description: z.string().min(1),
  qtyOrdered: z.number().positive(),
  qtyFulfilled: z.number().nonnegative().optional(),
  rate: z.number().nonnegative(),
  notes: z.string().optional().nullable(),
});

// create spreads the rest of the body into prisma.backOrder.create, so the
// schema is what keeps status/number/qty rollups out of a client's reach
const createBackOrderSchema = z.object({
  date: z.coerce.date(),
  invoiceId: z.number().int().positive().optional().nullable(),
  partyId: z.number().int().positive().optional().nullable(),
  expectedDate: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1),
});

const updateBackOrderSchema = z.object({
  date: z.coerce.date().optional(),
  expectedDate: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1).optional(),
});

// matches the fulfill handler body: { lineId, qty } — qty drives the
// fulfilled rollup, so it must be a real positive number
const fulfillBackOrderSchema = z.object({
  lineId: z.number().int().positive(),
  qty: z.number().positive(),
});

module.exports = { createBackOrderSchema, updateBackOrderSchema, fulfillBackOrderSchema };
