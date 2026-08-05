import { isValidOhlcBar } from '@/domain/ohlc';
import { publicError, readJsonFromResponse, readJsonFromResponseWithSize } from '@/server/errors';
import type { DataProvenance, MarketDataMode } from '@/types/backtest';

const MASSIVE_API_BASE = 'https://api.massive.com';
const MASSIVE_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const MAX_MASSIVE_CACHE_ENTRIES = 500;
// Bounded incremental JSON budgets keep a hostile or broken provider response
// from exhausting memory. They are provider-specific and comfortably cover the
// largest supported histories while staying below Vercel's 4.5 MB payload limit.
const MAX_MASSIVE_RESPONSE_BYTES = 4_000_000;
const MAX_YAHOO_RESPONSE_BYTES = 8_000_000;
// Cumulative body-byte budget for ONE logical paginated Massive request. The
// per-response cap above bounds a single page, but a 25-page `next_url` chain
// could otherwise accumulate ~100 MB. This ceiling (3x one page) is far above any
// supported dividend/split history yet stops a hostile or broken cursor chain
// long before it exhausts memory. It is counted from the exact bytes read per
// page, so a cache-replayed page is accounted identically to a freshly read one.
const MAX_MASSIVE_TOTAL_RESPONSE_BYTES = 3 * MAX_MASSIVE_RESPONSE_BYTES;
// Schema cardinality ceilings. Exceeding them is an explicit neutral error, not
// a silent truncation of financial history.
const MAX_MASSIVE_ROWS = 10_000;
const MAX_YAHOO_BARS = 40_000;
// Bounded `next_url` pagination. A cursor chain longer than this is treated as a
// coverage failure rather than an unbounded crawl of the provider.
const MAX_MASSIVE_PAGES = 25;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_PATTERN = /^[A-Z0-9.-]{1,12}$/;
const UNSUPPORTED_CORPORATE_ACTION_MESSAGE =
  'This stock contains a corporate action that is not yet supported.';

// US core session closes at 16:00 ET. We wait an extra conservative grace period
// before treating a same-day bar as final, so an in-progress bar can never enter
// a historical result. 16:15 ET = 975 minutes past ET midnight. We stay
// deliberately conservative on early-close days (a genuinely final early-close
// bar is simply admitted the next calendar day instead of risking a live bar).
const SESSION_CLOSE_GRACE_MINUTES = 16 * 60 + 15;

// Dividend cross-check tolerance. Provider decimal amounts that describe the same
// distribution serialize to the same value; the only permitted gap is binary
// floating-point noise from decoding and arithmetic. 1e-6 dollar is ~1/10,000 of
// a cent — invisible to any real distribution but wide enough for that noise.
// There is deliberately no relative allowance: a genuine 0.0001-dollar (or larger)
// mismatch on any distribution fails closed rather than scaling the slack with the
// amount and admitting a materially different payment.
const DIVIDEND_AMOUNT_ABS_TOL = 1e-6;

// Yahoo exchange short codes for venues whose common stocks and ETFs this version
// supports: NYSE, Nasdaq (Global Select/Global/Capital), NYSE Arca, NYSE American,
// and Cboe/BATS. Anything else (notably PNK/OTC ADRs) is out of scope.
const ACCEPTED_US_EXCHANGES = new Set([
  'NYQ', // NYSE
  'NMS', // Nasdaq Global Select
  'NGM', // Nasdaq Global Market
  'NCM', // Nasdaq Capital Market
  'NAS', // Nasdaq (legacy code)
  'PCX', // NYSE Arca
  'ASE', // NYSE American
  'BATS', // Cboe BZX / BATS
  'BTS',
]);

const DIVIDEND_COVERAGE_MESSAGE =
  'Reliable dividend coverage is unavailable for the complete selected period. ' +
  'The dividend history reported by our providers does not agree across the full ' +
  'requested range, so InvestIQ will not run a DCA backtest on incomplete income data.';

type MassiveCacheEntry = {
  expiresAt: number;
  payload: unknown;
  /** Body bytes read for this page, so a cache hit accounts the same size as a fresh read. */
  byteLength: number;
};

export type MarketDataOptions = {
  ticker: string;
  from: string;
  to: string;
  requiredStart: string;
  /**
   * Purpose of the request. `dca` requires strict, cross-checked income and
   * corporate-action coverage (and therefore Massive). `analysis` computes
   * price-return analytics and does not request dividends. An omitted or
   * unrecognized value fails safe to `dca` — the strict path — so a missing
   * mode can never bypass the strict requirements.
   */
  mode: MarketDataMode;
};

export type PriceBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /**
   * Vendor-adjusted close aligned to this completed session. A total-return proxy
   * only; never used for DCA execution. Present only when the whole aligned axis was
   * valid (see `totalReturnCoverage`).
   */
  adjustedClose?: number;
  /** Daily share volume when the data source supplies it. */
  volume?: number;
};

export type DividendEvent = {
  id: string;
  exDate: string;
  payDate: string;
  cashAmount: number;
  splitAdjustedCashAmount: number;
  distributionType: string;
  frequency: number;
};

export type SplitEvent = {
  id: string;
  executionDate: string;
  splitFrom: number;
  splitTo: number;
  adjustmentType: 'split' | 'reverse_split';
};

export type TickerChangeEvent = {
  date: string;
  ticker: string;
};

