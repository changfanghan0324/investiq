import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';

import { PublicServerError } from '@/server/errors';
import {
  areYahooSplitsVerified,
  assertDividendCoverage,
  classifyYahooSplit,
  isLiveMarketDataLicensed,
  isSessionComplete,
  loadMarketData,
  marketDataCapabilities,
  parseYahooDividends,
  parseYahooPrices,
  validateMarketDataOptions,
} from '@/server/market-data';

/** Asserts a synchronous parser call fails closed with a neutral PublicServerError. */
function expectParserRejects(run: () => unknown, status = 502): void {
  assert.throws(run, (error: unknown) => error instanceof PublicServerError && error.status === status);
}

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

  it('fails closed on an invalid OHLC bar instead of dropping it', () => {
    // A null close is now a controlled neutral 502, never a silently removed
    // session that could roll a scheduled purchase onto another date.
    expectParserRejects(() =>
      parseYahooPrices({
        timestamp: timestamps,
        indicators: { quote: [{ ...ohlc, close: [null], volume: [500] }] },
      }),
    );
  });
});

describe('Yahoo adjusted-close parsing (total-return proxy)', () => {
  const timestamps = [
    Date.parse('2024-01-02T14:30:00Z') / 1_000,
    Date.parse('2024-01-03T14:30:00Z') / 1_000,
  ];
  const ohlc = { open: [10, 11], high: [12, 13], low: [9, 10], close: [11, 12] };
  const parse = (adjclose?: Array<number | null>) =>
    parseYahooPrices({
      timestamp: timestamps,
      indicators: {
        quote: [{ ...ohlc }],
        ...(adjclose ? { adjclose: [{ adjclose }] } : {}),
      },
    });

  it('attaches one aligned adjusted close per completed bar', () => {
    const bars = parse([9.5, 12]);
    assert.equal(bars[0].adjustedClose, 9.5);
    assert.equal(bars[1].adjustedClose, 12);
  });

  it('degrades to no adjusted close when the axis is missing', () => {
    const bars = parse();
    assert.equal('adjustedClose' in bars[0], false);
    assert.equal('adjustedClose' in bars[1], false);
  });

  it('degrades to no adjusted close when the axis is misaligned, never partial', () => {
    const bars = parse([9.5]); // one value for two sessions
    assert.equal(bars.length, 2);
    assert.equal('adjustedClose' in bars[0], false);
    assert.equal('adjustedClose' in bars[1], false);
  });

  it('abandons the whole axis when any completed value is invalid', () => {
    for (const invalid of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const bars = parse([9.5, invalid as number]);
      assert.equal('adjustedClose' in bars[0], false, `invalid ${invalid} must abandon the axis`);
      assert.equal('adjustedClose' in bars[1], false);
    }
  });
});

describe('Yahoo OHLC economic invariants (fail-closed)', () => {
  const timestamps = [Date.parse('2024-01-02T14:30:00Z') / 1_000];
  const bar = (open: number, high: number, low: number, close: number) =>
    parseYahooPrices({
      timestamp: timestamps,
      indicators: { quote: [{ open: [open], high: [high], low: [low], close: [close] }] },
    });

  it('keeps a bar that satisfies every invariant', () => {
    assert.deepEqual(bar(10, 12, 9, 11), [{ date: '2024-01-02', open: 10, high: 12, low: 9, close: 11 }]);
  });

  it('rejects a zero or negative price rather than dropping the bar', () => {
    expectParserRejects(() => bar(0, 12, 9, 11));
    expectParserRejects(() => bar(10, 12, 9, 0));
    expectParserRejects(() => bar(-1, 12, 9, 11));
    expectParserRejects(() => bar(10, 12, 9, -5));
  });

  it('rejects a bar whose high does not bracket the open or close', () => {
    expectParserRejects(() => bar(10, 10.5, 9, 11)); // high 10.5 < close 11
    expectParserRejects(() => bar(12, 11, 9, 10)); // high 11 < open 12
  });

  it('rejects a bar whose low does not sit under the open or close', () => {
    expectParserRejects(() => bar(10, 12, 10.5, 11)); // low 10.5 > open 10
    expectParserRejects(() => bar(11, 12, 10.5, 10)); // low 10.5 > close 10
  });

  it('rejects a length mismatch between the timestamp and OHLC axes', () => {
    expectParserRejects(() =>
      parseYahooPrices({
        timestamp: [timestamps[0], timestamps[0] + 86_400],
        indicators: { quote: [{ open: [10], high: [12], low: [9], close: [11] }] },
      }),
    );
  });

  it('rejects a non-finite/unsafe session timestamp', () => {
    expectParserRejects(() =>
      parseYahooPrices({
        timestamp: [1_700_000_000.5],
        indicators: { quote: [{ open: [10], high: [12], low: [9], close: [11] }] },
      }),
    );
  });
});

