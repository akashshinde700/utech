'use strict';
const { z } = require('zod');
const { quantity } = require('./precision');

// Inward qty/weight and stock movements are persisted as DECIMAL(14,3).

const createLotSchema = z.object({
  customerId: z.number().int(),
  jobcardId: z.number().int().optional().nullable(),
  itemId: z.number().int().optional().nullable(),
  materialDescription: z.string().min(1),
  heatNumber: z.string().optional().nullable(),
  lotNumber: z.string().optional().nullable(),
  qty: quantity(z.number().positive()),
  weight: quantity(z.number().nonnegative()).optional().nullable(),
  uomCode: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  receivedDate: z.coerce.date(),
  notes: z.string().optional().nullable(),
});

const updateLotSchema = z.object({
  jobcardId: z.number().int().optional().nullable(),
  itemId: z.number().int().optional().nullable(),
  materialDescription: z.string().min(1).optional(),
  heatNumber: z.string().optional().nullable(),
  lotNumber: z.string().optional().nullable(),
  weight: quantity(z.number().nonnegative()).optional().nullable(),
  uomCode: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const dispositionSchema = z.object({
  qty: quantity(z.number().positive()),
  weight: quantity(z.number().nonnegative()).optional(), // measured outgoing weight
  notes: z.string().optional().nullable(),
});

const allocationSchema = z.object({
  jobcardId: z.number().int().positive(),
  qty: quantity(z.number().positive()),
  weight: quantity(z.number().positive()),
});
const releaseAllocationSchema = z.object({ reason: z.string().trim().min(3).max(191) });
const reconcileWeightSchema = z.object({
  weight: quantity(z.number().nonnegative()),
  reason: z.string().trim().min(3).max(191),
});

module.exports = { createLotSchema, updateLotSchema, dispositionSchema, allocationSchema, releaseAllocationSchema, reconcileWeightSchema };