export type MarketData = {
  ticker: string;
  name: string;
  currency: string;
  locale: 'us';
  type: string;
  exchange?: string;
  exchangeName?: string;
  prices: PriceBar[];
  dividends: DividendEvent[];
  splits: SplitEvent[];
  tickerChanges: TickerChangeEvent[];
  /**
   * Honest provider attribution: `yahoo` when only Yahoo was read (price-only
   * analysis with no reported split), `hybrid` when Massive was actually queried
   * (any DCA run, or a split that needed independent verification). Demo data is
   * `demo` and never produced here.
   */
  source: 'yahoo' | 'hybrid';
  fetchedAt: string;
  provenance: DataProvenance;
};

type YahooQuote = {
  open?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  close?: Array<number | null>;
  volume?: Array<number | null>;
};

export type YahooSplit = {
  date?: number;
  denominator?: number;
  numerator?: number;
  splitRatio?: string;
};

export type YahooSplitClassification =
  | {
      supported: true;
      adjustmentType: 'split' | 'reverse_split';
      normalizedFrom: number;
      normalizedTo: number;
    }
  | { supported: false };

export type YahooDividend = {
  amount?: number;
  date?: number;
};

/** Ordinary dividend record parsed from the Yahoo chart, split-adjusted to current shares. */
export type YahooDividendRecord = {
  exDate: string;
  amount: number;
};

type YahooChartResult = {
  meta?: {
    currency?: string;
    exchangeName?: string;
    fullExchangeName?: string;
    exchangeTimezoneName?: string;
    instrumentType?: string;
    firstTradeDate?: number;
    longName?: string;
    shortName?: string;
  };
  timestamp?: number[];
  indicators?: {
    quote?: YahooQuote[];
    /** Aligned vendor-adjusted-close axis, requested via `includeAdjustedClose=true`. */
    adjclose?: Array<{ adjclose?: Array<number | null> }>;
  };
  events?: {
    dividends?: Record<string, YahooDividend>;
    splits?: Record<string, YahooSplit>;
    capitalGains?: Record<string, unknown>;
  };
};

type YahooChartResponse = {
  chart?: {
    result?: YahooChartResult[];
    error?: { code?: string; description?: string };
  };
};

type MassiveDividend = {
  id?: string;
  ex_dividend_date?: string;
  pay_date?: string;
  cash_amount?: number;
  split_adjusted_cash_amount?: number;
  distribution_type?: string;
  dividend_type?: string;
  frequency?: number;
};

export type MassiveSplit = {
  id?: string;
  execution_date?: string;
  split_from?: number;
  split_to?: number;
  ticker?: string;
  adjustment_type?: string;
};

type MassiveListResponse<T> = {
  status?: string;
  results?: T[];
  next_url?: string;
};

const massiveCache = new Map<string, MassiveCacheEntry>();

/** Minimal server environment slice, injected so the gates can be tested deterministically. */
export interface MarketDataEnv {
  MASSIVE_API_KEY?: string;
  VERCEL_ENV?: string;
  NODE_ENV?: string;
  MARKET_DATA_PUBLIC_DISPLAY_LICENSE_CONFIRMED?: string;
}

/** Honest per-purpose readiness. Price-only analysis needs no Massive key; DCA does. */
export interface MarketDataCapabilities {
  /** Yahoo price-return analytics. Available unless the production licensing gate blocks live data. */
  priceAnalysis: boolean;
  /** Cross-checked DCA income/corporate-action coverage. Needs Massive AND the licensing gate. */
  dca: boolean;
}

export function isMarketDataConfigured(env: MarketDataEnv = process.env): boolean {
  return Boolean(env.MASSIVE_API_KEY?.trim());
}

function isPublicDeployment(env: MarketDataEnv): boolean {
  // Production and preview URLs are both remotely accessible public-display
  // surfaces. Only Vercel development/local runtimes may remain ungated.
  if (env.VERCEL_ENV) return env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview';
  return env.NODE_ENV === 'production';
}

/**
 * Public-deployment licensing gate. The current live sources (Yahoo Finance, Massive)
 * carry redistribution/public-display restrictions, so a public production
 * deployment must not serve live or derived market data to end users unless the
 * operator has explicitly acknowledged — server-side only — that written rights
 * cover public end-user display and derived analytics for EVERY source. The flag
 * itself grants no rights; it only records that the operator confirmed they hold
 * them. Local development is ungated so personal credentials can be used for
 * private testing; remotely accessible Vercel previews fail closed too.
 */
export function isLiveMarketDataLicensed(env: MarketDataEnv = process.env): boolean {
  if (!isPublicDeployment(env)) return true;
  return env.MARKET_DATA_PUBLIC_DISPLAY_LICENSE_CONFIRMED === 'true';
}

/**
 * Separates the two capabilities so /api/health can report the truth: price
 * analysis stays ready without a Massive key (and must not force an overall 503),
 * while DCA is unavailable until Massive is configured. Both are additionally
 * gated by the production licensing acknowledgement. Never exposes key values.
 */
export function marketDataCapabilities(env: MarketDataEnv = process.env): MarketDataCapabilities {
  const licensed = isLiveMarketDataLicensed(env);
  return {
    priceAnalysis: licensed,
    dca: licensed && isMarketDataConfigured(env),
  };
}

