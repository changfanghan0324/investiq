// Purpose: Pure Stock Comparison view-model builder — aligns two to five securities onto the
// trading dates they all share and recalculates every figure on that one common window.
//
// Scope and conventions:
// - Only `close` is read, so every return here is a price return: dividends are intentionally
//   excluded and totals understate total return. Closes are expected to be split-adjusted.
// - Every rate, return, and drawdown is a decimal fraction (0.05 is +5%, -0.2 is a 20% drawdown).
//   Nothing here converts to percent, rounds for display, or formats.
// - Deterministic: no clock, no randomness, no I/O. The risk-free rate is always supplied by
//   the caller, never assumed. Ties resolve alphabetically so the same input always compares
//   the same way.
// - A comparison is only honest if every security is measured over the same bars. One security
//   listing later, or missing a session, shortens the window for all of them; nothing is
//   back-filled, carried forward, or read as a zero return.
// - `undefined` means "not computable from this data", never zero.
// - The narrative reports which security had the highest historical CAGR and the lowest
//   historical volatility over this window, and only that. It never ranks a security as best,
//   never says what to buy, and never forecasts.

import {
  AnalyticsError,
  CALENDAR_DAYS_PER_YEAR,
  annualizedSharpeRatio,
  annualizedVolatility,
  beta,
  compoundAnnualGrowthRate,
  correlation,
  cumulativePriceReturns,
  dailyCloseReturns,
  maxCloseDrawdown,
  validatePriceSeries,
} from '@/domain/analytics';
import type { DatedValue, MaxDrawdownResult } from '@/domain/analytics';
import type { DateString, MarketData, PriceBar } from '@/types/backtest';
import { daysBetween } from '@/utils/date';

/** Fewer than two securities is not a comparison. */
export const MIN_COMPARISON_SECURITIES = 2;

/** Above five the chart legend and correlation grid stop being readable. */
export const MAX_COMPARISON_SECURITIES = 5;

/**
 * Common closes required before anything is reported. Three closes yield two daily returns,
 * the minimum for a sample standard deviation, so a shorter overlap can only produce
 * risk figures that look real without being computable.
 */
export const MIN_COMMON_CLOSES = 3;

/** One security as it entered the comparison, before alignment shortened it. */
export interface SuppliedSeries {
  /** Ticker uppercased and trimmed; the identity used everywhere downstream. */
  symbol: string;
  name: string;
  /** Instrument type as the data source classified it, for example `CS` or `ETF`. */
  type: string;
  currency: string;
  source: 'hybrid' | 'demo';
  /** Bars the caller supplied, not bars used. */
  suppliedBars: number;
  suppliedFirstDate: DateString;
  suppliedLastDate: DateString;
}

/** One security measured entirely on the common window. */
export interface ComparedSecurity extends SuppliedSeries {
  /** Common closes used; identical for every security in the comparison. */
  sessions: number;
  /** Close on the first common date. */
  firstClose: number;
  /** Close on the last common date. */
  lastClose: number;
  /** Cumulative price return rebased to 0 on the first common date. */
  cumulativeReturns: DatedValue[];
  /** Close-to-close returns between consecutive common dates; n sessions yield n-1 points. */
  dailyReturns: DatedValue[];
  /** Price return across the whole common window. */
  totalPriceReturn: number;
  /** Compound annual growth rate over the common window; undefined when no time elapsed. */
  cagr?: number;
  /** Annualized volatility of the aligned daily returns; 0 for a series that never moved. */
  volatility?: number;
  /** Annualized Sharpe ratio over the common window; undefined when volatility is zero. */
  sharpeRatio?: number;
  /** Worst close-to-close decline inside the common window only. */
  maxDrawdown: MaxDrawdownResult;
  /** Beta against the benchmark, from the common dates the benchmark also traded. */
  beta?: number;
}

/** The exact date range every security shares. */
export interface CommonWindow {
  startDate: DateString;
  endDate: DateString;
  /** Number of common trading sessions. */
  sessions: number;
  /** Every common date, ascending. */
  dates: DateString[];
  calendarDays: number;
  /** `calendarDays` expressed in years, for labelling the window length. */
  years: number;
  /** Securities whose own history begins on `startDate`, so the window starts no earlier. */
  startLimitedBy: string[];
  /** Securities whose own history ends on `endDate`, so the window ends no later. */
  endLimitedBy: string[];
}

export interface ComparisonBenchmark {
  symbol: string;
  name: string;
  type: string;
  /** Common sessions the benchmark also traded; the only sessions beta uses. */
  overlappingSessions: number;
  /** First common session the benchmark also traded. */
  startDate?: DateString;
  /** Last common session the benchmark also traded. */
  endDate?: DateString;
  /** True when the benchmark traded on every common session. */
  coversCommonWindow: boolean;
}

