'use strict';
const { z } = require('zod');

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional().nullable(),
  roleId: z.number().int().optional().nullable(),
  departmentId: z.number().int().optional().nullable(),
  departmentSubCategoryId: z.number().int().optional().nullable(),
  reportingToId: z.number().int().optional().nullable(),
  isActive: z.boolean().optional(),
});

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().optional().nullable(),
  roleId: z.number().int().optional().nullable(),
  departmentId: z.number().int().optional().nullable(),
  departmentSubCategoryId: z.number().int().optional().nullable(),
  reportingToId: z.number().int().optional().nullable(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

// per-user permission overrides: allow true = grant, false = revoke,
// null/omitted = fall back to whatever the role grants
const setUserPermissionsSchema = z.object({
  overrides: z.array(z.object({
    key: z.string().min(1),
    allow: z.boolean().nullable().optional(),
  })).max(500),
});

module.exports = { setUserPermissionsSchema, createUserSchema, updateUserSchema };