export function validateMarketDataOptions(value: unknown): MarketDataOptions {
  if (!isRecord(value)) {
    throw publicError(400, 'Please review the ticker and selected dates.');
  }

  const ticker = typeof value.ticker === 'string' ? value.ticker.trim().toUpperCase() : '';
  const from = validDate(value.from);
  const to = validDate(value.to);
  const requiredStart = validDate(value.requiredStart);
  const mode = parseMode(value.mode);

  if (!TICKER_PATTERN.test(ticker) || !from || !to || !requiredStart) {
    throw publicError(400, 'Please review the ticker and selected dates.');
  }
  if (ticker === 'SPX') {
    throw publicError(
      422,
      'SPX is an index, not a purchasable US stock or ETF. Use an investable S&P 500 ETF such as SPY, VOO, or IVV.',
    );
  }
  if (from > to) {
    throw publicError(400, 'The start date cannot be later than the end date.');
  }
  if (from < '1900-01-01') {
    throw publicError(400, 'Historical market data is supported from 1900 onward.');
  }

  return { ticker, from, to, requiredStart, mode };
}

/**
 * Fails safe to the strict `dca` path. `analysis` must be requested explicitly;
 * an omitted or unrecognized mode can therefore never bypass strict DCA coverage.
 */
function parseMode(value: unknown): MarketDataMode {
  return value === 'analysis' ? 'analysis' : 'dca';
}

export async function loadMarketData(
  options: MarketDataOptions,
  now: Date = new Date(),
): Promise<MarketData> {
  // Fail closed before any provider work when a public production deployment has
  // not acknowledged the required public-display/redistribution rights. Demo mode
  // does not reach here, so the UI's synthetic preview keeps working.
  if (!isLiveMarketDataLicensed()) {
    throw publicError(503, 'Live market data is not available in this environment.');
  }
  const apiKey = process.env.MASSIVE_API_KEY?.trim();
  const isDca = options.mode === 'dca';
  // Only DCA needs Massive for income/corporate-action coverage. Price-return
  // analytics can run on the price series alone, so an absent key is not fatal
  // there — unless a reported split later needs independent verification.
  if (isDca && !apiKey) {
    throw publicError(503, 'Market data is temporarily unavailable.');
  }

  const ticker = options.ticker.toUpperCase();
  const encodedTicker = encodeURIComponent(ticker);
  // Keep vendor calls sequential. Free market-data plans have tight per-minute
  // limits, and a burst of dividend + split requests made valid portfolios look
  // like a server outage.
  const chart = await requestYahooChart(ticker, options.from, options.to);

  const meta = chart.meta ?? {};
  if (meta.currency !== 'USD' || meta.exchangeTimezoneName !== 'America/New_York') {
    throw publicError(422, 'This version supports US-listed securities only.');
  }
  assertSupportedExchange(meta, ticker);

  const type =
    meta.instrumentType === 'ETF'
      ? 'ETF'
      : meta.instrumentType === 'EQUITY'
        ? 'CS'
        : meta.instrumentType;
  if (!type || !['CS', 'ETF'].includes(type)) {
    throw publicError(
      422,
      `Only common stocks and ETFs are supported. ${ticker} is classified as ${type || 'unknown'}.`,
    );
  }

  assertNoUnsupportedCorporateActions(chart);

  // A split lookup is only necessary when Yahoo reports a split event that must
  // be independently verified. Without Massive we cannot verify it, so fail
  // closed rather than trust an unverified reorganization.
  const hasYahooSplits = Object.keys(chart.events?.splits ?? {}).length > 0;
  let splitResponse: MassiveListResponse<MassiveSplit> = { status: 'OK', results: [] };
  if (hasYahooSplits) {
    if (!apiKey) {
      throw publicError(
        422,
        `${ticker} reports a corporate split that InvestIQ cannot independently verify right now. Please try again later.`,
      );
    }
    splitResponse = await requestMassiveSplits(encodedTicker, options.from, options.to, apiKey);
  }
  const splits = parseYahooSplits(chart, splitResponse);

  // Strict, completion-aware parse: every provider timestamp must map to one
  // finite/safe timestamp with strictly ascending unique dates, and every COMPLETED
  // bar must be economically valid. Only a trailing in-progress current-session bar
  // (before the 16:15 ET threshold) is excluded — without requiring complete OHLC —
  // so a live chart during market hours no longer fails closed. Any other bad bar is
  // a controlled neutral 502, never a silently dropped completed session.
  const prices = parseYahooPrices(chart, now);
  if (prices.length === 0) {
    throw publicError(422, `${ticker} has no completed daily price history in the selected period.`);
  }

  let dividends: DividendEvent[] = [];
  let dividendCoverage: DataProvenance['dividendCoverage'] = 'not-requested';
  if (isDca) {
    const massiveDividends = await requestMassiveDividends(encodedTicker, apiKey as string);
    dividends = parseDividends(massiveDividends, options.from, options.to);
    // Cross-check the complete ordinary-dividend multiset against Yahoo for the
    // whole window. Yahoo is only the completeness gate; pay-date reinvestment
    // still uses Massive's pay dates.
    const yahooDividends = parseYahooDividends(chart, options.from, options.to);
    assertDividendCoverage(yahooDividends, dividends);
    dividendCoverage = 'cross-checked';
  }

  const firstTradeDate =
    typeof meta.firstTradeDate === 'number' && Number.isFinite(meta.firstTradeDate)
      ? new Date(meta.firstTradeDate * 1_000).toISOString().slice(0, 10)
      : undefined;
  if (
    firstTradeDate &&
    firstTradeDate <= options.requiredStart &&
    calendarDaysBetween(options.requiredStart, prices[0].date) > 7
  ) {
    throw publicError(
      422,
      `Reliable data is unavailable for the complete period beginning ${options.requiredStart}.`,
    );
  }

  // Massive is queried for any DCA run (dividends) and for any reported split that
  // needed independent verification. If neither happened, only Yahoo was read.
  const massiveUsed = isDca || hasYahooSplits;
  const fetchedAt = now.toISOString();
  // All-or-nothing: the vendor total-return proxy is available only when every
  // completed bar carried a valid aligned adjusted close.
  const totalReturnCoverage: DataProvenance['totalReturnCoverage'] = prices.every(
    (bar) => bar.adjustedClose !== undefined,
  )
    ? 'yahoo-adjusted-close'
    : 'unavailable';
  const provenance: DataProvenance = {
    priceProvider: 'yahoo',
    priceBasis: 'split-adjusted',
    lastCompletedSession: prices[prices.length - 1].date,
    fetchedAt,
    dividendCoverage,
    totalReturnCoverage,
    splitCoverage: hasYahooSplits ? 'cross-checked' : 'none-reported',
    reorganizationCoverage: 'provider-reported-only',
    mode: options.mode,
  };

  return {
    ticker,
    name: meta.longName || meta.shortName || ticker,
    currency: meta.currency,
    locale: 'us',
    type,
    exchange: meta.exchangeName,
    exchangeName: meta.fullExchangeName,
    prices,
    dividends,
    splits,
    tickerChanges: [],
    source: massiveUsed ? 'hybrid' : 'yahoo',
    fetchedAt,
    provenance,
  };
}

