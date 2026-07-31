// Purpose: SEC access-layer tests — safe ticker validation and rejection, CIK
// resolution, cached/rate-gated orchestration, and neutral upstream-failure handling.
// No live SEC calls: fetch is fully mocked and the rate gate uses an injected clock.

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vitest';

import { PublicServerError } from '@/server/errors';
import {
  SEC_MIN_REQUEST_INTERVAL_MS,
  SerialRateGate,
  buildCikMap,
  loadFundamentals,
  resetSecCachesForTests,
  resolveTickerCik,
  validateFundamentalsTicker,
  type SecClientOptions,
} from '@/server/sec';

const USER_AGENT = 'InvestIQ-test/1.0 (test@example.com)';

const TICKERS = {
  '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  '1': { cik_str: 1067983, ticker: 'BRK-B', title: 'Berkshire Hathaway Inc.' },
};

const APPLE_FACTS = {
  cik: 320193,
  entityName: 'Apple Inc.',
  facts: {
    'us-gaap': {
      RevenueFromContractWithCustomerExcludingAssessedTax: {
        units: {
          USD: [
            {
              start: '2022-09-25',
              end: '2023-09-30',
              val: 383_285_000_000,
              accn: '0000320193-23-000106',
              fy: 2023,
              fp: 'FY',
              form: '10-K',
              filed: '2023-11-03',
            },
          ],
        },
      },
    },
  },
};

const APPLE_SUBMISSIONS = {
  name: 'Apple Inc.',
  sic: '3571',
  sicDescription: 'Electronic Computers',
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Handler {
  match: (url: string) => boolean;
  respond: () => Response;
}

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
}

function makeFetch(handlers: Handler[]): { impl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const handler = handlers.find((entry) => entry.match(url));
    if (!handler) throw new Error(`unexpected fetch: ${url}`);
    return handler.respond();
  }) as typeof fetch;
  return { impl, calls };
}

/** Default happy-path handler set. Individual tests override single handlers. */
function happyHandlers(overrides: Partial<Record<'tickers' | 'facts' | 'submissions', () => Response>> = {}): Handler[] {
  return [
    { match: (u) => u.includes('company_tickers.json'), respond: overrides.tickers ?? (() => json(TICKERS)) },
    { match: (u) => u.includes('/companyfacts/'), respond: overrides.facts ?? (() => json(APPLE_FACTS)) },
    { match: (u) => u.includes('/submissions/'), respond: overrides.submissions ?? (() => json(APPLE_SUBMISSIONS)) },
  ];
}

function options(impl: typeof fetch): SecClientOptions {
  return { fetchImpl: impl, userAgent: USER_AGENT, gate: new SerialRateGate(0) };
}

async function expectStatus(run: () => Promise<unknown>, status: number): Promise<PublicServerError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof PublicServerError, `expected PublicServerError, got ${String(error)}`);
    assert.equal(error.status, status);
    return error;
  }
  throw new assert.AssertionError({ message: `expected a ${status} rejection` });
}

afterEach(() => {
  resetSecCachesForTests();
});

describe('validateFundamentalsTicker', () => {
  it('normalizes valid tickers and rejects malformed input', () => {
    assert.equal(validateFundamentalsTicker(' aapl '), 'AAPL');
    assert.equal(validateFundamentalsTicker('BRK.B'), 'BRK.B');
    assert.equal(validateFundamentalsTicker('ABCDEFGHIJKL'), 'ABCDEFGHIJKL');
    for (const bad of ['', '   ', 'ABCDEFGHIJKLM', 'AA$', '.AA', 123, null, undefined]) {
      assert.throws(() => validateFundamentalsTicker(bad as unknown), (error: unknown) => error instanceof PublicServerError && error.status === 400);
    }
  });
});

describe('CIK resolution', () => {
  it('builds a padded map and skips malformed rows', () => {
    const map = buildCikMap({
      '0': { cik_str: 320193, ticker: 'aapl', title: 'Apple Inc.' },
      '1': { cik_str: 'x', ticker: 'BAD' },
      '2': { ticker: 'NOCIK' },
    });
    assert.equal(map.get('AAPL')?.paddedCik, '0000320193');
    assert.equal(map.get('AAPL')?.cikNumber, 320193);
    assert.equal(map.has('BAD'), false);
    assert.equal(map.has('NOCIK'), false);
  });

  it('resolves a dotted class share against the SEC dash form', () => {
    const map = buildCikMap(TICKERS);
    assert.equal(resolveTickerCik(map, 'BRK.B')?.cikNumber, 1067983);
    assert.equal(resolveTickerCik(map, 'ZZZZ'), undefined);
  });
});

