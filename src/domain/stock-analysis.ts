// Purpose: Pure Stock Analysis view-model builder — turns one symbol's market data into the
// price series, risk figures, benchmark relationship, and volume summary the workspace renders.
//
// Scope and conventions:
// - Only `close` is read, so every return here is a price return: dividends are intentionally
//   excluded and totals understate total return. Closes are expected to be split-adjusted.
// - Every rate, return, and drawdown is a decimal fraction (0.05 is +5%, -0.2 is a 20% drawdown).
//   Nothing here converts to percent, rounds for display, or formats.
// - Deterministic: no clock, no randomness, no I/O. The risk-free rate is always supplied by
//   the caller, never assumed.
// - `undefined` means "not computable from this data", never zero. A short history yields
//   missing metrics rather than invented ones.
// - The drawdown scenario restates what already happened to a hypothetical amount. It is an
//   educational illustration, not a forecast and not investment advice.

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
  simpleMovingAverages,
  validatePriceSeries,
} from '@/domain/analytics';
import type { DatedValue, MaxDrawdownResult, MovingAverageSeries } from '@/domain/analytics';
import type { DateString, MarketData, PriceBar } from '@/types/backtest';
import { daysBetween } from '@/utils/date';

/** Moving-average windows the Stock Analysis chart overlays, in display order. */
export const MOVING_AVERAGE_WINDOWS = [50, 200] as const;

/** Sessions averaged for the volume baseline. */
export const VOLUME_AVERAGE_WINDOW = 20;

/** How much of the calculated history the view model covers. */
export interface HistoryCoverage {
  firstDate: DateString;
  lastDate: DateString;
  /** Number of trading bars supplied, not calendar days. */
  barCount: number;
  /** Calendar days from the first bar to the last; 0 for a single bar. */
  calendarDays: number;
  /** `calendarDays` expressed in years, for labelling how long the window is. */
  years: number;
}

export interface BenchmarkComparison {
  /** Benchmark ticker as supplied, normally SPY. */
  symbol: string;
  /** Trading days present in both return series; the only days beta and correlation use. */
  overlappingDays: number;
  /** Undefined with fewer than two overlapping days or a flat benchmark. */
  beta?: number;
  /** Undefined with fewer than two overlapping days or a flat series. */
  correlation?: number;
}

export interface VolumeSummary {
  /** One point per bar that reported a finite, non-negative volume; bars without one are dropped. */
  points: DatedValue[];
  /** Volume on the most recent bar that reported one. */
  latest?: number;
  /**
   * Mean of the last `VOLUME_AVERAGE_WINDOW` reporting bars. Undefined with fewer than that
   * many, because averaging a shorter run and calling it a 20-session figure would mislabel it.
   */
  averageVolume?: number;
  /** True when no bar reported a usable volume, so the view must hide volume entirely. */
  unavailable: boolean;
}

export interface StockAnalysisViewModel {
  ticker: string;
  name: string;
  currency: string;
  /** Split-adjusted close on `latestDate`. */
  latestClose: number;
  latestDate: DateString;
  history: HistoryCoverage;
  /** Cumulative price return from the first bar, which is always 0. */
  cumulativeReturns: DatedValue[];
  /** Close-to-close daily price returns; n bars yield n-1 points. */
  dailyReturns: DatedValue[];
  /** 50- and 200-session simple moving averages, each emitted only once its window is full. */
  movingAverages: MovingAverageSeries[];
  /** Compound annual growth rate of price; undefined with one bar or no elapsed time. */
  cagr?: number;
  /** Annualized volatility of daily price returns; undefined with fewer than two returns. */
  volatility?: number;
  /** Annualized Sharpe ratio against `annualRiskFreeRate`; undefined when volatility is zero. */
  sharpeRatio?: number;
  /** Worst close-to-close decline; the fraction is always present, the dates only if it declined. */
  maxDrawdown: MaxDrawdownResult;
  /** Absent when the caller supplied no benchmark. */
  benchmark?: BenchmarkComparison;
  /** Dividend events with an ex-date inside the covered window; price returns exclude them. */
  dividendCount: number;
  /** Split events executed inside the covered window; closes are already adjusted for them. */
  splitCount: number;
  volume: VolumeSummary;
  /** Echoed so the view can state which risk-free rate the Sharpe ratio used. */
  annualRiskFreeRate: number;
}

export interface StockAnalysisRequest {
  marketData: MarketData;
  /** Benchmark to measure beta and correlation against, normally SPY. */
  benchmark?: MarketData;
  /** Annual risk-free rate as a decimal fraction; required, never defaulted. */
  annualRiskFreeRate: number;
}

/**
 * Builds the Stock Analysis view model from one symbol's end-of-day data.
 *
 * Throws `AnalyticsError` when the price series cannot support return math, when a supplied
 * benchmark's series cannot either, or when the risk-free rate is not a finite number above -1.
 * Metrics that the history is too short to support come back undefined rather than zero.
 */
