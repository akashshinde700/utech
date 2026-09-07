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

module.exports = { createUserSchema, updateUserSchema };