/**
 * Rejects venues outside this version's scope, notably PNK/OTC ADRs such as
 * RYCEY that still price in USD on New York time and would otherwise slip past
 * the currency/timezone gate.
 */
function assertSupportedExchange(
  meta: { exchangeName?: string; fullExchangeName?: string },
  ticker: string,
): void {
  const code = typeof meta.exchangeName === 'string' ? meta.exchangeName.toUpperCase() : '';
  if (ACCEPTED_US_EXCHANGES.has(code)) return;
  const venue = meta.fullExchangeName || meta.exchangeName || 'an unrecognized venue';
  throw publicError(
    422,
    `${ticker} is listed on ${venue}. InvestIQ supports US exchange-listed common stocks and ETFs; over-the-counter (OTC) and foreign-settlement securities are outside this version.`,
  );
}

async function requestMassiveDividends(
  encodedTicker: string,
  apiKey: string,
): Promise<MassiveDividend[]> {
  return requestMassiveList<MassiveDividend>(
    `/stocks/v1/dividends?ticker=${encodedTicker}&limit=5000&sort=ex_dividend_date.asc`,
    apiKey,
    '/stocks/v1/dividends',
    () => publicError(422, DIVIDEND_COVERAGE_MESSAGE),
  );
}

async function requestMassiveSplits(
  encodedTicker: string,
  from: string,
  to: string,
  apiKey: string,
): Promise<MassiveListResponse<MassiveSplit>> {
  const results = await requestMassiveList<MassiveSplit>(
    `/stocks/v1/splits?ticker=${encodedTicker}&execution_date.gte=${from}&execution_date.lte=${to}&limit=1000&sort=execution_date.asc`,
    apiKey,
    '/stocks/v1/splits',
    () => publicError(422, UNSUPPORTED_CORPORATE_ACTION_MESSAGE),
  );
  return { status: 'OK', results };
}

/**
 * Fetches a Massive list endpoint and follows `next_url` cursors under strict
 * bounds: every follow-up must stay on the exact Massive HTTPS origin and path,
 * total rows stay under the schema ceiling, the cumulative body bytes across all
 * pages stay under a fixed budget, and the page count is capped. A cursor that
 * points anywhere else — or a chain that never terminates or overflows any bound —
 * fails closed with the caller's coverage error (or a neutral 502) instead of
 * trusting a partial page or crawling an arbitrary provider URL.
 */
async function requestMassiveList<T>(
  initialPath: string,
  apiKey: string,
  expectedPathname: string,
  overflow: () => Error,
): Promise<T[]> {
  const results: T[] = [];
  let totalBytes = 0;
  let path: string = initialPath;
  for (let page = 0; page < MAX_MASSIVE_PAGES; page += 1) {
    const { payload, byteLength } = await requestMassive<MassiveListResponse<T>>(path, apiKey);
    // Cumulative budget across the whole cursor chain, not just per response, so a
    // long chain of individually-legal pages cannot accumulate ~100 MB.
    totalBytes += byteLength;
    if (totalBytes > MAX_MASSIVE_TOTAL_RESPONSE_BYTES) {
      throw publicError(502, 'The market-data provider returned more data than InvestIQ can verify.');
    }
    if (!Array.isArray(payload.results)) {
      throw publicError(502, 'The market-data provider returned an invalid response.');
    }
    results.push(...payload.results);
    if (results.length > MAX_MASSIVE_ROWS) {
      throw publicError(502, 'The market-data provider returned more records than InvestIQ can verify.');
    }
    if (!payload.next_url) return results;
    path = safeMassiveNextPath(payload.next_url, expectedPathname, overflow);
  }
  throw overflow();
}

