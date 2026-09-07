'use strict';
const { z } = require('zod');

const partyBase = {
  name: z.string().min(2),
  type: z.enum(['CUSTOMER', 'VENDOR', 'BOTH']).default('CUSTOMER'),
  contactPerson: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().optional().nullable(),
  altPhone: z.string().optional().nullable(),
  gstin: z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/).optional().nullable().or(z.literal('')),
  pan: z.string().length(10).optional().nullable().or(z.literal('')),
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  pincode: z.string().optional().nullable(),
  country: z.string().optional().default('India'),
  creditLimit: z.number().nonnegative().optional().nullable(),
  creditDays: z.number().int().nonnegative().optional().nullable(),
  openingBalance: z.number().optional().nullable(),
  isActive: z.boolean().optional(),
  notes: z.string().optional().nullable(),
};

const createPartySchema = z.object(partyBase);
const updatePartySchema = z.object(partyBase).partial();

module.exports = { createPartySchema, updatePartySchema };
