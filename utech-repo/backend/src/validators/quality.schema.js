'use strict';
const { z } = require('zod');

const qcLineSchema = z.object({
  parameter: z.string().min(1),
  expected: z.string().optional().nullable(),
  actual: z.string().optional().nullable(),
  result: z.enum(['PASS', 'FAIL']).default('PASS'),
  notes: z.string().optional().nullable(),
});

const createQualityCheckSchema = z.object({
  date: z.coerce.date(),
  // the document this check inspects — anything else would leave the check
  // pointing at a record type nothing can resolve
  refType: z.enum(['GRN', 'JOBCARD', 'DISPATCH', 'TASK']),
  refId: z.number().int().positive(),
  result: z.enum(['PASS', 'FAIL', 'PENDING']).default('PENDING'),
  inspectorName: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  certificateNo: z.string().optional().nullable(),
  lines: z.array(qcLineSchema).default([]),
});

// refType/refId are deliberately absent: re-pointing a check at another
// document would silently detach it from the thing it inspected
const updateQualityCheckSchema = z.object({
  date: z.coerce.date().optional(),
  result: z.enum(['PASS', 'FAIL', 'PENDING']).optional(),
  inspectorName: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  certificateNo: z.string().optional().nullable(),
  lines: z.array(qcLineSchema).optional(),
});

module.exports = { createQualityCheckSchema, updateQualityCheckSchema };
