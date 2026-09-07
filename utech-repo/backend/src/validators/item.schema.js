'use strict';
const { z } = require('zod');

const itemBase = {
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  type: z.enum(['RAW_MATERIAL', 'SEMI_FINISHED', 'FINISHED', 'CONSUMABLE', 'SERVICE']).default('RAW_MATERIAL'),
  hsnCode: z.string().optional().nullable(),
  projectNumber: z.string().optional().nullable(),
  projectId: z.number().int().optional().nullable(),
  purchaseRate: z.number().nonnegative().optional().nullable(),
  saleRate: z.number().nonnegative().optional().nullable(),
  gstRate: z.number().min(0).max(100).optional().nullable(),
  openingStock: z.number().optional().nullable(),
  minStock: z.number().nonnegative().optional().nullable(),
  uomId: z.number().int().optional().nullable(),
  categoryId: z.number().int().optional().nullable(),
  isActive: z.boolean().optional(),
};

const createItemSchema = z.object(itemBase);
const updateItemSchema = z.object(itemBase).partial();

module.exports = { createItemSchema, updateItemSchema };
