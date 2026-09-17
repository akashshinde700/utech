'use strict';
const { z } = require('zod');

const STATUSES = [
  'NOT_STARTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'ON_HOLD',
  'COMPLETED', 'REJECTED', 'CANCELLED', 'REOPENED',
];

const createTaskSchema = z.object({
  jobcardId: z.number().int(),
  processId: z.number().int().optional().nullable(),
  machineId: z.number().int().optional().nullable(),
  title: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  departmentId: z.number().int(), // a task always belongs to one department
  assignedToId: z.number().int().optional().nullable(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  plannedStartAt: z.coerce.date().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  estimatedHours: z.number().nonnegative().optional().nullable(),
  parentOperationId: z.number().int().optional().nullable(), // rework
  reworkReason: z.string().optional().nullable(),
  dependsOnOperationId: z.number().int().optional().nullable(),
  sequence: z.number().int().optional(),
});

const updateTaskSchema = createTaskSchema.omit({ jobcardId: true }).partial();

const assignTaskSchema = z.object({
  assignedToId: z.number().int(),
  notes: z.string().optional().nullable(),
});

// only the transitions the UI actually offers; the controller re-validates
// against the task's current status (guarded state machine)
const setStatusSchema = z.object({
  status: z.enum(STATUSES),
  reason: z.string().optional().nullable(), // required by the controller for ON_HOLD / REJECTED / CANCELLED
});

const setProgressSchema = z.object({
  progressPercent: z.number().int().min(0).max(100),
  actualHours: z.number().nonnegative().optional().nullable(),
});

const reworkTaskSchema = z.object({
  reworkReason: z.string().min(2),
  assignedToId: z.number().int().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
});

const taskNoteSchema = z.object({
  kind: z.enum(['WORK_UPDATE', 'COMMENT']).default('COMMENT'),
  body: z.string().min(1),
});

module.exports = {
  createTaskSchema, updateTaskSchema, assignTaskSchema,
  setStatusSchema, setProgressSchema, reworkTaskSchema, taskNoteSchema,
};
