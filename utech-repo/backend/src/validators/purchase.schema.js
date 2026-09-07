'use strict';
const { z } = require('zod');

// itemId is optional on both documents because an outsourced, vendor-made part
// often has no Item master row — such a line carries a description instead.
const withItemOrDescription = (schema) =>
  schema.refine((l) => l.itemId != null || !!l.description, {
    message: 'Every line needs either a catalog item or a description',
  });

const poLineSchema = withItemOrDescription(
  z.object({
    itemId: z.coerce.number().int().positive().nullable().optional(),
    description: z.string().trim().min(1).nullable().optional(),
    qty: z.coerce.number().positive(),
    rate: z.coerce.number().nonnegative(),
    gstRate: z.coerce.number().min(0).max(100).optional(),
  })
);

const purchaseOrderBase = z.object({
  date: z.coerce.date(),
  expectedDate: z.coerce.date().nullable().optional(),
  partyId: z.coerce.number().int().positive(),
  notes: z.string().trim().nullable().optional(),
  lines: z.array(poLineSchema).min(1),
});

const createPurchaseOrderSchema = purchaseOrderBase;
const updatePurchaseOrderSchema = purchaseOrderBase.partial();

const reasonSchema = z.object({
  reason: z.string().trim().nullable().optional(),
});

const grnLineSchema = withItemOrDescription(
  z.object({
    itemId: z.coerce.number().int().positive().nullable().optional(),
    description: z.string().trim().min(1).nullable().optional(),
    poLineId: z.coerce.number().int().positive().nullable().optional(),
    vendorWorkOrderLineId: z.coerce.number().int().positive().nullable().optional(),
    qty: z.coerce.number().positive(),
    qtyAccepted: z.coerce.number().nonnegative().optional(),
    qtyRejected: z.coerce.number().nonnegative().optional(),
    rate: z.coerce.number().nonnegative().nullable().optional(),
    notes: z.string().trim().nullable().optional(),
  })
).refine((l) => Number(l.qtyAccepted ?? l.qty) + Number(l.qtyRejected ?? 0) <= Number(l.qty), {
  message: 'Accepted + rejected quantity cannot exceed the received quantity',
});

const createGrnSchema = z.object({
  date: z.coerce.date(),
  poId: z.coerce.number().int().positive().nullable().optional(),
  partyId: z.coerce.number().int().positive().nullable().optional(),
  vendorWorkOrderId: z.coerce.number().int().positive().nullable().optional(),
  vehicleNo: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  lines: z.array(grnLineSchema).min(1),
});

// deliberately narrow: quantities drive stock, so they can only be corrected by
// cancelling the receipt and booking a fresh one; status flips go through the
// dedicated cancel endpoint (which reverses stock)
const updateGrnSchema = z.object({
  vehicleNo: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

module.exports = {
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  reasonSchema,
  createGrnSchema,
  updateGrnSchema,
};
