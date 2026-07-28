// Purpose: Pure price-return analytics; risk, drawdown, correlation, and concentration math lives here.
//
// Scope and conventions:
// - Input bars are split-adjusted daily OHLC. Only `close` is read, so every figure here is a
//   price return: dividends are intentionally excluded and totals will understate total return.
// - Every rate, return, and drawdown is a decimal fraction (0.05 is +5%, -0.2 is a 20% drawdown).
//   Nothing in this module converts to percent, rounds for display, or formats.
// - Every function is deterministic: no clock, no randomness, no I/O.
// - `undefined` means "not computable from this data", never zero.
// - Concentration flags are educational diagnostics, not investment advice.

import type { DateString, PriceBar } from '@/types/backtest';
import { daysBetween } from '@/utils/date';

/** Trading days per year, used to annualize daily volatility and Sharpe. */
export const TRADING_DAYS_PER_YEAR = 252;

/** Average calendar days per year, including the leap-year quarter day, used for CAGR. */
export const CALENDAR_DAYS_PER_YEAR = 365.25;

/** How far portfolio weights may sum away from 1 before the input is rejected. */
export const WEIGHT_SUM_TOLERANCE = 1e-6;

/** A single holding above this weight raises an educational concentration flag. */
export const HOLDING_CONCENTRATION_THRESHOLD = 0.4;

/** A single sector above this weight raises an educational concentration flag. */
export const SECTOR_CONCENTRATION_THRESHOLD = 0.5;

/** Bucket for holdings that declare no sector; never flagged, only reported. */
export const UNCLASSIFIED_SECTOR = 'unclassified';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class AnalyticsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalyticsError';
  }
}

/** A value stamped with the trading date it belongs to. */
export interface DatedValue {
  date: DateString;
  value: number;
}

export interface MaxDrawdownResult {
  /** Worst close-to-close decline as a non-positive fraction; 0 when the series never declined. */
  drawdown: number;
  /** Date of the running-peak close that preceded the worst decline. */
  peakDate?: DateString;
  /** Date of the lowest close of the worst decline. */
  troughDate?: DateString;
  /** First date after the trough whose close reached the prior peak again. */
  recoveryDate?: DateString;
}

export interface MovingAverageSeries {
  window: number;
  points: DatedValue[];
}

/** One dated observation present in both of two return series. */
export interface AlignedReturn {
  date: DateString;
  a: number;
  b: number;
}

export interface WeightedHolding {
  symbol: string;
  /** Target portfolio weight as a fraction; long-only, so never negative. */
  weight: number;
  sector?: string;
}

export interface PortfolioHolding extends WeightedHolding {
  returns: DatedValue[];
}

export interface SectorWeight {
  sector: string;
  weight: number;
}

export interface ConcentrationFlag {
  kind: 'holding' | 'sector';
  /** Symbol for a holding flag, sector name for a sector flag. */
  label: string;
  weight: number;
  threshold: number;
}

export interface ConcentrationDiagnostics {
  largestWeight: number;
  largestWeightSymbol: string;
  /** Herfindahl-Hirschman index of weights; 1/n when equally weighted, 1 for a single holding. */
  herfindahlIndex: number;
  /** Reciprocal of the HHI: how many equally weighted holdings the portfolio behaves like. */
  effectiveHoldings: number;
  sectorWeights: SectorWeight[];
  flags: ConcentrationFlag[];
}

// --- Price series validation -------------------------------------------------

/**
 * Rejects a price series that cannot support return math: empty, non-ISO dates,
 * non-finite or non-positive closes, or dates that are not strictly chronological.
 */
export function validatePriceSeries(bars: PriceBar[]): void {
  if (bars.length === 0) {
    throw new AnalyticsError('At least one price bar is required.');
  }

  let previousDate: DateString | undefined;
  for (const bar of bars) {
    if (!ISO_DATE_PATTERN.test(bar.date)) {
      throw new AnalyticsError(`Price bar date "${bar.date}" is not an ISO (YYYY-MM-DD) date.`);
    }
    if (!Number.isFinite(bar.close) || bar.close <= 0) {
      throw new AnalyticsError(`Price bar ${bar.date} has a close that is not a finite positive number.`);
    }
    if (previousDate !== undefined && bar.date <= previousDate) {
      throw new AnalyticsError(
        `Price bars must be in strict chronological order; ${bar.date} follows ${previousDate}.`,
      );
    }
    previousDate = bar.date;
  }
}

