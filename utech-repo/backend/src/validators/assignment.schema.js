'use strict';
const { z } = require('zod');

const createAssignmentSchema = z.object({
  attachmentId: z.number().int(),
  assignedToId: z.number().int(),
  pageNumbers: z.array(z.number().int().positive()).optional().nullable(),
  departmentId: z.number().int().optional().nullable(),
  departmentSubCategoryId: z.number().int().optional().nullable(),
  instructions: z.string().optional().nullable(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  dueDate: z.coerce.date().optional().nullable(),
});

const completeAssignmentSchema = z.object({
  completionRemarks: z.string().optional().nullable(),
});

const reopenAssignmentSchema = z.object({
  reason: z.string().optional().nullable(),
});

module.exports = { createAssignmentSchema, completeAssignmentSchema, reopenAssignmentSchema };