/**
 * Pearson correlations of the aligned daily price returns. `symbols` fixes the row and column
 * order, `values` is symmetric, the diagonal is 1 wherever a correlation exists at all, and any
 * cell that is not mathematically available is undefined rather than 0.
 */
export interface CorrelationMatrix {
  symbols: string[];
  values: (number | undefined)[][];
}

/** Codes the view translates through `t()`; no user-visible prose is produced here. */
export type ComparisonNoteCode =
  | 'price-return-only'
  | 'not-investment-advice'
  | 'common-window-shortened'
  | 'benchmark-unavailable'
  | 'benchmark-partial-overlap'
  | 'cagr-not-comparable'
  | 'volatility-not-comparable';

/** An observed extreme, with every security that matched it exactly. */
export interface ComparisonExtreme {
  /** Alphabetically first of `tiedSymbols`, so a tie always resolves the same way. */
  symbol: string;
  value: number;
  /** Every security sharing `value` exactly, ascending; a single entry means no tie. */
  tiedSymbols: string[];
}

/**
 * What this window did, stated neutrally. Extremes appear only when every security produced
 * the metric, because naming a leader out of a partial field would misdescribe the field.
 */
export interface ComparisonNarrative {
  symbols: string[];
  startDate: DateString;
  endDate: DateString;
  sessions: number;
  /** Highest historical CAGR over the common window; absent when a security lacks one. */
  highestCagr?: ComparisonExtreme;
  /** Lowest historical volatility over the common window; absent when a security lacks one. */
  lowestVolatility?: ComparisonExtreme;
  notes: ComparisonNoteCode[];
}

export interface StockComparisonViewModel {
  /** Securities in the order supplied, each measured on the common window. */
  securities: ComparedSecurity[];
  commonWindow: CommonWindow;
  correlations: CorrelationMatrix;
  /** Absent when the caller supplied no benchmark. */
  benchmark?: ComparisonBenchmark;
  narrative: ComparisonNarrative;
  /** Echoed so the view can state which risk-free rate the Sharpe ratios used. */
  annualRiskFreeRate: number;
  /** Always true: every figure here is a price return. */
  excludesDividends: true;
}

export interface StockComparisonRequest {
  /** Two to five securities; tickers are compared case-insensitively. */
  securities: MarketData[];
  /** Benchmark for beta, normally SPY. */
  benchmark?: MarketData;
  /** Annual risk-free rate as a decimal fraction; required, never defaulted. */
  annualRiskFreeRate: number;
}

/**
 * Builds the Stock Comparison view model.
 *
 * Throws `AnalyticsError` when the security count is outside 2–5, when two entries name the same
 * ticker, when any price series is empty or cannot support return math, when the securities share
 * fewer than `MIN_COMMON_CLOSES` trading dates, or when the risk-free rate is not a finite number
 * above -1. Metrics the common window is too short to support come back undefined, never zero.
 */
export function buildStockComparison(request: StockComparisonRequest): StockComparisonViewModel {
  const { securities, benchmark, annualRiskFreeRate } = request;
  validateRiskFreeRate(annualRiskFreeRate);

  const supplied = normalizeSecurities(securities);
  const commonDates = commonTradingDates(supplied.map((entry) => entry.data.prices));
  if (commonDates.length < MIN_COMMON_CLOSES) {
    throw new AnalyticsError(
      `A comparison needs at least ${MIN_COMMON_CLOSES} trading dates shared by every selected ` +
        `security; these share ${commonDates.length}.`,
    );
  }

  const commonDateSet = new Set(commonDates);
  const alignedBars = supplied.map((entry) => entry.data.prices.filter((bar) => commonDateSet.has(bar.date)));

  const benchmarkContext = benchmark && buildBenchmarkContext(benchmark, commonDates);

  const compared = supplied.map((entry, index) =>
    measureSecurity(entry, alignedBars[index], annualRiskFreeRate, benchmarkContext),
  );
  const commonWindow = describeCommonWindow(compared, commonDates);
  const benchmarkSummary = benchmarkContext?.summary;

  return {
    securities: compared,
    commonWindow,
    correlations: buildCorrelationMatrix(
      compared.map((security) => ({ symbol: security.symbol, returns: security.dailyReturns })),
    ),
    benchmark: benchmarkSummary,
    narrative: describeComparison(compared, commonWindow, benchmarkSummary),
    annualRiskFreeRate,
    excludesDividends: true,
  };
}

/**
 * Exact intersection of the trading dates in every series, ascending. A date missing from any
 * one series is dropped from all of them, so a holiday, a halt, or a later listing never pairs
 * one security's session against another security's different session.
 *
 * Returns an empty array when no series are supplied.
 */