export function buildStockAnalysis(request: StockAnalysisRequest): StockAnalysisViewModel {
  const { marketData, benchmark, annualRiskFreeRate } = request;
  validateRiskFreeRate(annualRiskFreeRate);

  const bars = marketData.prices;
  validatePriceSeries(bars);

  const first = bars[0];
  const last = bars[bars.length - 1];
  const dailyReturns = dailyCloseReturns(bars);
  const calendarDays = daysBetween(first.date, last.date);

  return {
    ticker: marketData.ticker,
    name: marketData.name,
    currency: marketData.currency,
    latestClose: last.close,
    latestDate: last.date,
    history: {
      firstDate: first.date,
      lastDate: last.date,
      barCount: bars.length,
      calendarDays,
      years: calendarDays / CALENDAR_DAYS_PER_YEAR,
    },
    cumulativeReturns: cumulativePriceReturns(bars),
    dailyReturns,
    movingAverages: simpleMovingAverages(bars, [...MOVING_AVERAGE_WINDOWS]),
    cagr: compoundAnnualGrowthRate(bars),
    volatility: annualizedVolatility(dailyReturns),
    sharpeRatio: annualizedSharpeRatio(dailyReturns, annualRiskFreeRate),
    maxDrawdown: maxCloseDrawdown(bars),
    benchmark: benchmark && compareToBenchmark(dailyReturns, benchmark),
    dividendCount: marketData.dividends.filter((event) =>
      isWithin(event.exDate, first.date, last.date),
    ).length,
    splitCount: marketData.splits.filter((event) =>
      isWithin(event.executionDate, first.date, last.date),
    ).length,
    volume: summarizeVolume(bars),
    annualRiskFreeRate,
  };
}

/**
 * Beta and correlation against a benchmark, using only the trading days both series share,
 * so a shorter listing history or a mismatched holiday never pairs unrelated days.
 */
export function compareToBenchmark(
  dailyReturns: DatedValue[],
  benchmark: MarketData,
): BenchmarkComparison {
  validatePriceSeries(benchmark.prices);
  const benchmarkReturns = dailyCloseReturns(benchmark.prices);
  const benchmarkDates = new Set(benchmarkReturns.map((point) => point.date));

  return {
    symbol: benchmark.ticker,
    overlappingDays: dailyReturns.filter((point) => benchmarkDates.has(point.date)).length,
    beta: beta(dailyReturns, benchmarkReturns),
    correlation: correlation(dailyReturns, benchmarkReturns),
  };
}

/**
 * Volume series built only from bars that actually reported one. A missing, non-finite, or
 * negative volume is dropped rather than read as zero, because zero volume is a real and
 * different observation from "the data source sent nothing".
 */
export function summarizeVolume(bars: PriceBar[]): VolumeSummary {
  const points: DatedValue[] = [];
  for (const bar of bars) {
    if (bar.volume === undefined || !Number.isFinite(bar.volume) || bar.volume < 0) continue;
    points.push({ date: bar.date, value: bar.volume });
  }

  if (points.length === 0) {
    return { points, unavailable: true };
  }

  const window = points.slice(-VOLUME_AVERAGE_WINDOW);
  return {
    points,
    latest: points[points.length - 1].value,
    averageVolume:
      window.length === VOLUME_AVERAGE_WINDOW
        ? window.reduce((total, point) => total + point.value, 0) / VOLUME_AVERAGE_WINDOW
        : undefined,
    unavailable: false,
  };
}

/** What a hypothetical amount became at the worst historical trough. */
export interface DrawdownScenario {
  /** The starting amount the caller asked about. */
  amount: number;
  /** What the amount was worth at the trough: `amount * (1 + drawdown)`. */
  troughValue: number;
  /** Distance from `amount` down to `troughValue`, as a non-positive number. */
  decline: number;
  /** The drawdown this scenario restates, as a non-positive fraction. */
  drawdown: number;
  peakDate?: DateString;
  troughDate?: DateString;
  recoveryDate?: DateString;
}

/**
 * Restates an already-measured maximum drawdown in dollars, so a reader can see that a 20%
 * decline turned 10,000 into 8,000. It reports what this history did to that amount and
 * nothing more: no projection, no recommendation, no claim about what happens next.
 *
 * Throws `AnalyticsError` when the amount is not a finite positive number or when the
 * drawdown is not a fraction in (-1, 0].
 */
export function describeDrawdownScenario(
  maxDrawdown: MaxDrawdownResult,
  amount: number,
): DrawdownScenario {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AnalyticsError('A drawdown scenario amount must be a finite positive number.');
  }
  const { drawdown } = maxDrawdown;
  if (!Number.isFinite(drawdown) || drawdown > 0 || drawdown <= -1) {
    throw new AnalyticsError('A drawdown must be a fraction greater than -1 and at most 0.');
  }

  const troughValue = amount * (1 + drawdown);
  return {
    amount,
    troughValue,
    decline: troughValue - amount,
    drawdown,
    peakDate: maxDrawdown.peakDate,
    troughDate: maxDrawdown.troughDate,
    recoveryDate: maxDrawdown.recoveryDate,
  };
}

// --- Internal helpers -------------------------------------------------------

function validateRiskFreeRate(rate: number): void {
  if (!Number.isFinite(rate) || rate <= -1) {
    throw new AnalyticsError('The annual risk-free rate must be a finite number greater than -1.');
  }
}

function isWithin(date: DateString, firstDate: DateString, lastDate: DateString): boolean {
  return date >= firstDate && date <= lastDate;
}
