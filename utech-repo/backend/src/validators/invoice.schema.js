'use strict';
const { z } = require('zod');

const lineSchema = z.object({
  itemId: z.number().int().optional().nullable(),
  description: z.string().min(1),
  hsnCode: z.string().optional().nullable(),
  qty: z.number().positive(),
  rate: z.number().nonnegative(),
  gstRate: z.number().min(0).max(100).default(18),
});

const baseInvoice = {
  date: z.coerce.date(),
  dueDate: z.coerce.date().optional().nullable(),
  partyId: z.number().int(),
  quotationId: z.number().int().optional().nullable(),
  isIntraState: z.boolean().default(true),
  discount: z.number().nonnegative().default(0),
  notes: z.string().optional().nullable(),
  termsText: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1),
};

const createInvoiceSchema = z.object(baseInvoice);
const updateInvoiceSchema = z.object({ ...baseInvoice }).partial();

const paymentSchema = z.object({
  date: z.coerce.date(),
  amount: z.number().positive(),
  mode: z.enum(['CASH', 'BANK', 'UPI', 'CHEQUE']).default('CASH'),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

module.exports = { createInvoiceSchema, updateInvoiceSchema, paymentSchema };
