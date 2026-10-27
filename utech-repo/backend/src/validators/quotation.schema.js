'use strict';
const { z } = require('zod');
const { partialNoDefaults } = require('./partial');
const { quantity, money } = require('./precision');

// Quotations are quoted without GST — a line is just description + qty + rate.
const lineSchema = z.object({
  itemId: z.number().int().optional().nullable(),
  description: z.string().min(1),
  drgNo: z.string().optional().nullable(),
  qty: quantity(z.number().positive()),
  rate: money(z.number().nonnegative()),
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
  discount: money(z.number().nonnegative()).optional(),
  notes: z.string().optional().nullable(),
  headerText: z.string().optional().nullable(),
  footerText: z.string().optional().nullable(),
  headerImageName: z.string().optional().nullable(),
  headerImageStoredName: z.string().optional().nullable(),
  footerImageName: z.string().optional().nullable(),
  footerImageStoredName: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1),
};

// type is fixed at creation — a customer quote never becomes a vendor one
const createQuotationSchema = z.object({ ...base, type: z.enum(['CUSTOMER', 'VENDOR']).default('CUSTOMER') });
// Only UI-supported transitions are accepted; CONVERTED is reserved for the
// transactional conversion endpoint and cannot be assigned directly.
const updateQuotationSchema = partialNoDefaults(z.object({
  ...base,
  status: z.enum(['SENT', 'APPROVED', 'REJECTED']).optional(),
}));

module.exports = { createQuotationSchema, updateQuotationSchema };