describe('Yahoo completed-session boundary in the parser', () => {
  // 09:30 ET session open (13:30 UTC in EDT), so the UTC-derived bar date equals the
  // America/New_York calendar day the completed-session rule compares against.
  const openTs = (iso: string) => Date.parse(`${iso}T13:30:00Z`) / 1_000;
  const beforeThreshold = new Date('2026-07-29T18:00:00Z'); // 14:00 ET, before 16:15
  const afterThreshold = new Date('2026-07-29T20:30:00Z'); // 16:30 ET, past 16:15
  const trailingNullChart = {
    timestamp: [openTs('2026-07-28'), openTs('2026-07-29')],
    indicators: { quote: [{ open: [10, null], high: [12, null], low: [9, null], close: [11, null] }] },
  };

  it('(a) excludes a trailing same-day null bar before 16:15 ET and keeps prior completed bars', () => {
    const bars = parseYahooPrices(trailingNullChart, beforeThreshold);
    assert.deepEqual(bars, [{ date: '2026-07-28', open: 10, high: 12, low: 9, close: 11 }]);
  });

  it('(b) fails closed on the same incomplete current-day bar at/after 16:15 ET', () => {
    expectParserRejects(() => parseYahooPrices(trailingNullChart, afterThreshold));
  });

  it('admits a valid completed current-day bar once the threshold has passed', () => {
    const chart = {
      timestamp: [openTs('2026-07-28'), openTs('2026-07-29')],
      indicators: { quote: [{ open: [10, 10], high: [12, 12], low: [9, 9], close: [11, 11] }] },
    };
    const bars = parseYahooPrices(chart, afterThreshold);
    assert.equal(bars.length, 2);
    assert.equal(bars[1].date, '2026-07-29');
  });

  it('(c) still fails closed on a historical middle-null bar (independent of the threshold)', () => {
    const chart = {
      timestamp: [openTs('2026-07-27'), openTs('2026-07-28'), openTs('2026-07-29')],
      indicators: {
        quote: [{ open: [10, null, 10], high: [12, null, 12], low: [9, null, 9], close: [11, null, 11] }],
      },
    };
    expectParserRejects(() => parseYahooPrices(chart, beforeThreshold));
  });

  it('(d) fails closed on a future-dated bar rather than excluding it', () => {
    const chart = {
      timestamp: [openTs('2026-07-28'), openTs('2026-07-30')], // 07-30 is after the ET "today" of 07-29
      indicators: { quote: [{ open: [10, 10], high: [12, 12], low: [9, 9], close: [11, 11] }] },
    };
    expectParserRejects(() => parseYahooPrices(chart, beforeThreshold));
  });

  it('rejects a non-trailing incomplete current-day bar', () => {
    // Two same-day bars: the first (non-trailing) incomplete bar must fail closed,
    // never be excluded like a legitimate trailing in-progress bar.
    const chart = {
      timestamp: [openTs('2026-07-29'), openTs('2026-07-29')],
      indicators: { quote: [{ open: [null, 10], high: [null, 12], low: [null, 9], close: [null, 11] }] },
    };
    expectParserRejects(() => parseYahooPrices(chart, beforeThreshold));
  });

  it('excludes a lone in-progress current-day bar, yielding an empty completed series', () => {
    const chart = {
      timestamp: [openTs('2026-07-29')],
      indicators: { quote: [{ open: [null], high: [null], low: [null], close: [null] }] },
    };
    assert.deepEqual(parseYahooPrices(chart, beforeThreshold), []);
  });
});