// --- Return series ----------------------------------------------------------

/**
 * Daily close-to-close price returns, each stamped with the later of the two dates.
 * A series of n bars yields n-1 returns.
 */
export function dailyCloseReturns(bars: PriceBar[]): DatedValue[] {
  validatePriceSeries(bars);

  const returns: DatedValue[] = [];
  for (let index = 1; index < bars.length; index += 1) {
    returns.push({
      date: bars[index].date,
      value: bars[index].close / bars[index - 1].close - 1,
    });
  }
  return returns;
}

/** Cumulative price return measured from the first bar's close, which is always 0. */
export function cumulativePriceReturns(bars: PriceBar[]): DatedValue[] {
  validatePriceSeries(bars);

  const baseClose = bars[0].close;
  return bars.map((bar) => ({ date: bar.date, value: bar.close / baseClose - 1 }));
}

/** Compounds a daily return series into a cumulative return series. */
export function compoundDailyReturns(returns: DatedValue[]): DatedValue[] {
  validateReturnSeries(returns);

  let growth = 1;
  return returns.map((point) => {
    growth *= 1 + point.value;
    return { date: point.date, value: growth - 1 };
  });
}

// --- Growth and risk --------------------------------------------------------

/**
 * Compound annual growth rate of the closes, annualized over the actual calendar days
 * elapsed between the first and last bar. Returns undefined when no time has elapsed.
 */
export function compoundAnnualGrowthRate(bars: PriceBar[]): number | undefined {
  validatePriceSeries(bars);
  if (bars.length < 2) return undefined;

  const first = bars[0];
  const last = bars[bars.length - 1];
  const elapsedDays = daysBetween(first.date, last.date);
  if (elapsedDays <= 0) return undefined;

  const years = elapsedDays / CALENDAR_DAYS_PER_YEAR;
  return (last.close / first.close) ** (1 / years) - 1;
}

/**
 * Annualized sample standard deviation of daily returns, scaled by sqrt(252).
 * Returns undefined with fewer than two returns.
 */
