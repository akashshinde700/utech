'use strict';
const { z } = require('zod');

// seeded roles were created without a code, so an edit form round-trips
// null/'' — treat both as "no code" instead of rejecting the whole save
const codeField = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.string().min(2).regex(/^[A-Z0-9_]+$/, 'Code must be upper-case letters, numbers, underscores only').optional(),
);

const createRoleSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2).regex(/^[A-Z0-9_]+$/, 'Code must be upper-case letters, numbers, underscores only'),
  description: z.string().optional().nullable(),
  hierarchyLevel: z.number().int().nonnegative(),
  parentRoleId: z.number().int().optional().nullable(),
  requiresDepartment: z.boolean().optional(),
  scopeToDepartment: z.boolean().optional(),
  isActive: z.boolean().optional(),
  permissions: z.array(z.string()).optional(),
});

const updateRoleSchema = z.object({
  name: z.string().min(2).optional(),
  code: codeField,
  description: z.string().optional().nullable(),
  hierarchyLevel: z.number().int().nonnegative().optional(),
  parentRoleId: z.number().int().optional().nullable(),
  requiresDepartment: z.boolean().optional(),
  scopeToDepartment: z.boolean().optional(),
  isActive: z.boolean().optional(),
  permissions: z.array(z.string()).optional(),
});

module.exports = { createRoleSchema, updateRoleSchema };