describe('loadMarketData provider boundaries', () => {
  const usMeta = {
    currency: 'USD',
    exchangeName: 'NMS',
    fullExchangeName: 'NasdaqGS',
    exchangeTimezoneName: 'America/New_York',
    instrumentType: 'EQUITY',
    longName: 'Boundary Test Co',
  };

  function chart(
    timestamp: number[],
    quote: Record<string, Array<number | null>>,
    events: Record<string, unknown> = {},
    metaOverrides: Record<string, unknown> = {},
  ) {
    return {
      chart: {
        result: [
          { meta: { ...usMeta, ...metaOverrides }, timestamp, indicators: { quote: [quote] }, events },
        ],
      },
    };
  }

  function response(body: unknown, options: { status?: number; contentLength?: number } = {}): Response {
    const status = options.status ?? 200;
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    const headers = new Headers();
    if (options.contentLength !== undefined) headers.set('content-length', String(options.contentLength));
    return {
      status,
      ok: status >= 200 && status < 300,
      headers,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    } as unknown as Response;
  }

  function queueFetch(responses: Response[]) {
    const fetchMock = vi.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error('unexpected additional provider request');
      return next;
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('MASSIVE_API_KEY', 'test-key');
    return fetchMock;
  }

  const options = (ticker: string, mode: 'analysis' | 'dca' = 'dca') => ({
    ticker,
    from: '2000-01-01',
    to: '2020-12-31',
    requiredStart: '2000-01-01',
    mode,
  });

  const oneBarChart = chart([Date.parse('2024-01-02T14:30:00Z') / 1_000], {
    open: [10],
    high: [12],
    low: [9],
    close: [11],
    volume: [100],
  });

  async function expectRejectStatus(run: () => Promise<unknown>, status: number) {
    let caught: unknown;
    let threw = false;
    try {
      await run();
    } catch (error) {
      threw = true;
      caught = error;
    }
    assert.ok(threw, 'expected loadMarketData to reject');
    if (!(caught instanceof PublicServerError)) {
      assert.fail(`expected PublicServerError, got ${String(caught)}`);
    }
    assert.equal(caught.status, status);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('makes exactly one provider attempt on a 429 instead of amplifying it', async () => {
    // Yahoo chart succeeds; the Massive dividend call returns 429.
    const fetchMock = queueFetch([response(oneBarChart), response({}, { status: 429 })]);
    await expectRejectStatus(() => loadMarketData(options('RETRY1')), 429);
    // One Yahoo call + exactly one Massive call (no retry amplification).
    assert.equal(fetchMock.mock.calls.length, 2);
  });

  it('fails with a neutral 502 when a provider declares an oversized Content-Length', async () => {
    const fetchMock = queueFetch([response(oneBarChart, { contentLength: 9_000_000 })]);
    await expectRejectStatus(() => loadMarketData(options('OVERSIZE1')), 502);
    assert.equal(fetchMock.mock.calls.length, 1);
  });

  it('fails with a neutral 502 when a provider returns more sessions than supported', async () => {
    const timestamps = Array.from({ length: 40_001 }, (_, index) => 1_700_000_000 + index * 86_400);
    const oversizedChart = chart(timestamps, { open: [], high: [], low: [], close: [] });
    const fetchMock = queueFetch([response(oversizedChart)]);
    await expectRejectStatus(() => loadMarketData(options('ROWS1')), 502);
    assert.equal(fetchMock.mock.calls.length, 1);
  });

  it('accepts a large but supported price history', async () => {
    const count = 3_000;
    const base = Date.parse('2010-01-04T14:30:00Z') / 1_000;
    const timestamps = Array.from({ length: count }, (_, index) => base + index * 86_400);
    const quote = {
      open: Array<number>(count).fill(10),
      high: Array<number>(count).fill(12),
      low: Array<number>(count).fill(9),
      close: Array<number>(count).fill(11),
      volume: Array<number>(count).fill(100),
    };
    const fetchMock = queueFetch([
      response(chart(timestamps, quote)),
      response({ status: 'OK', results: [] }),
    ]);

    const data = await loadMarketData(options('CONTROL1'));
    assert.equal(data.prices.length, count);
    assert.equal(fetchMock.mock.calls.length, 2);
  });

  // ---- Exchange / listing scope ----
  const oneUsBar = () => ({ open: [10], high: [12], low: [9], close: [11], volume: [100] });
  const oneTs = () => [Date.parse('2024-01-02T14:30:00Z') / 1_000];

  it('accepts an ETF listed on NYSE Arca (SPY / SOXL, PCX)', async () => {
    for (const ticker of ['SPY', 'SOXL']) {
      const fetchMock = queueFetch([
        response(chart(oneTs(), oneUsBar(), {}, { exchangeName: 'PCX', fullExchangeName: 'NYSEArca', instrumentType: 'ETF' })),
      ]);
      const data = await loadMarketData(options(ticker, 'analysis'));
      assert.equal(data.type, 'ETF');
      assert.equal(data.exchange, 'PCX');
      // Analysis + no reported split => a single Yahoo call, no Massive request.
      assert.equal(fetchMock.mock.calls.length, 1);
      vi.unstubAllGlobals();
    }
  });

  it('accepts ordinary NYSE and Nasdaq common stocks', async () => {
    for (const [ticker, code, full] of [['GE', 'NYQ', 'NYSE'], ['AAPL', 'NMS', 'NasdaqGS']] as const) {
      const fetchMock = queueFetch([
        response(chart(oneTs(), oneUsBar(), {}, { exchangeName: code, fullExchangeName: full })),
      ]);
      const data = await loadMarketData(options(ticker, 'analysis'));
      assert.equal(data.type, 'CS');
      assert.equal(data.exchange, code);
      assert.equal(fetchMock.mock.calls.length, 1);
      vi.unstubAllGlobals();
    }
  });

  it('rejects an OTC/PNK ADR such as RYCEY with a precise 422', async () => {
    const fetchMock = queueFetch([
      response(chart(oneTs(), oneUsBar(), {}, { exchangeName: 'PNK', fullExchangeName: 'OTC Markets OTCPK' })),
    ]);
    await expectRejectStatus(() => loadMarketData(options('RYCEY', 'analysis')), 422);
    // Scope is decided from the first Yahoo response; no Massive request follows.
    assert.equal(fetchMock.mock.calls.length, 1);
  });

  it('keeps the special SPX investability message at validation', () => {
    assert.throws(
      () => validateMarketDataOptions({ ...options('SPX'), mode: 'analysis' }),
      /index/i,
    );
  });

  it('serves no live data in unlicensed production, before any provider call', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('no provider call should happen behind the licensing gate');
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('MASSIVE_API_KEY', 'test-key');
    vi.stubEnv('VERCEL_ENV', 'production');
    // Production without MARKET_DATA_PUBLIC_DISPLAY_LICENSE_CONFIRMED=true fails closed
    // with a neutral 503 and makes no upstream request.
    await expectRejectStatus(() => loadMarketData(options('LICENSED', 'analysis')), 503);
    assert.equal(fetchMock.mock.calls.length, 0);
  });

  // ---- Completed-session boundary and series integrity ----
  it('excludes an in-progress same-day bar from the historical series', async () => {
    const now = new Date('2026-07-29T18:00:00Z'); // 14:00 ET, before the 16:15 grace
    const ts = [
      Date.parse('2026-07-28T13:30:00Z') / 1_000,
      Date.parse('2026-07-29T13:30:00Z') / 1_000,
    ];
    const quote = { open: [10, 10], high: [12, 12], low: [9, 9], close: [11, 11], volume: [100, 100] };
    const fetchMock = queueFetch([
      response(chart(ts, quote)),
      response({ status: 'OK', results: [] }),
    ]);
    const data = await loadMarketData(
      { ticker: 'SESSNT', from: '2026-07-01', to: '2026-07-29', requiredStart: '2026-07-01', mode: 'dca' },
      now,
    );
    assert.equal(data.prices.length, 1);
    assert.equal(data.prices[0].date, '2026-07-28');
    assert.equal(data.provenance.lastCompletedSession, '2026-07-28');
    assert.equal(fetchMock.mock.calls.length, 2);
  });

  it('loads analysis mid-session when the trailing current-day bar has null OHLC', async () => {
    // Regression: a live Yahoo chart during market hours carries a trailing
    // in-progress bar with null prices. It must be excluded, not 502, and the prior
    // completed sessions must still load.
    const now = new Date('2026-07-29T18:00:00Z'); // 14:00 ET, before the 16:15 threshold
    const ts = [
      Date.parse('2026-07-27T13:30:00Z') / 1_000,
      Date.parse('2026-07-28T13:30:00Z') / 1_000,
      Date.parse('2026-07-29T13:30:00Z') / 1_000,
    ];
    const quote = {
      open: [10, 10, null],
      high: [12, 12, null],
      low: [9, 9, null],
      close: [11, 11, null],
      volume: [100, 100, null],
    };
    const fetchMock = queueFetch([response(chart(ts, quote))]);
    const data = await loadMarketData(
      { ticker: 'MIDSESS', from: '2026-07-01', to: '2026-07-29', requiredStart: '2026-07-01', mode: 'analysis' },
      now,
    );
    assert.equal(data.prices.length, 2);
    assert.equal(data.prices[1].date, '2026-07-28');
    assert.equal(data.provenance.lastCompletedSession, '2026-07-28');
    // Price-only analysis with no reported split: a single Yahoo call, no Massive.
    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(data.source, 'yahoo');
  });

  it('fails closed on duplicate session dates', async () => {
    const ts = [
      Date.parse('2024-01-02T14:30:00Z') / 1_000,
      Date.parse('2024-01-02T20:30:00Z') / 1_000,
    ];
    const quote = { open: [10, 10], high: [12, 12], low: [9, 9], close: [11, 11] };
    queueFetch([response(chart(ts, quote))]);
    await expectRejectStatus(() => loadMarketData(options('DUP1', 'analysis')), 502);
  });

  it('fails closed on misaligned OHLC arrays', async () => {
    const ts = [
      Date.parse('2024-01-02T14:30:00Z') / 1_000,
      Date.parse('2024-01-03T14:30:00Z') / 1_000,
    ];
    const quote = { open: [10], high: [12, 12], low: [9, 9], close: [11, 11] };
    queueFetch([response(chart(ts, quote))]);
    await expectRejectStatus(() => loadMarketData(options('ALIGN1', 'analysis')), 502);
  });

  it('fails closed on a middle null bar rather than silently dropping that session', async () => {
    const ts = [
      Date.parse('2024-01-02T14:30:00Z') / 1_000,
      Date.parse('2024-01-03T14:30:00Z') / 1_000,
      Date.parse('2024-01-04T14:30:00Z') / 1_000,
    ];
    // Middle session's close is null; strict parsing must 502 with no partial result
    // rather than remove the bar and roll later indices onto the wrong dates.
    const quote = { open: [10, 10, 10], high: [12, 12, 12], low: [9, 9, 9], close: [11, null, 11] };
    queueFetch([response(chart(ts, quote))]);
    await expectRejectStatus(() => loadMarketData(options('MIDNULL', 'analysis')), 502);
  });

  it('fails closed on an invalid session timestamp', async () => {
    // JSON cannot carry NaN, so a broken provider timestamp arrives as null; a
    // fractional/unsafe epoch is the other shape. Both are a neutral 502.
    const ts = [Date.parse('2024-01-02T14:30:00Z') / 1_000, 1_700_000_000.5];
    const quote = { open: [10, 10], high: [12, 12], low: [9, 9], close: [11, 11] };
    queueFetch([response(chart(ts, quote))]);
    await expectRejectStatus(() => loadMarketData(options('BADTS', 'analysis')), 502);
  });

  it('reports source "yahoo" for a price-only analysis with no reported split', async () => {
    const fetchMock = queueFetch([
      response(chart(oneTs(), oneUsBar(), {}, { exchangeName: 'NMS', fullExchangeName: 'NasdaqGS' })),
    ]);
    const data = await loadMarketData(options('AAPL', 'analysis'));
    assert.equal(data.source, 'yahoo');
    // Yahoo-only: no Massive request was issued.
    assert.equal(fetchMock.mock.calls.length, 1);
  });

  it('reports source "hybrid" when a reported split is verified against Massive', async () => {
    const ts = [Date.parse('2020-09-01T13:30:00Z') / 1_000];
    const quote = { open: [10], high: [12], low: [9], close: [11], volume: [100] };
    const events = {
      splits: {
        '0': {
          date: Date.parse('2020-08-31T13:30:00Z') / 1_000,
          numerator: 4,
          denominator: 1,
          splitRatio: '4:1',
        },
      },
    };
    const massiveSplits = {
      status: 'OK',
      results: [{ execution_date: '2020-08-31', split_from: 1, split_to: 4, adjustment_type: 'forward_split' }],
    };
    const fetchMock = queueFetch([response(chart(ts, quote, events)), response(massiveSplits)]);
    const data = await loadMarketData(options('AAPL', 'analysis'));
    assert.equal(data.source, 'hybrid');
    assert.equal(data.provenance.splitCoverage, 'cross-checked');
    // Yahoo chart + one Massive split-verification call.
    assert.equal(fetchMock.mock.calls.length, 2);
  });

  it('fails closed when paginated Massive pages cumulatively exceed the byte budget', async () => {
    const ts = [Date.parse('2020-03-20T13:30:00Z') / 1_000];
    const quote = { open: [10], high: [12], low: [9], close: [11], volume: [100] };
    // ~3.3 MB per page: each is under the 4 MB per-response cap, but four pages
    // cross the 12 MB cumulative budget, so the chain fails closed with a 502.
    const pad = 'x'.repeat(3_300_000);
    const dividendPage = (cursor: number) => ({
      status: 'OK',
      results: [],
      pad,
      next_url: `https://api.massive.com/stocks/v1/dividends?cursor=${cursor}`,
    });
    queueFetch([
      response(chart(ts, quote)),
      response(dividendPage(2)),
      response(dividendPage(3)),
      response(dividendPage(4)),
      response(dividendPage(5)),
    ]);
    await expectRejectStatus(
      () =>
        loadMarketData({
          ticker: 'PAGESUM',
          from: '2020-01-01',
          to: '2020-12-31',
          requiredStart: '2020-01-01',
          mode: 'dca',
        }),
      502,
    );
  });

  // ---- Full-window DCA dividend completeness gate ----
  const yahooDivEvents = (records: Array<[string, number]>) => ({
    dividends: Object.fromEntries(
      records.map(([iso, amount], index) => [
        String(index),
        { amount, date: Date.parse(`${iso}T13:30:00Z`) / 1_000 },
      ]),
    ),
  });
  const massiveDiv = (exDate: string, payDate: string, amount: number) => ({
    ex_dividend_date: exDate,
    pay_date: payDate,
    cash_amount: amount,
    split_adjusted_cash_amount: amount,
    frequency: 4,
    distribution_type: 'CD',
  });

  it('stops a DCA run when Massive dividend history is truncated versus Yahoo', async () => {
    const ts = [
      Date.parse('1994-03-18T13:30:00Z') / 1_000,
      Date.parse('2010-03-19T13:30:00Z') / 1_000,
    ];
    const quote = { open: [10, 10], high: [12, 12], low: [9, 9], close: [11, 11] };
    const events = yahooDivEvents([['1994-03-18', 0.3], ['2010-03-19', 0.6]]);
    const massive = { status: 'OK', results: [massiveDiv('2010-03-19', '2010-03-25', 0.6)] };
    queueFetch([response(chart(ts, quote, events)), response(massive)]);
    await expectRejectStatus(
      () => loadMarketData({ ticker: 'SPYT', from: '1990-01-01', to: '2010-12-31', requiredStart: '1990-01-01', mode: 'dca' }),
      422,
    );
  });

  it('accepts a DCA run when Yahoo and Massive dividends agree across the window', async () => {
    const ts = [
      Date.parse('2020-03-20T13:30:00Z') / 1_000,
      Date.parse('2020-06-19T13:30:00Z') / 1_000,
    ];
    const quote = { open: [10, 10], high: [12, 12], low: [9, 9], close: [11, 11], volume: [100, 100] };
    const events = yahooDivEvents([['2020-03-20', 1.406], ['2020-06-19', 1.366]]);
    const massive = {
      status: 'OK',
      results: [massiveDiv('2020-03-20', '2020-04-30', 1.406), massiveDiv('2020-06-19', '2020-07-31', 1.366)],
    };
    queueFetch([response(chart(ts, quote, events)), response(massive)]);
    const data = await loadMarketData({
      ticker: 'SPYOK',
      from: '2020-01-01',
      to: '2020-12-31',
      requiredStart: '2020-01-01',
      mode: 'dca',
    });
    assert.equal(data.dividends.length, 2);
    assert.equal(data.provenance.dividendCoverage, 'cross-checked');
    assert.equal(data.provenance.splitCoverage, 'none-reported');
    // DCA always queries Massive for income, so the source is honestly hybrid.
    assert.equal(data.source, 'hybrid');
  });

  it('stops a DCA run on a special/irregular Massive distribution', async () => {
    const ts = [Date.parse('2020-03-20T13:30:00Z') / 1_000];
    const quote = { open: [10], high: [12], low: [9], close: [11] };
    const events = yahooDivEvents([['2020-03-20', 1.4]]);
    const massive = {
      status: 'OK',
      results: [{ ...massiveDiv('2020-03-20', '2020-04-30', 1.4), frequency: 0, distribution_type: 'special' }],
    };
    queueFetch([response(chart(ts, quote, events)), response(massive)]);
    await expectRejectStatus(
      () => loadMarketData({ ticker: 'SPCL', from: '2020-01-01', to: '2020-12-31', requiredStart: '2020-01-01', mode: 'dca' }),
      422,
    );
  });
});