function safeMassiveNextPath(
  nextUrl: string,
  expectedPathname: string,
  overflow: () => Error,
): string {
  let url: URL;
  try {
    url = new URL(nextUrl);
  } catch {
    throw overflow();
  }
  if (url.protocol !== 'https:' || url.origin !== MASSIVE_API_BASE || url.pathname !== expectedPathname) {
    throw overflow();
  }
  // requestMassive re-appends the API key; never carry a cursor-embedded one.
  url.searchParams.delete('apiKey');
  const search = url.searchParams.toString();
  return search ? `${url.pathname}?${search}` : url.pathname;
}

export function isSessionComplete(barDate: string, now: Date): boolean {
  const et = easternDateParts(now);
  if (barDate > et.date) return false; // never admit a future-dated bar
  if (barDate < et.date) return true; // any earlier ET calendar date is final
  return et.minutesSinceMidnight >= SESSION_CLOSE_GRACE_MINUTES;
}

function easternDateParts(now: Date): { date: string; minutesSinceMidnight: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutesSinceMidnight: Number(hour) * 60 + Number(get('minute')),
  };
}

/** Parses ordinary Yahoo chart dividend events (split-adjusted to current shares). */
export function parseYahooDividends(
  chart: YahooChartResult,
  from: string,
  to: string,
): YahooDividendRecord[] {
  const records: YahooDividendRecord[] = [];
  for (const dividend of Object.values(chart.events?.dividends ?? {})) {
    if (
      typeof dividend.date !== 'number' ||
      !Number.isSafeInteger(dividend.date) ||
      dividend.date <= 0
    ) {
      throw publicError(422, DIVIDEND_COVERAGE_MESSAGE);
    }
    const exDate = new Date(dividend.date * 1_000).toISOString().slice(0, 10);
    if (exDate < from || exDate > to) continue;
    if (
      typeof dividend.amount !== 'number' ||
      !Number.isFinite(dividend.amount) ||
      dividend.amount <= 0
    ) {
      throw publicError(422, DIVIDEND_COVERAGE_MESSAGE);
    }
    records.push({ exDate, amount: dividend.amount });
  }
  return records;
}

/**
 * Requires the complete ordinary-dividend multiset (ex-date + split-adjusted
 * amount) to agree between Yahoo and Massive across the full window. Same-date
 * duplicates are compared as a sorted multiset per date; any missing, extra, or
 * mismatched record fails closed. A security with no dividends in both sources
 * is valid.
 */
export function assertDividendCoverage(
  yahoo: YahooDividendRecord[],
  massive: DividendEvent[],
): void {
  const yahooByDate = groupAmounts(yahoo.map((record) => [record.exDate, record.amount]));
  const massiveByDate = groupAmounts(
    massive.map((record) => [record.exDate, record.splitAdjustedCashAmount]),
  );
  const dates = new Set([...yahooByDate.keys(), ...massiveByDate.keys()]);
  for (const date of dates) {
    const yahooAmounts = [...(yahooByDate.get(date) ?? [])].sort((a, b) => a - b);
    const massiveAmounts = [...(massiveByDate.get(date) ?? [])].sort((a, b) => a - b);
    if (yahooAmounts.length !== massiveAmounts.length) {
      throw publicError(422, DIVIDEND_COVERAGE_MESSAGE);
    }
    for (let index = 0; index < yahooAmounts.length; index += 1) {
      if (!amountsMatch(yahooAmounts[index], massiveAmounts[index])) {
        throw publicError(422, DIVIDEND_COVERAGE_MESSAGE);
      }
    }
  }
}

function groupAmounts(entries: Array<[string, number]>): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const [date, amount] of entries) {
    const list = map.get(date);
    if (list) list.push(amount);
    else map.set(date, [amount]);
  }
  return map;
}

function amountsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= DIVIDEND_AMOUNT_ABS_TOL;
}

