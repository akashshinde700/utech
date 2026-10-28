import { describe, it, expect } from 'vitest';
const dayjs = require('dayjs');
const { dateRangeFilter } = require('../../src/utils/dates');

// AUD-130. A report filters with `dateRangeFilter(?from, ?to)` and then prints
// each row's day with `dayjs(row.date).format('DD-MM-YYYY')` — local time. If
// the two disagree about where a day starts, a row shows one date in the sheet
// while being counted under another, and the only rows affected are the ones
// stamped with the moment they happened (StockLedger.date defaults to now),
// i.e. real production movements.
//
// These assertions are written without naming a timezone so they hold on a UTC
// CI runner and on the IST machine the plant actually uses. Under the previous
// UTC-midnight bounds they fail on IST for every instant between local midnight
// and 05:30 — the night shift.

const localDay = (t) => dayjs(t).format('YYYY-MM-DD');
const printed = (t) => dayjs(t).format('DD-MM-YYYY');

function bucketContains(dayText, when) {
  const range = dateRangeFilter(dayText, dayText);
  return when >= range.gte && when < range.lt;
}

describe('a day filter and the date printed on the row agree', () => {
  const instantsAcrossOneDay = [
    new Date(2026, 9, 28, 0, 0, 0, 0),     // local midnight — the edge
    new Date(2026, 9, 28, 0, 0, 0, 1),
    new Date(2026, 9, 28, 3, 0, 0, 0),     // night shift: UTC bounds lost this on IST
    new Date(2026, 9, 28, 5, 29, 59, 999),
    new Date(2026, 9, 28, 12, 0, 0, 0),
    new Date(2026, 9, 28, 18, 30, 0, 0),
    new Date(2026, 9, 28, 23, 59, 59, 999), // last millisecond of the day
  ];

  it.each(instantsAcrossOneDay)('a movement at %s falls in the day it prints', (when) => {
    expect(bucketContains(localDay(when), when)).toBe(true);
    expect(printed(when)).toBe('28-10-2026');
  });

  it('does not pull in the day before or the day after', () => {
    const when = new Date(2026, 9, 28, 3, 0, 0, 0);
    expect(bucketContains('2026-10-27', when)).toBe(false);
    expect(bucketContains('2026-10-29', when)).toBe(false);
  });

  it('covers a whole day with no gap and no overlap at the seam', () => {
    const endOf28 = dateRangeFilter(null, '2026-10-28').lt;
    const startOf29 = dateRangeFilter('2026-10-29', null).gte;
    expect(endOf28.getTime()).toBe(startOf29.getTime());
  });

  it('keeps month and year rollovers right', () => {
    const newYearEve = new Date(2026, 11, 31, 23, 0, 0, 0);
    expect(bucketContains('2026-12-31', newYearEve)).toBe(true);
    expect(dateRangeFilter('2026-12-31', '2026-12-31').lt).toEqual(new Date(2027, 0, 1, 0, 0, 0, 0));

    const leapDay = new Date(2028, 1, 29, 10, 0, 0, 0); // 2028 is a leap year
    expect(bucketContains('2028-02-29', leapDay)).toBe(true);
    expect(dateRangeFilter('2028-02-29', '2028-02-29').lt).toEqual(new Date(2028, 2, 1, 0, 0, 0, 0));
  });

  it('still refuses a day that does not exist, instead of rolling it forward', () => {
    // new Date(2026, 1, 30) silently becomes 2 March — a filter built from it
    // would quietly report the wrong period
    expect(() => dateRangeFilter('2026-02-30', null)).toThrow(/Invalid start date/);
    expect(() => dateRangeFilter(null, '2026-02-30')).toThrow(/Invalid end date/);
    expect(() => dateRangeFilter('2026-13-01', null)).toThrow(/Invalid start date/);
  });

  it('leaves an explicit instant alone — it names a moment, not a day', () => {
    const range = dateRangeFilter(null, '2026-10-28T12:00:00.000Z');
    expect(range.lte.toISOString()).toBe('2026-10-28T12:00:00.000Z');
    expect(range.lt).toBeUndefined();
  });
});