describe('completed-session helper', () => {
  it('drops an in-progress same-day bar before the post-close grace', () => {
    const now = new Date('2026-07-29T18:00:00Z'); // 14:00 ET
    assert.equal(isSessionComplete('2026-07-29', now), false);
    assert.equal(isSessionComplete('2026-07-28', now), true); // earlier date is final
    assert.equal(isSessionComplete('2026-07-30', now), false); // never admit a future bar
  });

  it('accepts a same-day bar after the post-close grace', () => {
    const now = new Date('2026-07-29T20:30:00Z'); // 16:30 ET, past the 16:15 grace
    assert.equal(isSessionComplete('2026-07-29', now), true);
  });
});

describe('Yahoo dividend parsing and completeness gate', () => {
  const div = (exDate: string, amount: number) => ({
    id: `m-${exDate}`,
    exDate,
    payDate: exDate,
    cashAmount: amount,
    splitAdjustedCashAmount: amount,
    distributionType: 'CD',
    frequency: 4,
  });

  it('parses ordinary Yahoo dividends within the window', () => {
    const recs = parseYahooDividends(
      { events: { dividends: { a: { amount: 1.4, date: Date.parse('2020-03-20T13:30:00Z') / 1_000 } } } },
      '2020-01-01',
      '2020-12-31',
    );
    assert.deepEqual(recs, [{ exDate: '2020-03-20', amount: 1.4 }]);
  });

  it('stops on a malformed Yahoo dividend event', () => {
    const ts = Date.parse('2021-03-19T13:30:00Z') / 1_000;
    assert.throws(() =>
      parseYahooDividends({ events: { dividends: { x: { amount: -1, date: ts } } } }, '2020-01-01', '2021-12-31'),
    );
    assert.throws(() =>
      parseYahooDividends({ events: { dividends: { x: { amount: 1, date: 0 } } } }, '2020-01-01', '2021-12-31'),
    );
  });

  it('passes when neither source reports dividends', () => {
    assert.doesNotThrow(() => assertDividendCoverage([], []));
  });

  it('treats same-date duplicates as a multiset', () => {
    assert.doesNotThrow(() =>
      assertDividendCoverage(
        [
          { exDate: '2021-03-19', amount: 1.3 },
          { exDate: '2021-03-19', amount: 0.4 },
        ],
        [div('2021-03-19', 1.3), div('2021-03-19', 0.4)],
      ),
    );
    assert.throws(() =>
      assertDividendCoverage(
        [
          { exDate: '2021-03-19', amount: 1.3 },
          { exDate: '2021-03-19', amount: 0.4 },
        ],
        [div('2021-03-19', 1.3)],
      ),
    );
  });

  it('accepts only binary float noise and rejects a 0.0001 dollar mismatch', () => {
    // Floating-point serialization noise (~5.5e-17 here, far under the 1e-6 tolerance) passes.
    assert.doesNotThrow(() =>
      assertDividendCoverage([{ exDate: '2021-03-19', amount: 0.1 + 0.2 }], [div('2021-03-19', 0.3)]),
    );
    // A genuine 0.0001-dollar discrepancy on one distribution now fails closed.
    assert.throws(() =>
      assertDividendCoverage([{ exDate: '2021-03-19', amount: 1.2345 }], [div('2021-03-19', 1.2346)]),
    );
    // The old relative allowance let large distributions mismatch materially; that must fail now too.
    assert.throws(() =>
      assertDividendCoverage([{ exDate: '2021-03-19', amount: 50.0 }], [div('2021-03-19', 50.02)]),
    );
  });
});

