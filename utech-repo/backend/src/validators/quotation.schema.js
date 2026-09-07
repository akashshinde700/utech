'use strict';
const { z } = require('zod');

// Quotations are quoted without GST — a line is just description + qty + rate.
const lineSchema = z.object({
  itemId: z.number().int().optional().nullable(),
  description: z.string().min(1),
  drgNo: z.string().optional().nullable(),
  qty: z.number().positive(),
  rate: z.number().nonnegative(),
  amount: z.number().optional(), // recomputed server-side; accepted but ignored
});

const base = {
  partyId: z.number().int(),
  date: z.coerce.date(),
  // the form sends '' when cleared
  validUntil: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.coerce.date().optional()
  ),
  isIntraState: z.boolean().optional(),
  discount: z.number().nonnegative().optional(),
  notes: z.string().optional().nullable(),
  headerText: z.string().optional().nullable(),
  footerText: z.string().optional().nullable(),
  headerImageName: z.string().optional().nullable(),
  headerImageStoredName: z.string().optional().nullable(),
  footerImageName: z.string().optional().nullable(),
  footerImageStoredName: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1),
};

const createQuotationSchema = z.object(base);
const updateQuotationSchema = z.object(base).partial();

module.exports = { createQuotationSchema, updateQuotationSchema };
