'use strict';
const { z } = require('zod');

const STATUSES = [
  'NOT_STARTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'ON_HOLD',
  'SUBMITTED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'REOPENED',
];

const createTaskSchema = z.object({
  jobcardId: z.number().int(),
  processId: z.number().int().optional().nullable(),
  machineId: z.number().int().optional().nullable(),
  title: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  departmentId: z.number().int(), // a task always belongs to one department
  assignedToId: z.number().int().optional().nullable(),
  // multi-operator assignment; `assignedToId` above is still accepted and is
  // folded into this list by the controller
  assigneeIds: z.array(z.number().int()).max(25).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  // when true the assignee submits for review instead of completing directly
  requiresApproval: z.boolean().optional(),
  plannedStartAt: z.coerce.date().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  estimatedHours: z.number().nonnegative().optional().nullable(),
  parentOperationId: z.number().int().optional().nullable(), // rework
  reworkReason: z.string().optional().nullable(),
  dependsOnOperationId: z.number().int().optional().nullable(),
  sequence: z.number().int().optional(),
});

const updateTaskSchema = createTaskSchema.omit({ jobcardId: true }).partial();

// several predefined items onto one project, same operators for all
const bulkCreateTaskSchema = z.object({
  jobcardId: z.number().int(),
  departmentId: z.number().int(),
  processIds: z.array(z.number().int()).min(1, 'Select at least one Task Progress item').max(40),
  assigneeIds: z.array(z.number().int()).max(25).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  dueDate: z.coerce.date().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  requiresApproval: z.boolean().optional(),
});

// Either form is accepted: a single `assignedToId` (existing callers) or the
// full `assigneeIds` set, which replaces the task's operator list outright.
const assignTaskSchema = z.object({
  assignedToId: z.number().int().optional(),
  assigneeIds: z.array(z.number().int()).min(1).max(25).optional(),
  notes: z.string().optional().nullable(),
}).refine((v) => v.assignedToId || (v.assigneeIds && v.assigneeIds.length), {
  message: 'Select at least one operator',
  path: ['assigneeIds'],
});

// only the transitions the UI actually offers; the controller re-validates
// against the task's current status (guarded state machine)
const setStatusSchema = z.object({
  status: z.enum(STATUSES),
  reason: z.string().optional().nullable(), // required by the controller for ON_HOLD / REJECTED / CANCELLED
});

// the operator's own checkbox on a task that may have several operators
const myCompletionSchema = z.object({
  done: z.boolean(),
  remarks: z.string().max(1000).optional().nullable(),
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
  createTaskSchema, bulkCreateTaskSchema, updateTaskSchema, assignTaskSchema,
  setStatusSchema, setProgressSchema, myCompletionSchema, reworkTaskSchema, taskNoteSchema,
};
