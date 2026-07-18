import { publicError } from '@/server/errors';

const MASSIVE_API_BASE = 'https://api.massive.com';
const MASSIVE_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const MAX_MASSIVE_CACHE_ENTRIES = 500;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_PATTERN = /^[A-Z0-9.-]{1,12}$/;
const UNSUPPORTED_CORPORATE_ACTION_MESSAGE =
  'This stock contains a corporate action that is not yet supported.';

type MassiveCacheEntry = {
  expiresAt: number;
  payload: unknown;
};

export type MarketDataOptions = {
  ticker: string;
  from: string;
  to: string;
  requiredStart: string;
};

export type PriceBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
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
  prices: PriceBar[];
  dividends: DividendEvent[];
  splits: SplitEvent[];
  tickerChanges: TickerChangeEvent[];
  source: 'hybrid';
  fetchedAt: string;
};

type YahooQuote = {
  open?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  close?: Array<number | null>;
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

type YahooChartResult = {
  meta?: {
    currency?: string;
    exchangeTimezoneName?: string;
    instrumentType?: string;
    firstTradeDate?: number;
    longName?: string;
    shortName?: string;
  };
  timestamp?: number[];
  indicators?: { quote?: YahooQuote[] };
  events?: {
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
};

const massiveCache = new Map<string, MassiveCacheEntry>();

export function isMarketDataConfigured(): boolean {
  return Boolean(process.env.MASSIVE_API_KEY?.trim());
}

export function validateMarketDataOptions(value: unknown): MarketDataOptions {
  if (!isRecord(value)) {
    throw publicError(400, 'Please review the ticker and selected dates.');
  }

  const ticker = typeof value.ticker === 'string' ? value.ticker.trim().toUpperCase() : '';
  const from = validDate(value.from);
  const to = validDate(value.to);
  const requiredStart = validDate(value.requiredStart);

  if (!TICKER_PATTERN.test(ticker) || !from || !to || !requiredStart) {
    throw publicError(400, 'Please review the ticker and selected dates.');
  }
  if (from > to) {
    throw publicError(400, 'The start date cannot be later than the end date.');
  }
  if (from < '1900-01-01') {
    throw publicError(400, 'Historical market data is supported from 1900 onward.');
  }

  return { ticker, from, to, requiredStart };
}

export async function loadMarketData(options: MarketDataOptions): Promise<MarketData> {
  const apiKey = process.env.MASSIVE_API_KEY?.trim();
  if (!apiKey) {
    throw publicError(503, 'Market data is temporarily unavailable.');
  }

  const ticker = options.ticker.toUpperCase();
  const encodedTicker = encodeURIComponent(ticker);
  const [chart, dividendResponse, splitResponse] = await Promise.all([
    requestYahooChart(ticker, options.from, options.to),
    requestMassive<MassiveListResponse<MassiveDividend>>(
      `/stocks/v1/dividends?ticker=${encodedTicker}&limit=5000&sort=ex_dividend_date.asc`,
      apiKey,
    ),
    requestMassive<MassiveListResponse<MassiveSplit>>(
      `/stocks/v1/splits?ticker=${encodedTicker}&execution_date.gte=${options.from}&execution_date.lte=${options.to}&limit=1000&sort=execution_date.asc`,
      apiKey,
    ),
  ]);

  const meta = chart.meta ?? {};
  if (meta.currency !== 'USD' || meta.exchangeTimezoneName !== 'America/New_York') {
    throw publicError(422, 'This version supports US-listed securities only.');
  }

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
  const splits = parseYahooSplits(chart, splitResponse);
  const prices = parseYahooPrices(chart);
  const dividends = parseDividends(dividendResponse, options.from, options.to);

  if (prices.length === 0) {
    throw publicError(422, `${ticker} has no daily price history in the selected period.`);
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

  return {
    ticker,
    name: meta.longName || meta.shortName || ticker,
    currency: meta.currency,
    locale: 'us',
    type,
    prices,
    dividends,
    splits,
    tickerChanges: [],
    source: 'hybrid',
    fetchedAt: new Date().toISOString(),
  };
}

async function requestMassive<T>(path: string, apiKey: string): Promise<T> {
  const cached = massiveCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.payload as T;

  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(
    `${MASSIVE_API_BASE}${path}${separator}apiKey=${encodeURIComponent(apiKey)}`,
    {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as T & { status?: string };

  if (response.ok && payload.status !== 'ERROR') {
    if (massiveCache.size >= MAX_MASSIVE_CACHE_ENTRIES) {
      const oldestKey = massiveCache.keys().next().value as string | undefined;
      if (oldestKey) massiveCache.delete(oldestKey);
    }
    massiveCache.set(path, {
      expiresAt: Date.now() + MASSIVE_CACHE_TTL_MS,
      payload,
    });
    return payload;
  }
  if (response.status === 429) {
    throw publicError(429, 'The market-data service is busy. Please try again shortly.');
  }
  throw publicError(502, `Upstream market-data request failed (${response.status}).`);
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
      headers: { Accept: 'application/json', 'User-Agent': 'StockLensWeb/1.0' },
      signal: AbortSignal.timeout(30_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as YahooChartResponse;
  const result = payload.chart?.result?.[0];

  if (response.status === 404 || payload.chart?.error?.code === 'Not Found') {
    throw publicError(404, `US ticker ${ticker} was not found.`);
  }
  if (!response.ok || !result) {
    throw publicError(502, `Yahoo price-history request failed (${response.status}).`);
  }
  return result;
}

function assertNoUnsupportedCorporateActions(chart: YahooChartResult) {
  const hasCapitalGainDistribution = Object.keys(chart.events?.capitalGains ?? {}).length > 0;

  if (hasCapitalGainDistribution) {
    throw publicError(422, UNSUPPORTED_CORPORATE_ACTION_MESSAGE);
  }
}

function parseYahooPrices(chart: YahooChartResult): PriceBar[] {
  const quote = chart.indicators?.quote?.[0] ?? {};
  return (chart.timestamp ?? []).flatMap((timestamp, index) => {
    const values = [
      quote.open?.[index],
      quote.high?.[index],
      quote.low?.[index],
      quote.close?.[index],
    ];
    if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return [];

    return [
      {
        date: new Date(timestamp * 1_000).toISOString().slice(0, 10),
        open: values[0] as number,
        high: values[1] as number,
        low: values[2] as number,
        close: values[3] as number,
      },
    ];
  });
}

function parseDividends(
  payload: MassiveListResponse<MassiveDividend>,
  from: string,
  to: string,
): DividendEvent[] {
  if (!Array.isArray(payload.results)) {
    throw publicError(502, 'Dividend verification returned an invalid response.');
  }
  if (payload.results.some((item) => !validDate(item.ex_dividend_date))) {
    throw publicError(422, UNSUPPORTED_CORPORATE_ACTION_MESSAGE);
  }

  const relevant = payload.results.filter(
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
