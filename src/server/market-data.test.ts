import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { areYahooSplitsVerified, classifyYahooSplit, parseYahooPrices } from '@/server/market-data';

describe('Yahoo split classification', () => {
  it('fails closed for the AT&T 2022 spin-off ratio Yahoo labels as a split', () => {
    const yahooEvent = {
      date: 1_649_683_800,
      numerator: 1324,
      denominator: 1000,
      splitRatio: '1324:1000',
    };
    assert.deepEqual(classifyYahooSplit(yahooEvent), { supported: false });
    assert.equal(areYahooSplitsVerified([yahooEvent], []), false);
  });

  it('supports an ordinary integer forward split', () => {
    assert.deepEqual(
      classifyYahooSplit({ numerator: 4, denominator: 1, splitRatio: '4:1' }),
      {
        supported: true,
        adjustmentType: 'split',
        normalizedFrom: 1,
        normalizedTo: 4,
      },
    );
  });

  it('supports ordinary fractional and reverse split ratios', () => {
    assert.deepEqual(classifyYahooSplit({ numerator: 3, denominator: 2 }), {
      supported: true,
      adjustmentType: 'split',
      normalizedFrom: 2,
      normalizedTo: 3,
    });
    assert.deepEqual(classifyYahooSplit({ numerator: 1, denominator: 10 }), {
      supported: true,
      adjustmentType: 'reverse_split',
      normalizedFrom: 10,
      normalizedTo: 1,
    });
  });

  it('normalizes equivalent ratios and rejects inconsistent Yahoo metadata', () => {
    assert.deepEqual(classifyYahooSplit({ numerator: 1000, denominator: 2000 }), {
      supported: true,
      adjustmentType: 'reverse_split',
      normalizedFrom: 2,
      normalizedTo: 1,
    });
    assert.deepEqual(
      classifyYahooSplit({ numerator: 4, denominator: 1, splitRatio: '3:1' }),
      { supported: false },
    );
  });

  it('accepts an ordinary split only when Yahoo and Massive records agree', () => {
    const yahooEvent = {
      date: Date.parse('2020-08-31T13:30:00Z') / 1_000,
      numerator: 4,
      denominator: 1,
      splitRatio: '4:1',
    };
    const massiveEvent = {
      execution_date: '2020-08-31',
      split_from: 1,
      split_to: 4,
      adjustment_type: 'forward_split',
    };

    assert.equal(areYahooSplitsVerified([yahooEvent], [massiveEvent]), true);
    assert.equal(areYahooSplitsVerified([yahooEvent], []), false);
    assert.equal(areYahooSplitsVerified([], [massiveEvent]), false);
  });

  it('accepts GOOG 20:1 when Massive records its standard split as a stock dividend', () => {
    assert.equal(
      areYahooSplitsVerified(
        [{
          date: Date.parse('2022-07-18T13:30:00Z') / 1_000,
          numerator: 20,
          denominator: 1,
          splitRatio: '20:1',
        }],
        [{
          execution_date: '2022-07-18',
          split_from: 1,
          split_to: 20,
          adjustment_type: 'stock_dividend',
        }],
      ),
      true,
    );
  });

  it('fails closed for a fractional stock dividend despite matching upstream records', () => {
    assert.equal(
      areYahooSplitsVerified(
        [{ date: Date.parse('2022-08-25T13:30:00Z') / 1_000, numerator: 3, denominator: 2 }],
        [{
          execution_date: '2022-08-25',
          split_from: 2,
          split_to: 3,
          adjustment_type: 'stock_dividend',
        }],
      ),
      false,
    );
  });
});

describe('Yahoo price volume parsing', () => {
  const timestamps = [Date.parse('2024-01-02T14:30:00Z') / 1_000];
  const ohlc = { open: [10], high: [12], low: [9], close: [11] };

  const parse = (quote: Record<string, Array<number | null>>) =>
    parseYahooPrices({ timestamp: timestamps, indicators: { quote: [{ ...ohlc, ...quote }] } });

  it('retains a valid volume, including zero', () => {
    assert.deepEqual(parse({ volume: [1_234_567] }), [
      { date: '2024-01-02', open: 10, high: 12, low: 9, close: 11, volume: 1_234_567 },
    ]);
    assert.deepEqual(parse({ volume: [0] })[0].volume, 0);
  });

  it('keeps a valid OHLC bar when volume is missing', () => {
    const withoutVolumeArray = parse({});
    assert.deepEqual(withoutVolumeArray, [
      { date: '2024-01-02', open: 10, high: 12, low: 9, close: 11 },
    ]);
    assert.equal('volume' in withoutVolumeArray[0], false);

    const withNullVolume = parse({ volume: [null] });
    assert.equal(withNullVolume.length, 1);
    assert.equal('volume' in withNullVolume[0], false);
  });

  it('omits negative and non-finite volume without dropping the bar', () => {
    for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const bars = parse({ volume: [invalid] });
      assert.equal(bars.length, 1);
      assert.equal('volume' in bars[0], false);
    }
  });

  it('drops a bar with invalid OHLC regardless of volume', () => {
    assert.deepEqual(
      parseYahooPrices({
        timestamp: timestamps,
        indicators: { quote: [{ ...ohlc, close: [null], volume: [500] }] },
      }),
      [],
    );
  });
});
