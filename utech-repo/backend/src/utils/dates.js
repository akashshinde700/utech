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

// A bare `YYYY-MM-DD` names a day in the plant's own calendar, so its bounds
// have to be that day's midnights where the server is, not UTC's. Returns null
// for an impossible date (2026-02-30), which the caller turns into a 400 —
// JavaScript would otherwise roll it forward to 2 March without complaint.
function localDayStart(text, offsetDays = 0) {
  const [y, m, d] = String(text).split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  if (start.getFullYear() !== y || start.getMonth() !== m - 1 || start.getDate() !== d) return null;
  if (offsetDays) start.setDate(start.getDate() + offsetDays);
  return start;
}

/**
 * Turn ?from=&to= into a Prisma date filter.
 *
 * WHY THIS EXISTS
 * `where.date.lte = new Date('2026-10-27')` means 2026-10-27T00:00:00.000Z, so
 * an invoice/payment/movement stored later that same day (e.g. 18:30Z) is
 * silently excluded from "up to today" filters. Sales totals, ageing and stock
 * reports then disagree with the document list they were filtered from.
 *
 * A bare `YYYY-MM-DD` therefore means "the whole of that day", and the day is
 * the one the server prints — the report writes `dayjs(row.date).format(...)`,
 * which is local time, so bucketing by UTC midnight put a row in a different
 * day from the date printed next to it. On a server east of UTC (IST, +5:30)
 * that silently moved every movement posted between midnight and 05:30 — the
 * night shift — out of its own day's report while still showing that date in
 * the sheet. Documents dated from a date picker are unaffected either way;
 * what this fixes are the rows stamped with the moment they happened
 * (`StockLedger.date` defaults to now).
 *
 *   from=2026-10-01 → date >= 2026-10-01T00:00 local
 *   to=2026-10-27   → date <  2026-10-28T00:00 local   (exclusive next day)
 *
 * A full ISO timestamp is honoured verbatim (`lte`) — it already names an
 * instant, not a day, so API clients that mean "up to this instant" keep that
 * behaviour.
 *
 * Invalid input is rejected with the same 400 pattern as parseDate instead of
 * producing an Invalid Date that Prisma would turn into a 500.
 */
function dateRangeFilter(from, to) {
  const range = {};
  if (from != null && from !== '') {
    if (DATE_ONLY.test(String(from))) {
      const start = localDayStart(from);
      if (!start) throw new HttpError(400, `Invalid start date: "${from}"`);
      range.gte = start;
    } else {
      const start = new Date(from);
      if (Number.isNaN(start.getTime())) throw new HttpError(400, `Invalid start date: "${from}"`);
      range.gte = start;
    }
  }
  if (to != null && to !== '') {
    if (DATE_ONLY.test(String(to))) {
      // exclusive upper bound = the whole end day is included, whatever time
      // of day the record was posted at
      const next = localDayStart(to, 1);
      if (!next) throw new HttpError(400, `Invalid end date: "${to}"`);
      range.lt = next;
    } else {
      const end = new Date(to);
      if (Number.isNaN(end.getTime())) throw new HttpError(400, `Invalid end date: "${to}"`);
      range.lte = end;
    }
  }
  return Object.keys(range).length ? range : null;
}

module.exports = { parseDate, dateRangeFilter, localDayStart, DATE_ONLY };
