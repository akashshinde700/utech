'use strict';
const { z } = require('zod');

// emails are normalized (trim + lowercase) before validation, so
// 'Admin@Utech.local ' matches the stored 'admin@utech.local' account
const normalizedEmail = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.string().email()
);

const loginSchema = z.object({
  email: normalizedEmail,
  password: z.string().min(6),
});

const registerSchema = z.object({
  name: z.string().min(2),
  email: normalizedEmail,
  password: z.string().min(8),
  phone: z.string().optional(),
  roleId: z.number().int().optional(),
});

const otpRequestSchema = z.object({
  email: normalizedEmail,
  purpose: z.enum(['login', 'reset', 'verify']).default('login'),
});

const otpVerifySchema = z.object({
  email: normalizedEmail,
  code: z.string().length(6),
  purpose: z.enum(['login', 'reset', 'verify']).default('login'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword: z.string().min(8),
});

module.exports = { loginSchema, registerSchema, otpRequestSchema, otpVerifySchema, changePasswordSchema };
