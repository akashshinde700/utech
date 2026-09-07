'use strict';
const { z } = require('zod');

const stockAdjustSchema = z.object({
  itemId: z.number().int(),
  qty: z.number().refine((n) => n !== 0, 'qty must be non-zero'),
  notes: z.string().optional().nullable(),
});

module.exports = { stockAdjustSchema };
