'use strict';
const { z } = require('zod');

// a line is either a catalog item or a free-text/drawing-identified part — the
// whole point of the module is that outsourced parts often aren't in the Item
// master yet
const lineSchema = z
  .object({
    itemId: z.coerce.number().int().positive().nullable().optional(),
    description: z.string().trim().min(1).nullable().optional(),
    drawingNumber: z.string().trim().nullable().optional(),
    partNumber: z.string().trim().nullable().optional(),
    qtySent: z.coerce.number().positive(),
    uomCode: z.string().trim().nullable().optional(),
    rate: z.coerce.number().nonnegative().nullable().optional(),
    gstRate: z.coerce.number().min(0).max(100).optional(),
    notes: z.string().trim().nullable().optional(),
  })
  .refine((l) => l.itemId != null || !!l.description, {
    message: 'Every line needs either a catalog item or a description',
  });

const baseSchema = z.object({
  partyId: z.coerce.number().int().positive(),
  assignmentId: z.coerce.number().int().positive().nullable().optional(),
  jobcardId: z.coerce.number().int().positive().nullable().optional(),
  departmentId: z.coerce.number().int().positive().nullable().optional(),
  date: z.coerce.date().optional(),
  expectedReturnDate: z.coerce.date().nullable().optional(),
  scopeDescription: z.string().trim().nullable().optional(),
  instructions: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  lines: z.array(lineSchema).min(1),
});

const createVendorWorkOrderSchema = baseSchema;
const updateVendorWorkOrderSchema = baseSchema.partial();

// material physically issued to the vendor must be catalog stock — you can only
// issue what the company actually tracks a quantity for
const materialLineSchema = z.object({
  itemId: z.coerce.number().int().positive(),
  qtySent: z.coerce.number().positive(),
  processId: z.coerce.number().int().positive().nullable().optional(),
  rate: z.coerce.number().nonnegative().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

const sendVendorWorkOrderSchema = z.object({
  sentDate: z.coerce.date().optional(),
  expectedReturnDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  materialLines: z.array(materialLineSchema).optional(),
});

const receiveVendorWorkOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        id: z.coerce.number().int().positive(),
        qtyReceived: z.coerce.number().nonnegative().optional(),
        qtyRejected: z.coerce.number().nonnegative().optional(),
      })
    )
    .min(1),
  remarks: z.string().trim().nullable().optional(),
});

const raisePurchaseOrderSchema = z.object({
  date: z.coerce.date().optional(),
  expectedDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

const closeVendorWorkOrderSchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required'),
});

module.exports = {
  createVendorWorkOrderSchema,
  updateVendorWorkOrderSchema,
  sendVendorWorkOrderSchema,
  receiveVendorWorkOrderSchema,
  raisePurchaseOrderSchema,
  closeVendorWorkOrderSchema,
};
