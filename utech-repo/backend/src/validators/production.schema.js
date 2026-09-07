'use strict';
const { z } = require('zod');

// matches the completeBatch handler body: { qtyProduced, qtyRejected? } —
// unvalidated quantities used to allow NaN/negative stock movements
const completeBatchSchema = z.object({
  qtyProduced: z.number().nonnegative(),
  qtyRejected: z.number().nonnegative().optional(),
});

module.exports = { completeBatchSchema };
