'use strict';
const { z } = require('zod');

// Process Master: predefined + Department Head-added custom processes and
// sub-processes share this one schema (see schema.prisma's Process model doc).
const processBase = {
  code: z.string().min(1),
  name: z.string().min(2),
  stage: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  departmentId: z.number().int().optional().nullable(), // null = GLOBAL
  parentProcessId: z.number().int().optional().nullable(), // set = this is a Sub-Process
  dependsOnProcessId: z.number().int().optional().nullable(),
  displayOrder: z.number().int().optional(),
  stdTimeMin: z.number().nonnegative().optional().nullable(),
  ratePerHour: z.number().nonnegative().optional().nullable(),
  isActive: z.boolean().optional(),
};

const createProcessSchema = z.object(processBase).omit({ code: true }).extend({
  // code is optional on create — auto-generated when blank, like every
  // other master in this app (item/party) via nextCode
  code: z.string().optional().nullable(),
});
const updateProcessSchema = z.object(processBase).omit({ code: true }).partial();

module.exports = { createProcessSchema, updateProcessSchema };
