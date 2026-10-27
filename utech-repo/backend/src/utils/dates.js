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

// A bare calendar day, exactly as an <input type="date"> / ?from=&to= sends it.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turn ?from=&to= into a Prisma date filter.
 *
 * WHY THIS EXISTS
 * `where.date.lte = new Date('2026-10-27')` means 2026-10-27T00:00:00.000Z, so
 * an invoice/payment/movement stored later that same day (e.g. 18:30Z) is
 * silently excluded from "up to today" filters. Sales totals, ageing and stock
 * reports then disagree with the document list they were filtered from.
 *
 * A bare `YYYY-MM-DD` upper bound therefore means "the whole of that day":
 *   from=2026-10-01 → date >= 2026-10-01T00:00:00.000Z
 *   to=2026-10-27   → date <  2026-10-28T00:00:00.000Z   (exclusive next day)
 * A full ISO timestamp is honoured verbatim (`lte`), so API clients that really
 * mean "up to this instant" keep that behaviour.
 *
 * Invalid input is rejected with the same 400 pattern as parseDate instead of
 * producing an Invalid Date that Prisma would turn into a 500.
 */
function dateRangeFilter(from, to) {
  const range = {};
  if (from != null && from !== '') {
    if (DATE_ONLY.test(String(from))) {
      const start = new Date(`${from}T00:00:00.000Z`);
      if (Number.isNaN(start.getTime())) throw new HttpError(400, `Invalid start date: "${from}"`);
      range.gte = start;
    } else {
      const start = new Date(from);
      if (Number.isNaN(start.getTime())) throw new HttpError(400, `Invalid start date: "${from}"`);
      range.gte = start;
    }
  }
  if (to != null && to !== '') {
    if (DATE_ONLY.test(String(to))) {
      const next = new Date(`${to}T00:00:00.000Z`);
      if (Number.isNaN(next.getTime())) throw new HttpError(400, `Invalid end date: "${to}"`);
      // exclusive upper bound = the whole end day is included, whatever time
      // of day the record was posted at
      next.setUTCDate(next.getUTCDate() + 1);
      range.lt = next;
    } else {
      const end = new Date(to);
      if (Number.isNaN(end.getTime())) throw new HttpError(400, `Invalid end date: "${to}"`);
      range.lte = end;
    }
  }
  return Object.keys(range).length ? range : null;
}

module.exports = { parseDate, dateRangeFilter, DATE_ONLY };