export function annualizedVolatility(returns: DatedValue[]): number | undefined {
  const deviation = sampleStandardDeviation(returnValues(returns));
  if (deviation === undefined) return undefined;
  return deviation * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * Annualized Sharpe ratio of daily returns against an explicit annual risk-free rate,
 * which is de-annualized geometrically over 252 trading days.
 * Returns undefined when volatility is zero or there are fewer than two returns.
 */
export function annualizedSharpeRatio(
  returns: DatedValue[],
  annualRiskFreeRate: number,
): number | undefined {
  if (!Number.isFinite(annualRiskFreeRate) || annualRiskFreeRate <= -1) {
    throw new AnalyticsError('The annual risk-free rate must be a finite number greater than -1.');
  }

  const values = returnValues(returns);
  const deviation = sampleStandardDeviation(values);
  if (deviation === undefined || deviation === 0) return undefined;

  const dailyRiskFree = (1 + annualRiskFreeRate) ** (1 / TRADING_DAYS_PER_YEAR) - 1;
  const meanExcessReturn = mean(values) - dailyRiskFree;
  return (meanExcessReturn / deviation) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * Worst close-to-close drawdown, with the dates of the preceding peak, the trough, and the
 * first close that recovered the peak. Intraday lows are ignored by design.
 */
export function maxCloseDrawdown(bars: PriceBar[]): MaxDrawdownResult {
  validatePriceSeries(bars);

  let peakClose = bars[0].close;
  let peakDate = bars[0].date;
  let worstDrawdown = 0;
  let worstPeakClose = peakClose;
  let worstPeakDate: DateString | undefined;
  let worstTroughDate: DateString | undefined;

  for (const bar of bars) {
    if (bar.close > peakClose) {
      peakClose = bar.close;
      peakDate = bar.date;
    }
    const drawdown = bar.close / peakClose - 1;
    if (drawdown < worstDrawdown) {
      worstDrawdown = drawdown;
      worstPeakClose = peakClose;
      worstPeakDate = peakDate;
      worstTroughDate = bar.date;
    }
  }

  if (worstTroughDate === undefined) return { drawdown: 0 };

  const troughDate = worstTroughDate;
  return {
    drawdown: worstDrawdown,
    peakDate: worstPeakDate,
    troughDate,
    recoveryDate: bars.find((bar) => bar.date > troughDate && bar.close >= worstPeakClose)?.date,
  };
}

/**
 * Simple moving average of closes for one window, emitted only once the window is full
 * and stamped with the last date it covers.
 */
export function simpleMovingAverage(bars: PriceBar[], window: number): DatedValue[] {
  validatePriceSeries(bars);
  if (!Number.isInteger(window) || window < 1) {
    throw new AnalyticsError(`A moving-average window must be a positive integer; received ${window}.`);
  }

  const points: DatedValue[] = [];
  let windowSum = 0;
  for (let index = 0; index < bars.length; index += 1) {
    windowSum += bars[index].close;
    if (index >= window) windowSum -= bars[index - window].close;
    if (index >= window - 1) points.push({ date: bars[index].date, value: windowSum / window });
  }
  return points;
}

/** Simple moving averages for the windows the caller selected, in the order given. */
export function simpleMovingAverages(bars: PriceBar[], windows: number[]): MovingAverageSeries[] {
  return windows.map((window) => ({ window, points: simpleMovingAverage(bars, window) }));
}

// --- Cross-asset relationships ---------------------------------------------

/**
 * Inner join of two dated return series on date, sorted chronologically.
 * Dates present in only one series are dropped, so a holiday or a shorter listing
 * history never silently pairs mismatched days.
 */
export function alignReturns(a: DatedValue[], b: DatedValue[]): AlignedReturn[] {
  validateReturnSeries(a);
  validateReturnSeries(b);

  const bByDate = new Map(b.map((point) => [point.date, point.value]));
  const aligned: AlignedReturn[] = [];
  for (const point of a) {
    const other = bByDate.get(point.date);
    if (other === undefined) continue;
    aligned.push({ date: point.date, a: point.value, b: other });
  }
  return aligned.sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * Beta of an asset against a benchmark, from overlapping dated returns only.
 * Returns undefined with fewer than two overlapping days or a flat benchmark.
 */
export function beta(assetReturns: DatedValue[], benchmarkReturns: DatedValue[]): number | undefined {
  const aligned = alignReturns(assetReturns, benchmarkReturns);
  if (aligned.length < 2) return undefined;

  const assetValues = aligned.map((point) => point.a);
  const benchmarkValues = aligned.map((point) => point.b);
  const benchmarkVariance = sampleVariance(benchmarkValues);
  if (benchmarkVariance === undefined || benchmarkVariance === 0) return undefined;

  return sampleCovariance(assetValues, benchmarkValues) / benchmarkVariance;
}

/**
 * Pearson correlation of two return series, from overlapping dated returns only,
 * clamped to [-1, 1] against floating-point drift.
 * Returns undefined with fewer than two overlapping days or a flat series.
 */
export function correlation(a: DatedValue[], b: DatedValue[]): number | undefined {
  const aligned = alignReturns(a, b);
  if (aligned.length < 2) return undefined;

  const aValues = aligned.map((point) => point.a);
  const bValues = aligned.map((point) => point.b);
  const aDeviation = sampleStandardDeviation(aValues);
  const bDeviation = sampleStandardDeviation(bValues);
  if (!aDeviation || !bDeviation) return undefined;

  const coefficient = sampleCovariance(aValues, bValues) / (aDeviation * bDeviation);
  return Math.min(1, Math.max(-1, coefficient));
}

// --- Portfolio --------------------------------------------------------------

/** Rejects weights that are non-finite, negative, or that do not sum to 1 within tolerance. */
export function validateWeights(holdings: WeightedHolding[]): void {
  if (holdings.length === 0) {
    throw new AnalyticsError('At least one holding is required.');
  }

  let total = 0;
  for (const holding of holdings) {
    if (!Number.isFinite(holding.weight)) {
      throw new AnalyticsError(`Holding ${holding.symbol} has a weight that is not a finite number.`);
    }
    if (holding.weight < 0) {
      throw new AnalyticsError(
        `Holding ${holding.symbol} has a negative weight; short positions are out of scope.`,
      );
    }
    total += holding.weight;
  }

  if (Math.abs(total - 1) > WEIGHT_SUM_TOLERANCE) {
    throw new AnalyticsError(`Holding weights must sum to 1; they sum to ${total}.`);
  }
}

/**
 * Weight-averaged daily return series for a portfolio rebalanced back to target weights
 * every day. Only dates where every holding has a return are included, so a partial
 * trading day never counts as a zero return for the missing holdings.
 */
export function portfolioDailyReturns(holdings: PortfolioHolding[]): DatedValue[] {
  validateWeights(holdings);
  holdings.forEach((holding) => validateReturnSeries(holding.returns, holding.symbol));

  const returnsByDate = holdings.map((holding) => new Map(holding.returns.map((point) => [point.date, point.value])));
  const sharedDates = [...new Set(holdings[0].returns.map((point) => point.date))]
    .filter((date) => returnsByDate.every((byDate) => byDate.has(date)))
    .sort((left, right) => left.localeCompare(right));

  return sharedDates.map((date) => ({
    date,
    value: holdings.reduce(
      (total, holding, index) => total + holding.weight * (returnsByDate[index].get(date) ?? 0),
      0,
    ),
  }));
}

/**
 * Concentration diagnostics for a set of weights: largest position, HHI, effective holdings,
 * sector weights, and educational flags for outsized holdings or sectors.
 * Holdings with no declared sector aggregate under `UNCLASSIFIED_SECTOR` and are never flagged,
 * because an unknown sector is not evidence of concentration.
 */
export function analyzeConcentration(holdings: WeightedHolding[]): ConcentrationDiagnostics {
  validateWeights(holdings);

  const largest = holdings.reduce(
    (best, holding) => (holding.weight > best.weight ? holding : best),
    holdings[0],
  );
  const herfindahlIndex = holdings.reduce((total, holding) => total + holding.weight ** 2, 0);

  const sectorTotals = new Map<string, number>();
  for (const holding of holdings) {
    const sector = holding.sector?.trim() ? holding.sector.trim() : UNCLASSIFIED_SECTOR;
    sectorTotals.set(sector, (sectorTotals.get(sector) ?? 0) + holding.weight);
  }
  const sectorWeights = [...sectorTotals]
    .map(([sector, weight]) => ({ sector, weight }))
    .sort((left, right) => right.weight - left.weight || left.sector.localeCompare(right.sector));

  const holdingFlags: ConcentrationFlag[] = holdings
    .filter((holding) => holding.weight > HOLDING_CONCENTRATION_THRESHOLD)
    .sort((left, right) => right.weight - left.weight || left.symbol.localeCompare(right.symbol))
    .map((holding) => ({
      kind: 'holding' as const,
      label: holding.symbol,
      weight: holding.weight,
      threshold: HOLDING_CONCENTRATION_THRESHOLD,
    }));

  const sectorFlags: ConcentrationFlag[] = sectorWeights
    .filter((entry) => entry.sector !== UNCLASSIFIED_SECTOR && entry.weight > SECTOR_CONCENTRATION_THRESHOLD)
    .map((entry) => ({
      kind: 'sector' as const,
      label: entry.sector,
      weight: entry.weight,
      threshold: SECTOR_CONCENTRATION_THRESHOLD,
    }));

  return {
    largestWeight: largest.weight,
    largestWeightSymbol: largest.symbol,
    herfindahlIndex,
    effectiveHoldings: herfindahlIndex > 0 ? 1 / herfindahlIndex : 0,
    sectorWeights,
    flags: [...holdingFlags, ...sectorFlags],
  };
}

// --- Internal helpers -------------------------------------------------------

function validateReturnSeries(returns: DatedValue[], label?: string): void {
  const subject = label ? `Return series for ${label}` : 'Return series';
  for (const point of returns) {
    if (!ISO_DATE_PATTERN.test(point.date)) {
      throw new AnalyticsError(`${subject} has a date "${point.date}" that is not an ISO (YYYY-MM-DD) date.`);
    }
    if (!Number.isFinite(point.value)) {
      throw new AnalyticsError(`${subject} has a non-finite return on ${point.date}.`);
    }
  }
}

function returnValues(returns: DatedValue[]): number[] {
  validateReturnSeries(returns);
  return returns.map((point) => point.value);
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function sampleVariance(values: number[]): number | undefined {
  if (values.length < 2) return undefined;
  const average = mean(values);
  const sumOfSquares = values.reduce((total, value) => total + (value - average) ** 2, 0);
  return sumOfSquares / (values.length - 1);
}

function sampleStandardDeviation(values: number[]): number | undefined {
  const variance = sampleVariance(values);
  return variance === undefined ? undefined : Math.sqrt(variance);
}

function sampleCovariance(a: number[], b: number[]): number {
  const meanA = mean(a);
  const meanB = mean(b);
  const sumOfProducts = a.reduce((total, value, index) => total + (value - meanA) * (b[index] - meanB), 0);
  return sumOfProducts / (a.length - 1);
}
