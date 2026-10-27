'use strict';
const { z } = require('zod');

// Sales-return payloads. Until this file existed the routes imported
// `validate` but never called it, so the body reached the controller untouched:
// a missing `lines` key threw "lines is not iterable" (HTTP 500) and a
// non-numeric qty flowed into calcLineAmount and was written as NaN.

const lineSchema = z.object({
  invoiceLineId: z.number().int(),
  itemId: z.number().int().optional().nullable(),
  description: z.string().min(1),
  hsnCode: z.string().optional().nullable(),
  qty: z.number().positive(),
  rate: z.number().nonnegative(),
  gstRate: z.number().min(0).max(100).default(18),
  reason: z.string().optional().nullable(),
});

const createSalesReturnSchema = z.object({
  invoiceId: z.number().int(),
  date: z.coerce.date(),
  reason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  discount: z.number().nonnegative().default(0),
  isIntraState: z.boolean().optional(),
  lines: z.array(lineSchema).min(1),
});

// header fields are the only thing an edit may change besides the lines; the
// controller ignores anything else (invoiceId included) by design
const updateSalesReturnSchema = z.object({
  invoiceId: z.number().int().optional().nullable(),
  date: z.coerce.date().optional(),
  reason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  discount: z.number().nonnegative().optional(),
  isIntraState: z.boolean().optional(),
  lines: z.array(lineSchema).min(1).optional(),
});

// Physical-return proof. Stock is only restored (process) once these are
// recorded, because the return document itself proves a commercial claim, not
// the movement of goods.
const receiptShape = {
  returnChallanNo: z.string().trim().min(3).max(60),
  receivedAt: z.coerce.date(),
  dispatchChallanId: z.number().int().positive().nullable().optional(),
};

const recordReceiptSchema = z.object(receiptShape);

// Processing accepts the proof inline for API clients that never called the
// receipt endpoint; every field is optional here because the stored values are
// the normal source.
const processSalesReturnSchema = z.object({
  returnChallanNo: receiptShape.returnChallanNo.optional(),
  receivedAt: receiptShape.receivedAt.optional(),
  dispatchChallanId: receiptShape.dispatchChallanId,
});

module.exports = {
  createSalesReturnSchema, updateSalesReturnSchema, recordReceiptSchema, processSalesReturnSchema,
};