describe('market-data capabilities and licensing gate', () => {
  it('reports price analysis ready without a Massive key; DCA needs the key', () => {
    // Yahoo price analysis needs no key, so a missing key must not report unavailable.
    assert.deepEqual(marketDataCapabilities({ NODE_ENV: 'test' }), { priceAnalysis: true, dca: false });
    assert.deepEqual(marketDataCapabilities({ NODE_ENV: 'test', MASSIVE_API_KEY: 'k' }), {
      priceAnalysis: true,
      dca: true,
    });
  });

  it('is ungated outside hard production', () => {
    assert.equal(isLiveMarketDataLicensed({ NODE_ENV: 'development' }), true);
    assert.equal(isLiveMarketDataLicensed({ VERCEL_ENV: 'preview', NODE_ENV: 'production' }), true);
  });

  it('fails closed in production until the public-display license is confirmed', () => {
    assert.equal(isLiveMarketDataLicensed({ VERCEL_ENV: 'production' }), false);
    assert.equal(
      isLiveMarketDataLicensed({
        VERCEL_ENV: 'production',
        MARKET_DATA_PUBLIC_DISPLAY_LICENSE_CONFIRMED: 'true',
      }),
      true,
    );
  });

  it('blocks both capabilities in unlicensed production and returns only booleans', () => {
    const prod = { VERCEL_ENV: 'production', MASSIVE_API_KEY: 'secret' } as const;
    assert.deepEqual(marketDataCapabilities(prod), { priceAnalysis: false, dca: false });
    assert.deepEqual(
      marketDataCapabilities({ ...prod, MARKET_DATA_PUBLIC_DISPLAY_LICENSE_CONFIRMED: 'true' }),
      { priceAnalysis: true, dca: true },
    );
  });
});