async function requestMassive<T extends { status?: string; results?: unknown }>(
  path: string,
  apiKey: string,
): Promise<{ payload: T; byteLength: number }> {
  // The cache key is the API-key-free `path`; the credential is appended only to
  // the outbound URL below, never stored, logged, or surfaced in an error.
  const cached = massiveCache.get(path);
  if (cached && cached.expiresAt > Date.now()) {
    return { payload: cached.payload as T, byteLength: cached.byteLength };
  }

  const separator = path.includes('?') ? '&' : '?';
  // A single provider attempt. Automatically re-driving a 429 amplified one user
  // request into four upstream calls with multi-second waits, so a provider rate
  // limit is now surfaced honestly and immediately instead.
  const response = await fetch(
    `${MASSIVE_API_BASE}${path}${separator}apiKey=${encodeURIComponent(apiKey)}`,
    {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (response.status === 429) {
    throw publicError(
      429,
      'The market-data provider is rate-limited. Please wait one minute and run the backtest again.',
    );
  }
  if (!response.ok) {
    throw publicError(502, `Upstream market-data request failed (${response.status}).`);
  }

  const { value: payload, byteLength } = await readJsonFromResponseWithSize<T>(response, {
    maxBytes: MAX_MASSIVE_RESPONSE_BYTES,
    context: 'market-data provider',
  });

  if (payload.status === 'ERROR') {
    throw publicError(502, `Upstream market-data request failed (${response.status}).`);
  }
  if (Array.isArray(payload.results) && payload.results.length > MAX_MASSIVE_ROWS) {
    throw publicError(502, 'The market-data provider returned more records than InvestIQ can verify.');
  }

  if (massiveCache.size >= MAX_MASSIVE_CACHE_ENTRIES) {
    const oldestKey = massiveCache.keys().next().value as string | undefined;
    if (oldestKey) massiveCache.delete(oldestKey);
  }
  massiveCache.set(path, {
    expiresAt: Date.now() + MASSIVE_CACHE_TTL_MS,
    payload,
    byteLength,
  });
  return { payload, byteLength };
}

async function requestYahooChart(ticker: string, from: string, to: string): Promise<YahooChartResult> {
  const yahooTicker = ticker.replace('.', '-');
  const period1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1_000);
  const period2 = Math.floor(Date.parse(`${nextDay(to)}T00:00:00Z`) / 1_000);
  const query = new URLSearchParams({
    period1: String(period1),
    period2: String(period2),
    interval: '1d',
    events: 'div,splits,capitalGains',
    includeAdjustedClose: 'true',
  });
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?${query}`,
    {
      cache: 'no-store',
      headers: { Accept: 'application/json', 'User-Agent': 'InvestIQ/1.0' },
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (response.status === 404) {
    throw publicError(404, `US ticker ${ticker} was not found.`);
  }
  if (!response.ok) {
    throw publicError(502, `Yahoo price-history request failed (${response.status}).`);
  }

  const payload = await readJsonFromResponse<YahooChartResponse>(response, {
    maxBytes: MAX_YAHOO_RESPONSE_BYTES,
    context: 'price-history provider',
  });
  if (payload.chart?.error?.code === 'Not Found') {
    throw publicError(404, `US ticker ${ticker} was not found.`);
  }

  const result = payload.chart?.result?.[0];
  if (!result) {
    throw publicError(502, `Yahoo price-history request failed (${response.status}).`);
  }
  if ((result.timestamp?.length ?? 0) > MAX_YAHOO_BARS) {
    throw publicError(502, 'The price-history provider returned more sessions than InvestIQ can process.');
  }
  return result;
}

function assertNoUnsupportedCorporateActions(chart: YahooChartResult) {
  const hasCapitalGainDistribution = Object.keys(chart.events?.capitalGains ?? {}).length > 0;

  if (hasCapitalGainDistribution) {
    throw publicError(422, UNSUPPORTED_CORPORATE_ACTION_MESSAGE);
  }
}

/**
 * Strictly parses the Yahoo chart into the completed price bars, one per provider
 * timestamp, applying the completed-session rule against `now` so the boundary is
 * deterministic and testable (tests pass an explicit `now`).
 *
 * Fail-closed guarantees: every timestamp must be a finite, safe, positive epoch
 * second; every OHLC axis must be exactly aligned with the timestamp axis; dates
 * must be strictly ascending and unique; and every COMPLETED bar must be
 * economically valid (finite, strictly positive, high bracketing and low under the
 * other prices). Any violation throws a controlled neutral 502 — a completed bar is
 * never used-while-invalid nor silently dropped, because removing a session shifts
 * later indices and can roll a scheduled DCA purchase onto the wrong trading date.
 *
 * The single explicit exception is the current US session: a trailing bar dated
 * exactly today in America/New_York, before the 16:15 ET completion threshold, is
 * excluded WITHOUT requiring its OHLC to be complete (an in-progress bar legitimately
 * carries null/partial prices). At or after the threshold that same bar must be a
 * valid completed bar or it fails closed; a future-dated bar, a non-trailing
 * incomplete bar, an unsafe timestamp, or an out-of-order/duplicate date always
 * fails closed.
 *
 * Volume is supplementary: a missing or invalid volume is omitted without rejecting
 * the bar. An empty chart yields no bars; the caller treats an empty series as "no
 * data in period", not as a provider fault.
 *
 * The aligned vendor-adjusted-close axis is captured all-or-nothing as a total-return
 * proxy: one finite, positive adjusted close per completed session with exact axis
 * alignment. If the axis is missing, misaligned, or has any invalid completed value,
 * NO bar carries an adjusted close, so downstream total-return analytics fall back to
 * price return rather than ever mixing an adjusted close with a raw close. The adjusted
 * close is never used for DCA execution.
 */
export function parseYahooPrices(chart: YahooChartResult, now: Date = new Date()): PriceBar[] {
  const timestamps = chart.timestamp ?? [];
  const quote = chart.indicators?.quote?.[0] ?? {};
  if (timestamps.length === 0) return [];

  // Every OHLC axis must align 1:1 with the timestamp axis. A missing, short, or
  // long array means the timestamp->price mapping cannot be trusted.
  for (const key of ['open', 'high', 'low', 'close'] as const) {
    if ((quote[key]?.length ?? -1) !== timestamps.length) {
      throw publicError(502, 'The price-history provider returned misaligned OHLC data.');
    }
  }

  const adjCloseAxis = chart.indicators?.adjclose?.[0]?.adjclose;
  // The adjusted-close axis must exactly align with the timestamp axis to be usable.
  let adjustedCloseComplete = Array.isArray(adjCloseAxis) && adjCloseAxis.length === timestamps.length;
  const adjustedCloses: number[] = [];

  // Resolve the completion boundary once. This is the same rule as
  // `isSessionComplete` and shares SESSION_CLOSE_GRACE_MINUTES; it is inlined so the
  // ET parts are computed a single time rather than per bar.
  const et = easternDateParts(now);
  const thresholdPassed = et.minutesSinceMidnight >= SESSION_CLOSE_GRACE_MINUTES;

  const bars: PriceBar[] = [];
  let previousDate: string | undefined;
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index];
    if (typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp) || timestamp <= 0) {
      throw publicError(502, 'The price-history provider returned an invalid session timestamp.');
    }

    const date = new Date(timestamp * 1_000).toISOString().slice(0, 10);
    if (previousDate !== undefined && date <= previousDate) {
      throw publicError(502, 'The price-history provider returned an inconsistent session series.');
    }
    previousDate = date;

    const isCompleted = date < et.date || (date === et.date && thresholdPassed);
    if (!isCompleted) {
      // Not a completed session. Exactly one shape is tolerated: the trailing bar for
      // today's still-open session before the threshold, excluded without inspecting
      // its (possibly in-progress) OHLC. Everything else — a future-dated bar, or a
      // non-trailing incomplete bar — fails closed.
      if (date === et.date && index === timestamps.length - 1) continue;
      throw publicError(502, 'The price-history provider returned an out-of-range session bar.');
    }

    // A completed bar must be economically valid. A null/incomplete completed bar
    // (including a historical middle-null) is never used or silently dropped.
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    if (
      typeof open !== 'number' ||
      typeof high !== 'number' ||
      typeof low !== 'number' ||
      typeof close !== 'number' ||
      !isValidOhlcBar({ open, high, low, close })
    ) {
      throw publicError(502, 'The price-history provider returned an invalid or incomplete price bar.');
    }

    // Volume is supplementary: a bar with valid OHLC survives a missing or invalid volume.
    const volume = quote.volume?.[index];
    const hasVolume = typeof volume === 'number' && Number.isFinite(volume) && volume >= 0;
    bars.push({ date, open, high, low, close, ...(hasVolume ? { volume } : {}) });

    // Track this completed session's adjusted close. Any invalid value abandons the
    // whole axis so nothing is ever partially adjusted.
    if (adjustedCloseComplete) {
      const adjusted = adjCloseAxis?.[index];
      if (typeof adjusted === 'number' && Number.isFinite(adjusted) && adjusted > 0) {
        adjustedCloses.push(adjusted);
      } else {
        adjustedCloseComplete = false;
      }
    }
  }

  // Attach adjusted closes only when every completed bar had a valid one.
  if (adjustedCloseComplete && adjustedCloses.length === bars.length) {
    for (let index = 0; index < bars.length; index += 1) {
      bars[index].adjustedClose = adjustedCloses[index];
    }
  }
  return bars;
}

function parseDividends(
  results: MassiveDividend[],
  from: string,
  to: string,
): DividendEvent[] {
  if (results.some((item) => !validDate(item.ex_dividend_date))) {
    throw publicError(422, UNSUPPORTED_CORPORATE_ACTION_MESSAGE);
  }

  const relevant = results.filter(
    (item) =>
      typeof item.ex_dividend_date === 'string' &&
      item.ex_dividend_date >= from &&
      item.ex_dividend_date <= to,
  );

  return relevant.map((item, index) => {
    const exDate = validDate(item.ex_dividend_date);
    const payDate = validDate(item.pay_date);
    const distributionType = item.distribution_type ?? item.dividend_type ?? 'recurring';
    const normalizedType = distributionType.toLowerCase().replace(/[\s-]+/g, '_');
    const isKnownSpecialDistribution =
      item.frequency === 0 ||
      ['sc', 'lt', 'st'].includes(normalizedType) ||
      normalizedType.includes('special') ||
      normalizedType.includes('non_recurring') ||
      normalizedType.includes('capital_gain') ||
      normalizedType.includes('return_of_capital');
    const cashAmount = item.cash_amount ?? item.split_adjusted_cash_amount;
    const splitAdjustedCashAmount = item.split_adjusted_cash_amount ?? item.cash_amount;

    if (
      !exDate ||
      !payDate ||
      typeof item.frequency !== 'number' ||
      typeof cashAmount !== 'number' ||
      !Number.isFinite(cashAmount) ||
      cashAmount <= 0 ||
      typeof splitAdjustedCashAmount !== 'number' ||
      !Number.isFinite(splitAdjustedCashAmount) ||
      splitAdjustedCashAmount <= 0 ||
      isKnownSpecialDistribution
    ) {
      throw publicError(422, UNSUPPORTED_CORPORATE_ACTION_MESSAGE);
    }

    return {
      id: item.id || `massive-dividend-${exDate}-${index}`,
      exDate,
      payDate,
      cashAmount,
      splitAdjustedCashAmount,
      distributionType,
      frequency: item.frequency,
    };
  });
}

function parseYahooSplits(
  chart: YahooChartResult,
  payload: MassiveListResponse<MassiveSplit>,
): SplitEvent[] {
  if (!Array.isArray(payload.results)) {
    throw publicError(502, 'Split verification returned an invalid response.');
  }

  const yahooSplits = Object.values(chart.events?.splits ?? {});
  if (!areYahooSplitsVerified(yahooSplits, payload.results)) {
    throw publicError(422, UNSUPPORTED_CORPORATE_ACTION_MESSAGE);
  }

  return yahooSplits.map((item) => {
    const classification = classifyYahooSplit(item);
    if (typeof item.date !== 'number' || !Number.isFinite(item.date) || !classification.supported) {
      throw publicError(422, UNSUPPORTED_CORPORATE_ACTION_MESSAGE);
    }
    return {
      id: `yahoo-split-${item.date}`,
      executionDate: new Date(item.date * 1_000).toISOString().slice(0, 10),
      splitFrom: classification.normalizedFrom,
      splitTo: classification.normalizedTo,
      adjustmentType: classification.adjustmentType,
    };
  });
}

/**
 * Requires Yahoo's price-adjustment event and Massive's dedicated split record
 * to agree exactly. Massive intentionally returns no split record for AT&T's
 * 2022 WarnerMedia/WBD separation, so Yahoo's synthetic 1324:1000 event cannot
 * pass as an ordinary split even if upstream event labels change later.
 */
export function areYahooSplitsVerified(
  yahooSplits: YahooSplit[],
  massiveSplits: MassiveSplit[],
): boolean {
  const yahooKeys = yahooSplits.map(yahooSplitKey);
  const massiveKeys = massiveSplits.map(massiveSplitKey);
  if (yahooKeys.some((key) => !key) || massiveKeys.some((key) => !key)) return false;
  if (yahooKeys.length !== massiveKeys.length) return false;

  const yahooSet = new Set(yahooKeys as string[]);
  const massiveSet = new Set(massiveKeys as string[]);
  return (
    yahooSet.size === yahooKeys.length &&
    massiveSet.size === massiveKeys.length &&
    [...yahooSet].every((key) => massiveSet.has(key))
  );
}

function yahooSplitKey(item: YahooSplit): string | undefined {
  if (
    typeof item.date !== 'number' ||
    !Number.isSafeInteger(item.date) ||
    item.date <= 0
  ) {
    return undefined;
  }
  const classification = classifyYahooSplit(item);
  if (!classification.supported) return undefined;
  const date = new Date(item.date * 1_000).toISOString().slice(0, 10);
  return splitKey(
    date,
    classification.normalizedFrom,
    classification.normalizedTo,
    classification.adjustmentType,
  );
}

function massiveSplitKey(item: MassiveSplit): string | undefined {
  const executionDate = validDate(item.execution_date);
  const adjustmentType = item.adjustment_type;
  if (
    !executionDate ||
    !['forward_split', 'reverse_split', 'stock_dividend'].includes(adjustmentType ?? '')
  ) {
    return undefined;
  }

  const classification = classifyYahooSplit({
    numerator: item.split_to,
    denominator: item.split_from,
  });
  if (!classification.supported) return undefined;
  // Alphabet and similar issuers can legally effect an ordinary integer split
  // as a stock dividend. Fractional stock dividends remain unsupported.
  if (
    adjustmentType === 'stock_dividend' &&
    (classification.adjustmentType !== 'split' || classification.normalizedFrom !== 1)
  ) {
    return undefined;
  }
  const expectedType = adjustmentType === 'reverse_split' ? 'reverse_split' : 'split';
  if (classification.adjustmentType !== expectedType) return undefined;

  return splitKey(
    executionDate,
    classification.normalizedFrom,
    classification.normalizedTo,
    classification.adjustmentType,
  );
}

function splitKey(
  date: string,
  splitFrom: number,
  splitTo: number,
  adjustmentType: 'split' | 'reverse_split',
): string {
  return `${date}:${splitFrom}:${splitTo}:${adjustmentType}`;
}

/**
 * Yahoo sometimes exposes an in-kind spin-off/reorganization as a synthetic
 * split. AT&T's 2022 WarnerMedia/WBD separation is the known example: Yahoo
 * emits 1324:1000 (331:250 after reduction) on 2022-04-11, while Massive's
 * dedicated split endpoint correctly has no corresponding ordinary split.
 *
 * We therefore accept integer-to-one splits of any size and only small,
 * familiar fractional ratios such as 3:2 or 5:4. Higher-complexity fractions
 * fail closed because they cannot be distinguished reliably from an
 * unsupported distribution using these upstream responses alone.
 */
export function classifyYahooSplit(item: YahooSplit): YahooSplitClassification {
  const numerator = item.numerator;
  const denominator = item.denominator;
  if (
    typeof numerator !== 'number' ||
    typeof denominator !== 'number' ||
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator <= 0 ||
    denominator <= 0 ||
    numerator === denominator
  ) {
    return { supported: false };
  }

  if (item.splitRatio !== undefined && !splitRatioMatches(item.splitRatio, numerator, denominator)) {
    return { supported: false };
  }

  const divisor = greatestCommonDivisor(numerator, denominator);
  const normalizedTo = numerator / divisor;
  const normalizedFrom = denominator / divisor;
  const isIntegerRatio = normalizedTo === 1 || normalizedFrom === 1;
  const isSimpleFraction = normalizedTo <= 20 && normalizedFrom <= 20;
  if (!isIntegerRatio && !isSimpleFraction) return { supported: false };

  return {
    supported: true,
    adjustmentType: normalizedTo > normalizedFrom ? 'split' : 'reverse_split',
    normalizedFrom,
    normalizedTo,
  };
}

function splitRatioMatches(value: string, numerator: number, denominator: number): boolean {
  const match = /^(\d+):(\d+)$/.exec(value.trim());
  return Boolean(match && Number(match[1]) === numerator && Number(match[2]) === denominator);
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function validDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return undefined;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString().slice(0, 10) === value ? value : undefined;
}

function nextDay(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function calendarDaysBetween(from: string, to: string): number {
  return Math.floor(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
