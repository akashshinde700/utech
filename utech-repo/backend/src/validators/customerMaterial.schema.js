'use strict';
const { z } = require('zod');

const createLotSchema = z.object({
  customerId: z.number().int(),
  jobcardId: z.number().int().optional().nullable(),
  itemId: z.number().int().optional().nullable(),
  materialDescription: z.string().min(1),
  heatNumber: z.string().optional().nullable(),
  lotNumber: z.string().optional().nullable(),
  qty: z.number().positive(),
  weight: z.number().nonnegative().optional().nullable(),
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
  weight: z.number().nonnegative().optional().nullable(),
  uomCode: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const dispositionSchema = z.object({
  qty: z.number().positive(),
  notes: z.string().optional().nullable(),
});

module.exports = { createLotSchema, updateLotSchema, dispositionSchema };
