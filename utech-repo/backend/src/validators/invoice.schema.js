'use strict';
const { z } = require('zod');
const Decimal = require('decimal.js');
const { partialNoDefaults } = require('./partial');

// Match the MySQL columns instead of letting the database silently round the
// inputs after the server has already calculated the line amount.
const maxQty = 99999999999.999; // DECIMAL(14,3)
const maxMoney = 999999999999.99; // DECIMAL(14,2)
const precision = (schema, places) => schema.refine(
  (value) => new Decimal(value).decimalPlaces() <= places,
  `Must have at most ${places} decimal places`
);

const lineSchema = z.object({
  itemId: z.number().int().optional().nullable(),
  description: z.string().min(1),
  hsnCode: z.string().optional().nullable(),
  qty: precision(z.number().positive().max(maxQty), 3),
  rate: precision(z.number().nonnegative().max(maxMoney), 2),
  gstRate: precision(z.number().min(0).max(100), 2).default(18),
});

const baseInvoice = {
  date: z.coerce.date(),
  dueDate: z.coerce.date().optional().nullable(),
  partyId: z.number().int(),
  // Only the authorized, approved quotation conversion may establish this link.
  quotationId: z.never({ error: 'Use quotation conversion to link an invoice' }).optional(),
  isIntraState: z.boolean().default(true),
  discount: precision(z.number().nonnegative().max(maxMoney), 2).default(0),
  notes: z.string().optional().nullable(),
  termsText: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1),
};

const createInvoiceSchema = z.object(baseInvoice);
const updateInvoiceSchema = partialNoDefaults(z.object({ ...baseInvoice }));

const paymentSchema = z.object({
  date: z.coerce.date(),
  amount: precision(z.number().positive().max(maxMoney), 2),
  mode: z.enum(['CASH', 'BANK', 'UPI', 'CHEQUE']).default('CASH'),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

module.exports = { createInvoiceSchema, updateInvoiceSchema, paymentSchema };
