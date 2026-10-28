'use strict';
const { z } = require('zod');
const { money } = require('./precision');
const { partialNoDefaults } = require('./partial');

// Expense payloads (AUD-115).
//
// These two routes were the last money-writing endpoints with no schema. The
// controller does whitelist the keys it copies, so nothing could ever be
// mass-assigned — what was missing was any check that the values in those keys
// were numbers. `POST` hand-checked `amount > 0` with `Number(...)`, which lets
// "twelve hundred" through (NaN > 0 is false, so the guard reads as "not
// invalid") and then fails inside Prisma as a 500. `PUT` ran no checks at all,
// so an edit could set a negative amount and quietly reduce the cost total on
// the dashboard and in the category summary chart.
//
// The category and payment-mode lists are the ones the expense form offers —
// a typo used to become its own slice in that chart.

const CATEGORIES = ['Material', 'Travel', 'Salary', 'Utility', 'Office', 'Tax', 'Other'];
const PAYMENT_MODES = ['CASH', 'BANK', 'UPI', 'CHEQUE'];

const createExpenseSchema = z.object({
  date: z.coerce.date(),
  category: z.enum(CATEGORIES),
  partyId: z.number().int().positive().optional().nullable(),
  description: z.string().trim().min(1, 'Description is required'),
  amount: money(z.number().positive('Amount must be greater than 0')),
  taxAmount: money(z.number().nonnegative()).default(0),
  paymentMode: z.enum(PAYMENT_MODES).default('CASH'),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// An absent key means "leave the stored value alone" (see partial.js), so an
// edit that only sets `notes` must not reset the amount or the category.
const updateExpenseSchema = partialNoDefaults(createExpenseSchema);

module.exports = { createExpenseSchema, updateExpenseSchema, CATEGORIES, PAYMENT_MODES };