export function commonTradingDates(seriesList: PriceBar[][]): DateString[] {
  if (seriesList.length === 0) return [];

  const dateSets = seriesList.map((series) => new Set(series.map((bar) => bar.date)));
  const [first, ...rest] = dateSets;
  return [...first]
    .filter((date) => rest.every((dates) => dates.has(date)))
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Symmetric Pearson correlation matrix of aligned daily price returns.
 *
 * The diagonal is 1 whenever the series can correlate at all; a series that never moved has no
 * correlation with anything, including itself, so its whole row and column are undefined rather
 * than a misleading 1 or 0. Each pair is computed once and mirrored, so the matrix cannot come
 * back asymmetric through floating-point drift.
 */
export function buildCorrelationMatrix(
  series: Array<{ symbol: string; returns: DatedValue[] }>,
): CorrelationMatrix {
  const size = series.length;
  const values: (number | undefined)[][] = series.map(() => new Array<number | undefined>(size).fill(undefined));

  for (let row = 0; row < size; row += 1) {
    // Self-correlation exists only when the series has spread; reuse that test for the diagonal.
    values[row][row] = correlation(series[row].returns, series[row].returns) === undefined ? undefined : 1;

    for (let column = row + 1; column < size; column += 1) {
      const coefficient = correlation(series[row].returns, series[column].returns);
      values[row][column] = coefficient;
      values[column][row] = coefficient;
    }
  }

  return { symbols: series.map((entry) => entry.symbol), values };
}

/**
 * Neutral summary of an already-measured comparison: the highest historical CAGR and the lowest
 * historical volatility over the shared window, plus the codes the view needs to disclose what
 * the figures do and do not cover.
 *
 * An extreme is reported only when every security produced that metric, so the reader never sees
 * a leader chosen from a partial field. No security is called best and nothing is recommended.
 */
export function describeComparison(
  securities: ComparedSecurity[],
  commonWindow: CommonWindow,
  benchmark?: ComparisonBenchmark,
): ComparisonNarrative {
  const highestCagr = findExtreme(securities, (security) => security.cagr, 'highest');
  const lowestVolatility = findExtreme(securities, (security) => security.volatility, 'lowest');

  const notes: ComparisonNoteCode[] = ['price-return-only', 'not-investment-advice'];
  if (securities.some((security) => security.suppliedBars > commonWindow.sessions)) {
    notes.push('common-window-shortened');
  }
  if (!benchmark) {
    notes.push('benchmark-unavailable');
  } else if (!benchmark.coversCommonWindow) {
    notes.push('benchmark-partial-overlap');
  }
  if (!highestCagr) notes.push('cagr-not-comparable');
  if (!lowestVolatility) notes.push('volatility-not-comparable');

  return {
    symbols: securities.map((security) => security.symbol),
    startDate: commonWindow.startDate,
    endDate: commonWindow.endDate,
    sessions: commonWindow.sessions,
    highestCagr,
    lowestVolatility,
    notes,
  };
}

// --- Internal helpers -------------------------------------------------------

interface NormalizedSecurity {
  symbol: string;
  data: MarketData;
}

interface BenchmarkContext {
  summary: ComparisonBenchmark;
  /** Common dates the benchmark also traded, ascending. */
  dates: Set<DateString>;
  /** Benchmark returns over those dates only, so both legs of beta span the same days. */
  returns: DatedValue[];
}

function normalizeSecurities(securities: MarketData[]): NormalizedSecurity[] {
  if (
    securities.length < MIN_COMPARISON_SECURITIES ||
    securities.length > MAX_COMPARISON_SECURITIES
  ) {
    throw new AnalyticsError(
      `A comparison needs between ${MIN_COMPARISON_SECURITIES} and ${MAX_COMPARISON_SECURITIES} ` +
        `securities; received ${securities.length}.`,
    );
  }

  const seen = new Set<string>();
  return securities.map((data) => {
    const symbol = data.ticker.trim().toUpperCase();
    if (seen.has(symbol)) {
      throw new AnalyticsError(`Security ${symbol} appears more than once in the comparison.`);
    }
    seen.add(symbol);

    if (data.prices.length === 0) {
      throw new AnalyticsError(`Security ${symbol} has no price history to compare.`);
    }
    validatePriceSeries(data.prices);

    return { symbol, data };
  });
}

function measureSecurity(
  entry: NormalizedSecurity,
  aligned: PriceBar[],
  annualRiskFreeRate: number,
  benchmarkContext?: BenchmarkContext,
): ComparedSecurity {
  const { symbol, data } = entry;
  const suppliedFirst = data.prices[0];
  const suppliedLast = data.prices[data.prices.length - 1];
  const first = aligned[0];
  const last = aligned[aligned.length - 1];
  const dailyReturns = dailyCloseReturns(aligned);

  return {
    symbol,
    name: data.name,
    type: data.type,
    currency: data.currency,
    source: data.source,
    suppliedBars: data.prices.length,
    suppliedFirstDate: suppliedFirst.date,
    suppliedLastDate: suppliedLast.date,
    sessions: aligned.length,
    firstClose: first.close,
    lastClose: last.close,
    cumulativeReturns: cumulativePriceReturns(aligned),
    dailyReturns,
    totalPriceReturn: last.close / first.close - 1,
    cagr: compoundAnnualGrowthRate(aligned),
    volatility: annualizedVolatility(dailyReturns),
    sharpeRatio: annualizedSharpeRatio(dailyReturns, annualRiskFreeRate),
    maxDrawdown: maxCloseDrawdown(aligned),
    beta: benchmarkContext && measureBeta(aligned, benchmarkContext),
  };
}

/**
 * Beta from the common dates the benchmark also traded. Both legs are rebuilt on that same date
 * set, so a session the benchmark missed never leaves the security's return spanning two days
 * against the benchmark's one.
 */
function measureBeta(aligned: PriceBar[], benchmarkContext: BenchmarkContext): number | undefined {
  const overlapping = aligned.filter((bar) => benchmarkContext.dates.has(bar.date));
  if (overlapping.length < 2) return undefined;
  return beta(dailyCloseReturns(overlapping), benchmarkContext.returns);
}

function buildBenchmarkContext(benchmark: MarketData, commonDates: DateString[]): BenchmarkContext {
  const symbol = benchmark.ticker.trim().toUpperCase();
  if (benchmark.prices.length === 0) {
    throw new AnalyticsError(`Benchmark ${symbol} has no price history to compare against.`);
  }
  validatePriceSeries(benchmark.prices);

  const benchmarkDates = new Set(benchmark.prices.map((bar) => bar.date));
  const overlappingDates = commonDates.filter((date) => benchmarkDates.has(date));
  const overlappingSet = new Set(overlappingDates);
  const overlappingBars = benchmark.prices.filter((bar) => overlappingSet.has(bar.date));

  return {
    summary: {
      symbol,
      name: benchmark.name,
      type: benchmark.type,
      overlappingSessions: overlappingDates.length,
      startDate: overlappingDates[0],
      endDate: overlappingDates[overlappingDates.length - 1],
      coversCommonWindow: overlappingDates.length === commonDates.length,
    },
    dates: overlappingSet,
    returns: overlappingBars.length < 2 ? [] : dailyCloseReturns(overlappingBars),
  };
}

function describeCommonWindow(
  securities: ComparedSecurity[],
  commonDates: DateString[],
): CommonWindow {
  const startDate = commonDates[0];
  const endDate = commonDates[commonDates.length - 1];
  const calendarDays = daysBetween(startDate, endDate);

  return {
    startDate,
    endDate,
    sessions: commonDates.length,
    dates: commonDates,
    calendarDays,
    years: calendarDays / CALENDAR_DAYS_PER_YEAR,
    startLimitedBy: securities
      .filter((security) => security.suppliedFirstDate === startDate)
      .map((security) => security.symbol),
    endLimitedBy: securities
      .filter((security) => security.suppliedLastDate === endDate)
      .map((security) => security.symbol),
  };
}

/**
 * The highest or lowest value of one metric across every security, or undefined when any
 * security is missing it. Ties keep every matching symbol and resolve alphabetically, so the
 * same input always names the same security.
 */
function findExtreme(
  securities: ComparedSecurity[],
  select: (security: ComparedSecurity) => number | undefined,
  direction: 'highest' | 'lowest',
): ComparisonExtreme | undefined {
  const candidates = securities.map((security) => ({ symbol: security.symbol, value: select(security) }));
  if (candidates.some((candidate) => candidate.value === undefined || !Number.isFinite(candidate.value))) {
    return undefined;
  }

  const values = candidates.map((candidate) => candidate.value as number);
  const value = direction === 'highest' ? Math.max(...values) : Math.min(...values);
  const tiedSymbols = candidates
    .filter((candidate) => candidate.value === value)
    .map((candidate) => candidate.symbol)
    .sort((left, right) => left.localeCompare(right));

  return { symbol: tiedSymbols[0], value, tiedSymbols };
}

function validateRiskFreeRate(rate: number): void {
  if (!Number.isFinite(rate) || rate <= -1) {
    throw new AnalyticsError('The annual risk-free rate must be a finite number greater than -1.');
  }
}
