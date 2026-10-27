'use strict';
const { z } = require('zod');
const { partialNoDefaults } = require('./partial');

const subCategoryBase = {
  departmentId: z.number().int(),
  name: z.string().min(2),
  code: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
};

const createSubCategorySchema = z.object(subCategoryBase);
const updateSubCategorySchema = partialNoDefaults(z.object(subCategoryBase));

module.exports = { createSubCategorySchema, updateSubCategorySchema };
