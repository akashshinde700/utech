'use strict';
const { z } = require('zod');

const bomItemSchema = z.object({
  itemId: z.number().int().positive(),
  qty: z.number().positive(),
  uomCode: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const createBomSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(2),
  finishedItemId: z.number().int().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(bomItemSchema).min(1),
});

// `code` is the BOM's identity — locked after creation, like every other
// master in this app (item/party/machine/process)
const updateBomSchema = createBomSchema.omit({ code: true }).partial();

module.exports = { createBomSchema, updateBomSchema };
