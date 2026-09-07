'use strict';
const { z } = require('zod');

const lineSchema = z.object({
  id: z.number().int().optional(),
  itemId: z.number().int().optional().nullable(),
  itemName: z.string().optional().nullable(),
  qty: z.number().positive(),
  uomCode: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const operationSchema = z.object({
  processId: z.number().int().optional().nullable(),
  machineId: z.number().int().optional().nullable(),
  sequence: z.number().int().default(0),
  notes: z.string().optional().nullable(),
});

const baseJobcard = {
  date: z.coerce.date(),
  partyId: z.number().int().optional().nullable(),
  itemId: z.number().int().optional().nullable(),
  itemDescription: z.string().optional().nullable(),
  assignedOperatorId: z.number().int().optional().nullable(),
  projectEngineerId: z.number().int().optional().nullable(),
  projectNumber: z.string().optional().nullable(),
  assemblyNumber: z.string().optional().nullable(),
  drawingNumber: z.string().optional().nullable(),
  qtyOrdered: z.number().nonnegative().default(0),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  remarks: z.string().optional().nullable(),
  lines: z.array(lineSchema).default([]),
  operations: z.array(operationSchema).default([]),
};

const createJobcardSchema = z.object(baseJobcard);
const updateJobcardSchema = z.object({
  ...baseJobcard,
  status: z.enum(['DRAFT', 'IN_PROGRESS', 'ON_HOLD', 'REVERTED', 'COMPLETED', 'CANCELLED']).optional(),
  qtyProduced: z.number().nonnegative().optional(),
  qtyRejected: z.number().nonnegative().optional(),
}).partial();

const revertSchema = z.object({ reason: z.string().min(2) });

const checklistItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  done: z.boolean(),
});

const progressSchema = z.object({
  workStatus: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'TESTING', 'COMPLETED']).optional(),
  checklist: z.array(checklistItemSchema).optional(),
}).refine((d) => d.workStatus !== undefined || d.checklist !== undefined, {
  message: 'workStatus or checklist is required',
});

const noteSchema = z.object({
  kind: z.enum(['WORK_UPDATE', 'COMMENT']),
  body: z.string().min(1),
});

const jobworkLineSchema = z.object({
  itemId: z.number().int().optional().nullable(),
  description: z.string().optional().nullable(),
  processId: z.number().int().optional().nullable(),
  qtySent: z.number().positive(),
  rate: z.number().nonnegative().optional().nullable(),
  notes: z.string().optional().nullable(),
}).refine((l) => l.itemId != null || (l.description && l.description.trim()), {
  message: 'itemId or description is required',
});

const createJobworkSchema = z.object({
  date: z.coerce.date(),
  partyId: z.number().int(),
  notes: z.string().optional().nullable(),
  materialOwnerType: z.enum(['COMPANY', 'CUSTOMER']).default('COMPANY'),
  customerMaterialLotId: z.number().int().optional().nullable(),
  expectedReturnDate: z.coerce.date().optional().nullable(),
  lines: z.array(jobworkLineSchema).min(1),
}).refine((d) => d.materialOwnerType !== 'CUSTOMER' || d.customerMaterialLotId != null, {
  message: 'customerMaterialLotId is required when materialOwnerType is CUSTOMER',
  path: ['customerMaterialLotId'],
});

const receiveJobworkSchema = z.object({
  lines: z.array(z.object({
    id: z.number().int(),
    qtyReceived: z.number().nonnegative().default(0),
    qtyRejected: z.number().nonnegative().default(0),
  })).min(1),
});

const dispatchLineSchema = z.object({
  itemId: z.number().int(),
  qty: z.number().positive(),
  uomCode: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const createDispatchSchema = z.object({
  date: z.coerce.date(),
  partyId: z.number().int(),
  vehicleNo: z.string().optional().nullable(),
  driverName: z.string().optional().nullable(),
  driverPhone: z.string().optional().nullable(),
  ewayBillNo: z.string().optional().nullable(),
  invoiceId: z.number().int().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(dispatchLineSchema).min(1),
});

module.exports = {
  createJobcardSchema, updateJobcardSchema, revertSchema,
  progressSchema, noteSchema,
  createJobworkSchema, receiveJobworkSchema,
  createDispatchSchema,
};
