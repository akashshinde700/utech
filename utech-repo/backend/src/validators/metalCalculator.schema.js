'use strict';
const { z } = require('zod');
const { SHAPE_IDS, UNIT_IDS, WEIGHT_UNITS } = require('../services/metalCalculator');

// Cross-field rules (required dimensions, sheet has no length mode, density vs
// metal, kg/m only for angle/beam/channel) live in the service, because they
// depend on the shape catalogue. This schema only guards the wire format.
const dimensionValues = z.record(
  z.string().min(1).max(8),
  z.coerce.number().finite().nonnegative().max(1e9)
);

const standardProfileSchema = z.object({
  name: z.string().min(1).max(120),
  kgm: z.coerce.number().positive().max(2000),
});

const calculateSchema = z.object({
  mode: z.enum(['weight', 'length']).default('weight'),
  shape: z.enum(SHAPE_IDS),
  unit: z.enum(UNIT_IDS).default('mm'),
  weightUnit: z.enum(WEIGHT_UNITS).default('kg'),
  metal: z.string().min(1).max(80).optional().nullable(),
  density: z.coerce.number().positive().max(30).optional().nullable(),
  values: dimensionValues.default({}),
  pieces: z.coerce.number().int().min(1).max(100000).default(1),
  totalWeight: z.coerce.number().positive().max(1e9).optional().nullable(),
  rate: z.coerce.number().nonnegative().max(1e9).optional().nullable(),
  standardProfile: standardProfileSchema.optional().nullable(),
});

module.exports = { calculateSchema };
