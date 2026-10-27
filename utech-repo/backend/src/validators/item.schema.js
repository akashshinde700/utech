'use strict';
const { z } = require('zod');
const { partialNoDefaults } = require('./partial');

const itemBase = {
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  type: z.enum(['RAW_MATERIAL', 'SEMI_FINISHED', 'FINISHED', 'CONSUMABLE', 'SERVICE']).default('RAW_MATERIAL'),
  size: z.string().max(191).optional().nullable(),
  // weightKg is derived from the size server-side and is not accepted here
  ratePerKg: z.number().nonnegative().optional().nullable(),
  hsnCode: z.string().optional().nullable(),
  projectNumber: z.string().optional().nullable(),
  projectId: z.number().int().optional().nullable(),
  purchaseRate: z.number().nonnegative().optional().nullable(),
  saleRate: z.number().nonnegative().optional().nullable(),
  gstRate: z.number().min(0).max(100).optional().nullable(),
  openingStock: z.number().nonnegative().refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-7, 'Use at most three decimal places').optional().nullable(),
  minStock: z.number().nonnegative().optional().nullable(),
  uomId: z.number().int().optional().nullable(),
  categoryId: z.number().int().optional().nullable(),
  isActive: z.boolean().optional(),
};

const createItemSchema = z.object(itemBase);
const updateItemSchema = partialNoDefaults(z.object(itemBase));

module.exports = { createItemSchema, updateItemSchema };