describe('loadFundamentals — happy path', () => {
  it('resolves identity and metrics and sends the configured User-Agent', async () => {
    const { impl, calls } = makeFetch(happyHandlers());
    const result = await loadFundamentals('aapl', options(impl));

    assert.equal(result.identity.ticker, 'AAPL');
    assert.equal(result.identity.cik, '0000320193');
    assert.equal(result.identity.name, 'Apple Inc.');
    assert.equal(result.identity.sicCode, 3571);
    assert.equal(result.identity.isFinancialIssuer, false);

    const revenue = result.metrics.find((metric) => metric.metric === 'revenue');
    assert.equal(revenue?.observations[0].value, 383_285_000_000);
    assert.equal(revenue?.observations[0].receipts[0].sourceUrl.startsWith('https://www.sec.gov/Archives/edgar/data/320193/'), true);

    assert.ok(calls.length >= 1);
    assert.equal(calls[0].headers['User-Agent'], USER_AGENT);
  });

  it('caches upstream responses so a repeat lookup makes no new requests', async () => {
    const { impl, calls } = makeFetch(happyHandlers());
    await loadFundamentals('AAPL', options(impl));
    const afterFirst = calls.length;
    await loadFundamentals('AAPL', options(impl));
    assert.equal(calls.length, afterFirst);
  });

  it('coalesces concurrent cache misses so each SEC resource is fetched once', async () => {
    const { impl, calls } = makeFetch(happyHandlers());
    await Promise.all([
      loadFundamentals('AAPL', options(impl)),
      loadFundamentals('AAPL', options(impl)),
    ]);
    assert.equal(calls.filter((call) => call.url.includes('company_tickers.json')).length, 1);
    assert.equal(calls.filter((call) => call.url.includes('/companyfacts/')).length, 1);
    assert.equal(calls.filter((call) => call.url.includes('/submissions/')).length, 1);
  });
});

describe('loadFundamentals — input and upstream failures', () => {
  it('returns 404 for a ticker absent from the SEC directory', async () => {
    const { impl } = makeFetch(happyHandlers());
    await expectStatus(() => loadFundamentals('ZZZZ', options(impl)), 404);
  });

  it('returns 404 when SEC has no company facts for the CIK', async () => {
    const { impl } = makeFetch(happyHandlers({ facts: () => new Response('not found', { status: 404 }) }));
    await expectStatus(() => loadFundamentals('AAPL', options(impl)), 404);
  });

  it('maps an upstream 5xx to a neutral 502 without leaking the body', async () => {
    const leak = 'INTERNAL STACK TRACE SECRET';
    const { impl } = makeFetch(happyHandlers({ facts: () => new Response(leak, { status: 500 }) }));
    const error = await expectStatus(() => loadFundamentals('AAPL', options(impl)), 502);
    assert.ok(!error.message.includes(leak));
  });

  it('maps SEC throttling/403 to a neutral 503', async () => {
    const { impl } = makeFetch(happyHandlers({ facts: () => new Response('forbidden', { status: 403 }) }));
    await expectStatus(() => loadFundamentals('AAPL', options(impl)), 503);
  });

  it('rejects an unexpected non-JSON content type', async () => {
    const { impl } = makeFetch(
      happyHandlers({ facts: () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }) }),
    );
    await expectStatus(() => loadFundamentals('AAPL', options(impl)), 502);
  });

  it('degrades gracefully when submissions (SIC) is unavailable', async () => {
    const { impl } = makeFetch(happyHandlers({ submissions: () => new Response('boom', { status: 500 }) }));
    const result = await loadFundamentals('AAPL', options(impl));
    assert.equal(result.identity.sicCode, undefined);
    assert.equal(result.identity.isFinancialIssuer, false);
    assert.equal(result.identity.name, 'Apple Inc.'); // falls back to companyfacts entityName
  });
});

describe('SerialRateGate fair-access spacing', () => {
  it('keeps dispatches spaced by the minimum interval, safely below 10 req/s', async () => {
    let clock = 0;
    const gate = new SerialRateGate(
      SEC_MIN_REQUEST_INTERVAL_MS,
      () => clock,
      async (ms) => {
        clock += ms;
      },
    );
    const dispatches: number[] = [];
    await Promise.all(
      Array.from({ length: 5 }, () =>
        gate.run(async () => {
          dispatches.push(clock);
        }),
      ),
    );

    assert.deepEqual(dispatches, [0, 150, 300, 450, 600]);
    for (let i = 1; i < dispatches.length; i += 1) {
      assert.ok(dispatches[i] - dispatches[i - 1] >= SEC_MIN_REQUEST_INTERVAL_MS);
    }
    assert.ok(1000 / SEC_MIN_REQUEST_INTERVAL_MS < 10);
  });

  it('advances past a failed task so it never stalls later requests', async () => {
    const gate = new SerialRateGate(0);
    await assert.rejects(gate.run(async () => { throw new Error('fail'); }));
    assert.equal(await gate.run(async () => 'ok'), 'ok');
  });
});
