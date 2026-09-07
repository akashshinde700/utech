'use strict';
const { z } = require('zod');

// matches the fulfill handler body: { lineId, qty } — qty drives the
// fulfilled rollup, so it must be a real positive number
const fulfillBackOrderSchema = z.object({
  lineId: z.number().int().positive(),
  qty: z.number().positive(),
});

module.exports = { fulfillBackOrderSchema };
