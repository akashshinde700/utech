'use strict';
const { z } = require('zod');
const { partialNoDefaults } = require('./partial');

const departmentBase = {
  name: z.string().min(2),
  code: z.string().min(1),
  description: z.string().optional().nullable(),
  departmentHeadUserId: z.number().int().optional().nullable(),
  isActive: z.boolean().optional(),
};

const createDepartmentSchema = z.object(departmentBase);
const updateDepartmentSchema = partialNoDefaults(z.object(departmentBase));

module.exports = { createDepartmentSchema, updateDepartmentSchema };
