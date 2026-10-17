'use strict';
const HttpError = require('./httpError');

// Date normalisation for the controllers that accept raw `req.body`.
//
// <input type="date"> sends "YYYY-MM-DD"; Prisma's DateTime wants a full
// ISO-8601 timestamp and rejects date-only strings. An empty string means
// "clear the field", not "1970-01-01", so it maps to null.
//
// Returns:
//   undefined  -> field was not sent (leave it alone on update)
//   null       -> field was cleared
//   Date       -> valid value
function parseDate(value, fieldName = 'date') {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new HttpError(400, `Invalid ${fieldName}: "${value}"`);
  }
  return d;
}

module.exports = { parseDate };
