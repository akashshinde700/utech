'use strict';
const { z } = require('zod');

const departmentBase = {
  name: z.string().min(2),
  code: z.string().min(1),
  description: z.string().optional().nullable(),
  departmentHeadUserId: z.number().int().optional().nullable(),
  isActive: z.boolean().optional(),
};

const createDepartmentSchema = z.object(departmentBase);
const updateDepartmentSchema = z.object(departmentBase).partial();

module.exports = { createDepartmentSchema, updateDepartmentSchema };
