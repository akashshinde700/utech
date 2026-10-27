'use strict';
const Decimal = require('decimal.js');

// DECIMAL(14,3) is the common persisted precision for physical quantities.
const quantity = (schema) => schema.max(99999999999.999).refine(
  (value) => new Decimal(value).decimalPlaces() <= 3,
  'Must have at most 3 decimal places'
);

const money = (schema) => schema.max(999999999999.99).refine(
  (value) => new Decimal(value).decimalPlaces() <= 2,
  'Must have at most 2 decimal places'
);

module.exports = { quantity, money };
