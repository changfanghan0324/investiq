// Purpose: Reproduction for listing-aware complete-calendar-year eligibility —
// a partial first listing year is excluded while full years remain included, and
// the return and dividend-yield samples share one eligible-year set.

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { completeCalendarYears } from '@/domain/projection-engine';
import type { PriceBar } from '@/types/backtest';
import { addDays, isWeekday } from '@/utils/date';

/** Weekday sessions spanning [from, to] inclusive, one flat bar per trading day. */
function sessions(from: string, to: string): PriceBar[] {
  const bars: PriceBar[] = [];
  let cursor = from;
  while (cursor <= to) {
    if (isWeekday(cursor)) bars.push({ date: cursor, open: 10, high: 11, low: 9, close: 10 });
    cursor = addDays(cursor, 1);
  }
  return bars;
}

describe('completeCalendarYears', () => {
  it('excludes a partial first listing year with 100+ sessions and keeps full years', () => {
    const prices = [
      // Mid-year IPO: ~130 sessions but the year is not fully observed.
      ...sessions('2019-07-01', '2019-12-31'),
      ...sessions('2020-01-01', '2020-12-31'),
      ...sessions('2021-01-01', '2021-12-31'),
      ...sessions('2022-01-01', '2022-12-31'),
    ];

    const ipoYear = prices.filter((bar) => bar.date.startsWith('2019-'));
    assert.ok(ipoYear.length > 100, 'the partial IPO year still has 100+ sessions');

    // The 2023 year is in progress on lastDate and must also be excluded.
    const eligible = completeCalendarYears(prices, '2023-06-30').map((year) => year.year);
    assert.deepEqual(eligible, [2020, 2021, 2022]);
  });

  it('excludes a year whose sample window starts mid-year even with many sessions', () => {
    const prices = [
      ...sessions('2020-06-15', '2020-12-31'), // sampled from mid-2020 only
      ...sessions('2021-01-01', '2021-12-31'),
    ];
    const eligible = completeCalendarYears(prices, '2022-01-31').map((year) => year.year);
    assert.deepEqual(eligible, [2021]);
  });

  it('excludes a year truncated before late December', () => {
    const prices = [
      ...sessions('2020-01-01', '2020-11-15'), // ends before the December boundary
      ...sessions('2021-01-01', '2021-12-31'),
    ];
    const eligible = completeCalendarYears(prices, '2022-01-31').map((year) => year.year);
    assert.deepEqual(eligible, [2021]);
  });
});
