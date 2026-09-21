'use strict';
const { z } = require('zod');

// matches the completeBatch handler body: { qtyProduced, qtyRejected? } —
// unvalidated quantities used to allow NaN/negative stock movements
const completeBatchSchema = z.object({
  qtyProduced: z.number().nonnegative(),
  qtyRejected: z.number().nonnegative().optional(),
});

const materialSchema = z.object({
  itemId: z.number().int().positive(),
  qtyPlanned: z.number().nonnegative(),
  qtyConsumed: z.number().nonnegative().optional(),
  uomCode: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// createBatch spreads the rest of the body into prisma.productionBatch.create.
// Without this, a client could create a batch that already carries
// qtyProduced/qtyRejected/startTime/endTime — finished goods on paper that
// never moved through the stock ledger.
const createBatchSchema = z.object({
  date: z.coerce.date(),
  shiftId: z.number().int().positive(),
  itemId: z.number().int().positive(),
  jobcardId: z.number().int().positive().optional().nullable(),
  bomId: z.number().int().positive().optional().nullable(),
  machineId: z.number().int().positive().optional().nullable(),
  qtyPlanned: z.number().nonnegative().default(0),
  notes: z.string().optional().nullable(),
  materialConsumptions: z.array(materialSchema).default([]),
});

const updateBatchSchema = z.object({
  date: z.coerce.date().optional(),
  shiftId: z.number().int().positive().optional(),
  itemId: z.number().int().positive().optional(),
  jobcardId: z.number().int().positive().optional().nullable(),
  bomId: z.number().int().positive().optional().nullable(),
  machineId: z.number().int().positive().optional().nullable(),
  qtyPlanned: z.number().nonnegative().optional(),
  notes: z.string().optional().nullable(),
  materialConsumptions: z.array(materialSchema).optional(),
});

// qtyConsumed becomes a stock-out at completion — it must be a real number
const updateMaterialConsumptionSchema = z.object({
  materialId: z.number().int().positive(),
  qtyConsumed: z.number().nonnegative(),
});

const shiftSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  startTime: z.string().optional().nullable(),
  endTime: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});
const updateShiftSchema = shiftSchema.omit({ code: true }).partial();

module.exports = {
  completeBatchSchema, createBatchSchema, updateBatchSchema,
  updateMaterialConsumptionSchema, shiftSchema, updateShiftSchema,
};
