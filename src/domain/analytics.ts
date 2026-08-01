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

/**
 * Minimum aligned daily returns before volatility, Sharpe, beta, or correlation are
 * reported at all. Two returns are mathematically defined but statistically
 * meaningless; roughly a quarter of a trading year is the floor below which these
 * figures mislead more than they inform. Below it every one of these metrics is
 * `undefined` (reported as unavailable), never zero.
 */
export const MIN_RISK_OBSERVATIONS = 60;

/**
 * Aligned daily returns below which a computed risk figure, while shown, carries a
 * prominent limited-sample caveat. One trading year is the conventional reference
 * length for annualized risk statistics.
 */
export const LIMITED_SAMPLE_OBSERVATIONS = 252;

/**
 * The observation count behind the risk figures and what it means for their
 * trustworthiness. `sufficient` gates whether the figures are shown at all;
 * `limited` flags a sample that is large enough to compute but short enough that the
 * annualized figures should be read with caution.
 */
export interface RiskSampleStatus {
  /** Aligned daily returns available to the risk math. */
  observations: number;
  /** True once `observations >= MIN_RISK_OBSERVATIONS`, so the figures are reported. */
  sufficient: boolean;
  /** True when sufficient but `observations < LIMITED_SAMPLE_OBSERVATIONS`. */
  limited: boolean;
}

export function riskSampleStatus(observations: number): RiskSampleStatus {
  const sufficient = observations >= MIN_RISK_OBSERVATIONS;
  return {
    observations,
    sufficient,
    limited: sufficient && observations < LIMITED_SAMPLE_OBSERVATIONS,
  };
}

/**
 * Which price series drives return, risk, and correlation math.
 * `price`: split-adjusted close (dividends excluded). `total`: the vendor-adjusted
 * close (a total-return proxy that folds dividends and splits back in). A comparison,
 * table, beta, correlation, or portfolio is always measured on ONE basis; the two are
 * never mixed.
 */
export type ReturnBasis = 'price' | 'total';

/**
 * Projects a bar series onto the chosen return basis by moving the selected close into
 * the `close` leg so the shared close-based analytics operate on it unchanged. `price`
 * returns the bars as-is. `total` requires every bar to carry a finite, positive
 * `adjustedClose`; a gap throws rather than silently mixing an adjusted close with a
 * raw close.
 */
export function toReturnBasisBars(bars: PriceBar[], basis: ReturnBasis): PriceBar[] {
  if (basis === 'price') return bars;
  return bars.map((bar) => {
    if (
      bar.adjustedClose === undefined ||
      !Number.isFinite(bar.adjustedClose) ||
      bar.adjustedClose <= 0
    ) {
      throw new AnalyticsError(
        `Total-return basis requires an adjusted close on every bar; ${bar.date} has none.`,
      );
    }
    return { ...bar, close: bar.adjustedClose };
  });
}

/**
 * Resolves the one return basis a multi-series view may use. Total return is chosen
 * only when EVERY series has complete vendor-adjusted-close coverage; if any series
 * lacks it, all series fall back to price return so no table, beta, correlation, or
 * portfolio ever mixes the two bases.
 */
export function resolveReturnBasis(
  coverages: Array<'yahoo-adjusted-close' | 'unavailable' | 'demo'>,
): ReturnBasis {
  if (coverages.length === 0) return 'price';
  return coverages.every((coverage) => coverage === 'yahoo-adjusted-close') ? 'total' : 'price';
}

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
 * Returns undefined below `MIN_RISK_OBSERVATIONS` aligned returns, so a statistically
 * meaningless two-point estimate is never produced.
 */
export function annualizedVolatility(returns: DatedValue[]): number | undefined {
  if (returns.length < MIN_RISK_OBSERVATIONS) return undefined;
  const deviation = sampleStandardDeviation(returnValues(returns));
  if (deviation === undefined) return undefined;
  return deviation * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * Annualized Sharpe ratio of daily returns against an explicit annual risk-free rate,
 * which is de-annualized geometrically over 252 trading days. The sqrt(252)
 * annualization assumes independent, identically distributed daily returns; serial
 * correlation makes it only approximate (Andrew Lo, "The Statistics of Sharpe Ratios"),
 * so it is never a definitive ranking.
 *
 * Returns undefined below `MIN_RISK_OBSERVATIONS` aligned returns or when volatility is
 * zero.
 */
export function annualizedSharpeRatio(
  returns: DatedValue[],
  annualRiskFreeRate: number,
): number | undefined {
  if (!Number.isFinite(annualRiskFreeRate) || annualRiskFreeRate <= -1) {
    throw new AnalyticsError('The annual risk-free rate must be a finite number greater than -1.');
  }

  if (returns.length < MIN_RISK_OBSERVATIONS) return undefined;
  const values = returnValues(returns);
  const deviation = sampleStandardDeviation(values);
  if (deviation === undefined || deviation === 0) return undefined;

  const dailyRiskFree = (1 + annualRiskFreeRate) ** (1 / TRADING_DAYS_PER_YEAR) - 1;
  const meanExcessReturn = mean(values) - dailyRiskFree;
  return (meanExcessReturn / deviation) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * Daily target downside deviation of a return series against a minimum acceptable return (MAR)
 * equal to the DAILY risk-free rate, de-annualized geometrically from the supplied annual rate
 * exactly as `annualizedSharpeRatio` does its subtraction. Follows the Sortino & Satchell
 * target-semideviation convention: each return's shortfall below the MAR, `min(0, r - MAR)`, is
 * squared, summed over EVERY observation, divided by the full sample size N (not by the count of
 * shortfall days), and square-rooted. Returns at or above the MAR contribute zero, so a day that
 * beats the MAR lowers the downside deviation rather than raising it.
 *
 * The result is a DAILY decimal quantity; multiply by sqrt(252) to annualize it. Returns
 * undefined below `MIN_RISK_OBSERVATIONS` observations, and exactly 0 when no observation fell
 * below the MAR — in which case downside risk is undefined, not zero, for a ratio built on it.
 */
export function downsideDeviation(
  returns: DatedValue[],
  annualRiskFreeRate: number,
): number | undefined {
  if (!Number.isFinite(annualRiskFreeRate) || annualRiskFreeRate <= -1) {
    throw new AnalyticsError('The annual risk-free rate must be a finite number greater than -1.');
  }
  if (returns.length < MIN_RISK_OBSERVATIONS) return undefined;

  const dailyRiskFree = (1 + annualRiskFreeRate) ** (1 / TRADING_DAYS_PER_YEAR) - 1;
  return targetDownsideDeviation(returnValues(returns), dailyRiskFree);
}

/**
 * Annualized Sortino ratio: the Sharpe ratio's mean-excess-return numerator over the DAILY target
 * downside deviation instead of the full standard deviation, scaled by sqrt(252).
 *
 * Conventions, stated exactly:
 * - Minimum acceptable return (MAR): the daily risk-free rate `(1 + annualRiskFreeRate)^(1/252) - 1`,
 *   the same de-annualized rate `annualizedSharpeRatio` subtracts. Excess return is measured
 *   against this MAR, so a Sortino and a Sharpe on the same window share a numerator.
 * - Downside deviation: `downsideDeviation` above — the root-mean-square shortfall below the MAR,
 *   averaged over all N observations.
 * - Annualization: the daily ratio times sqrt(252), matching `annualizedSharpeRatio`; it assumes
 *   independent, identically distributed daily returns and is only approximate under serial
 *   correlation.
 *
 * Returns undefined below `MIN_RISK_OBSERVATIONS` returns, and undefined (never Infinity) when the
 * downside deviation is zero because no return fell below the MAR. Throws when the annual
 * risk-free rate is not a finite number greater than -1.
 */
export function annualizedSortinoRatio(
  returns: DatedValue[],
  annualRiskFreeRate: number,
): number | undefined {
  if (!Number.isFinite(annualRiskFreeRate) || annualRiskFreeRate <= -1) {
    throw new AnalyticsError('The annual risk-free rate must be a finite number greater than -1.');
  }
  if (returns.length < MIN_RISK_OBSERVATIONS) return undefined;

  const values = returnValues(returns);
  const dailyRiskFree = (1 + annualRiskFreeRate) ** (1 / TRADING_DAYS_PER_YEAR) - 1;
  const deviation = targetDownsideDeviation(values, dailyRiskFree);
  if (deviation === 0) return undefined;

  const meanExcessReturn = mean(values) - dailyRiskFree;
  return (meanExcessReturn / deviation) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * Historical (empirical) one-day Value at Risk from realized daily returns, at a caller-specified
 * confidence — there is deliberately no default here, so a caller must state the confidence they
 * mean rather than inherit a hidden 95%.
 *
 * Conventions, stated exactly:
 * - Lower-tail quantile: the returns are sorted ascending and the loss is read off the
 *   `1 - confidence` lower-tail quantile with the inverse-empirical-CDF (nearest-rank) rule,
 *   `rank = ceil((1 - confidence) * n)`, taking the return at that 1-based rank. There is no
 *   interpolation between order statistics, so the estimate is always one observed return. With a
 *   high confidence and a small sample the rank pins to the single worst observation, which is a
 *   limitation of the estimator, not a modelling choice.
 * - Sign: the returned value is a POSITIVE loss as a decimal fraction. A VaR of 0.05 means the
 *   portfolio lost 5% or more on `1 - confidence` of the observed days. When even the lower-tail
 *   quantile is itself a gain the returned number is negative, which honestly reports "no loss at
 *   this confidence" rather than being clamped to zero.
 * - This is NOT a loss ceiling. `1 - confidence` of days breached this threshold historically, and
 *   the losses on those days were by construction at least this large and often larger; VaR says
 *   nothing about how much larger, nor about losses outside the sampled window.
 *
 * Returns undefined below `MIN_RISK_OBSERVATIONS` returns. Throws when the confidence is not a
 * finite number strictly between 0 and 1.
 */
export function historicalValueAtRisk(returns: DatedValue[], confidence: number): number | undefined {
  if (!Number.isFinite(confidence) || confidence <= 0 || confidence >= 1) {
    throw new AnalyticsError('The VaR confidence must be a finite number strictly between 0 and 1.');
  }
  if (returns.length < MIN_RISK_OBSERVATIONS) return undefined;

  const sorted = returnValues(returns).sort((left, right) => left - right);
  const tailProbability = 1 - confidence;
  // Decimal confidences such as 0.95 are not exact binary floats: (1 - 0.95) * 60 can resolve
  // to 3.0000000000000027 and `ceil` would incorrectly select rank 4. The tolerance is far
  // below a meaningful fraction of one observation and only restores exact integer boundaries.
  const rawRank = tailProbability * sorted.length;
  const rankTolerance = Number.EPSILON * Math.max(1, sorted.length) * 4;
  const rank = Math.min(Math.max(Math.ceil(rawRank - rankTolerance), 1), sorted.length);
  // Positive loss number: a negative quantile return becomes a positive VaR.
  return -sorted[rank - 1];
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
 * Returns undefined below `MIN_RISK_OBSERVATIONS` overlapping days or a flat benchmark.
 */
export function beta(assetReturns: DatedValue[], benchmarkReturns: DatedValue[]): number | undefined {
  const aligned = alignReturns(assetReturns, benchmarkReturns);
  if (aligned.length < MIN_RISK_OBSERVATIONS) return undefined;

  const assetValues = aligned.map((point) => point.a);
  const benchmarkValues = aligned.map((point) => point.b);
  const benchmarkVariance = sampleVariance(benchmarkValues);
  if (benchmarkVariance === undefined || benchmarkVariance === 0) return undefined;

  return sampleCovariance(assetValues, benchmarkValues) / benchmarkVariance;
}

/**
 * Pearson correlation of two return series, from overlapping dated returns only,
 * clamped to [-1, 1] against floating-point drift.
 * Returns undefined below `MIN_RISK_OBSERVATIONS` overlapping days or a flat series.
 */
export function correlation(a: DatedValue[], b: DatedValue[]): number | undefined {
  const aligned = alignReturns(a, b);
  if (aligned.length < MIN_RISK_OBSERVATIONS) return undefined;

  const aValues = aligned.map((point) => point.a);
  const bValues = aligned.map((point) => point.b);
  const aDeviation = sampleStandardDeviation(aValues);
  const bDeviation = sampleStandardDeviation(bValues);
  if (!aDeviation || !bDeviation) return undefined;

  const coefficient = sampleCovariance(aValues, bValues) / (aDeviation * bDeviation);
  return Math.min(1, Math.max(-1, coefficient));
}

/**
 * Jensen-style annualized alpha of a portfolio against a benchmark: how much the portfolio's
 * realized return beat, or trailed, the return CAPM expected for the beta it actually ran.
 *
 * Conventions, stated exactly:
 * - Overlap: measured only on dates present in BOTH return series (`alignReturns`), so a session
 *   one leg missed never pairs mismatched days.
 * - Beta: the portfolio beta from `beta` on the same overlap — covariance over benchmark variance.
 * - Annualization: geometric. Each leg's overlapping daily returns are compounded to a terminal
 *   growth factor and annualized over 252 trading days, `growth^(252/n) - 1`. The risk-free rate is
 *   used as the supplied ANNUAL rate directly (no de-annualization) because both returns are
 *   already annual at this point.
 * - Formula: `alpha = Rp - (Rf + beta * (Rm - Rf))`, with Rp and Rm the annualized geometric
 *   portfolio and benchmark returns and Rf the annual risk-free rate.
 *
 * Limitations: a single-factor CAPM reading only; beta is estimated and unstable, not known;
 * geometric annualization of a short window extrapolates a partial year; on a price-return basis
 * dividends are excluded from both legs; and pairing a geometric return gap with a
 * covariance-based beta is an approximation, not an exact identity.
 *
 * Returns undefined — never a fabricated alpha — when the overlap is below `MIN_RISK_OBSERVATIONS`,
 * when beta is unavailable (a flat benchmark), or when either leg's compounded growth is
 * non-positive so a geometric annualized return does not exist. Throws when the annual risk-free
 * rate is not a finite number greater than -1.
 */
export function jensenAlpha(
  portfolioReturns: DatedValue[],
  benchmarkReturns: DatedValue[],
  annualRiskFreeRate: number,
): number | undefined {
  if (!Number.isFinite(annualRiskFreeRate) || annualRiskFreeRate <= -1) {
    throw new AnalyticsError('The annual risk-free rate must be a finite number greater than -1.');
  }

  const aligned = alignReturns(portfolioReturns, benchmarkReturns);
  if (aligned.length < MIN_RISK_OBSERVATIONS) return undefined;

  const portfolioBeta = beta(portfolioReturns, benchmarkReturns);
  if (portfolioBeta === undefined) return undefined;

  const portfolioGrowth = aligned.reduce((growth, point) => growth * (1 + point.a), 1);
  const benchmarkGrowth = aligned.reduce((growth, point) => growth * (1 + point.b), 1);
  if (portfolioGrowth <= 0 || benchmarkGrowth <= 0) return undefined;

  const exponent = TRADING_DAYS_PER_YEAR / aligned.length;
  const annualizedPortfolio = portfolioGrowth ** exponent - 1;
  const annualizedBenchmark = benchmarkGrowth ** exponent - 1;
  return (
    annualizedPortfolio -
    (annualRiskFreeRate + portfolioBeta * (annualizedBenchmark - annualRiskFreeRate))
  );
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

// --- Inverse-volatility allocation ------------------------------------------

/** One return series named for its instrument, the input to inverse-volatility weighting. */
export interface ReturnSeries {
  symbol: string;
  returns: DatedValue[];
}

/** One holding's inverse-volatility weight, alongside the volatility that produced it. */
export interface InverseVolatilityWeight {
  symbol: string;
  /** Annualized volatility of this series; strictly positive, or the whole allocation is rejected. */
  volatility: number;
  /** Weight proportional to 1 / volatility, normalized so the set sums to 1. */
  weight: number;
}

/**
 * A long-only allocation weighted by inverse annualized volatility. This is a transparent
 * risk-parity-style RULE, not an optimizer: it never reads returns' direction, correlations, or a
 * covariance matrix, so it is deliberately NOT an efficient frontier, a minimum-variance
 * portfolio, or an optimal portfolio, and it does not claim to be one.
 */
export interface InverseVolatilityAllocation {
  /** Names the rule so a view never mislabels it as an optimization. */
  method: 'inverse-volatility';
  weights: InverseVolatilityWeight[];
}

/** Lower and upper bounds on the number of series inverse-volatility weighting accepts. */
export const INVERSE_VOLATILITY_MIN_SERIES = 1;
export const INVERSE_VOLATILITY_MAX_SERIES = 10;

/**
 * Deterministic long-only "risk-adjusted" weights that scale each holding by the reciprocal of its
 * annualized volatility and normalize the set to sum to 1, so a historically calmer series carries
 * more weight and a wilder one less. A single series receives the whole weight.
 *
 * Explicit rules:
 * - Between `INVERSE_VOLATILITY_MIN_SERIES` and `INVERSE_VOLATILITY_MAX_SERIES` series, and every
 *   symbol must be distinct.
 * - Every series must have a defined, strictly positive annualized volatility. A series with too
 *   few returns (volatility undefined) or one that never moved (volatility zero) is REJECTED with
 *   an `AnalyticsError`, because dividing by an undefined or zero volatility would either fabricate
 *   a weight or send it to infinity.
 * - Weights are `(1 / volatility_i) / sum_j (1 / volatility_j)` and sum to 1 by construction.
 *
 * This intentionally implies no forecast and no optimality: it reweights toward historically
 * calmer holdings, nothing more.
 */
export function inverseVolatilityWeights(series: ReturnSeries[]): InverseVolatilityAllocation {
  if (series.length < INVERSE_VOLATILITY_MIN_SERIES || series.length > INVERSE_VOLATILITY_MAX_SERIES) {
    throw new AnalyticsError(
      `Inverse-volatility weighting needs between ${INVERSE_VOLATILITY_MIN_SERIES} and ` +
        `${INVERSE_VOLATILITY_MAX_SERIES} return series; received ${series.length}.`,
    );
  }

  const seen = new Set<string>();
  const volatilities = series.map((entry) => {
    if (seen.has(entry.symbol)) {
      throw new AnalyticsError(`Return series ${entry.symbol} appears more than once.`);
    }
    seen.add(entry.symbol);

    const volatility = annualizedVolatility(entry.returns);
    if (volatility === undefined) {
      throw new AnalyticsError(
        `Return series ${entry.symbol} has fewer than ${MIN_RISK_OBSERVATIONS} returns, so its ` +
          'annualized volatility is undefined and inverse-volatility weighting is rejected.',
      );
    }
    if (volatility === 0) {
      throw new AnalyticsError(
        `Return series ${entry.symbol} never moved, so its inverse volatility is undefined; ` +
          'inverse-volatility weighting rejects a zero-volatility series.',
      );
    }
    return volatility;
  });

  const inverse = volatilities.map((volatility) => 1 / volatility);
  const totalInverse = inverse.reduce((total, value) => total + value, 0);

  return {
    method: 'inverse-volatility',
    weights: series.map((entry, index) => ({
      symbol: entry.symbol,
      volatility: volatilities[index],
      weight: inverse[index] / totalInverse,
    })),
  };
}

// --- Global minimum-variance allocation -------------------------------------

/** Lower and upper bounds on the number of series the minimum-variance optimizer accepts. */
export const MIN_VARIANCE_MIN_SERIES = 1;
export const MIN_VARIANCE_MAX_SERIES = 10;

/**
 * Hard ceiling on projected-gradient iterations. Convergence is bounded: the descent always
 * stops here even if the weight change has not yet fallen below the tolerance, so the routine
 * can never spin without terminating.
 */
export const MIN_VARIANCE_MAX_ITERATIONS = 20000;

/**
 * The optimizer has converged once the largest single-weight change between two consecutive
 * projected-gradient steps falls below this threshold. Far tighter than the 1e-6 weight-sum
 * tolerance the weights are later validated against, so a converged allocation is exact to
 * display precision.
 */
export const MIN_VARIANCE_CONVERGENCE_TOLERANCE = 1e-12;

/** One holding's weight in the long-only global minimum-variance portfolio. */
export interface MinimumVarianceWeight {
  symbol: string;
  weight: number;
}

/**
 * A long-only global minimum-variance (GMV) allocation: the fully invested, no-short weights
 * that minimize the sample variance of the combined daily return series. Unlike
 * `inverseVolatilityWeights`, this DOES read the covariance between holdings, so two highly
 * correlated names are down-weighted together rather than each judged in isolation.
 *
 * This is a historical, in-sample optimizer, not a forecast: it minimizes the variance the
 * holdings actually exhibited over the aligned window, and sample covariance is a noisy estimate
 * that need not persist. It targets only variance — never expected return — so it is the single
 * lowest-variance long-only portfolio, not a point on an expected-return efficient frontier, and
 * it does not claim to be optimal for any return objective.
 */
export interface MinimumVarianceAllocation {
  /** Names the method so a view never mislabels it as a return-maximizing optimization. */
  method: 'global-minimum-variance';
  weights: MinimumVarianceWeight[];
  /** Aligned daily observations, present in every series, behind the covariance estimate. */
  observations: number;
  /** Annualized volatility of the optimized portfolio: sqrt(wᵀΣw · 252) on the daily covariance. */
  volatility: number;
  /** Projected-gradient iterations run before convergence or the iteration ceiling. */
  iterations: number;
  /** True when the descent met `MIN_VARIANCE_CONVERGENCE_TOLERANCE` before the iteration ceiling. */
  converged: boolean;
}

/**
 * Deterministic long-only global minimum-variance weights from aligned daily returns.
 *
 * Method, stated exactly:
 * - Alignment: the series are inner-joined on date (every date must be present in EVERY series),
 *   so a holiday or a shorter listing history never pairs mismatched days or imputes a return.
 * - Sample covariance: the n×n covariance matrix is built from the aligned columns with the same
 *   Bessel-corrected (÷ N-1) estimator the rest of this module uses for variance and covariance.
 * - Objective: minimize wᵀΣw subject to wᵢ ≥ 0 and Σwᵢ = 1 (the probability simplex), so the
 *   result is fully invested and never shorts.
 * - Solver: projected gradient descent. Each step takes a gradient step 2Σw with a constant size
 *   1 / (2·‖Σ‖∞) — the reciprocal of an upper bound on the gradient's Lipschitz constant, which
 *   guarantees descent — then projects back onto the simplex with the exact O(n log n)
 *   sort-and-threshold projection (Held–Wolfe–Crowder / Duchi). It stops when the largest weight
 *   change drops below `MIN_VARIANCE_CONVERGENCE_TOLERANCE` or at `MIN_VARIANCE_MAX_ITERATIONS`.
 *
 * Rejections — the optimizer never fabricates weights from unusable data:
 * - Between `MIN_VARIANCE_MIN_SERIES` and `MIN_VARIANCE_MAX_SERIES` series, every symbol distinct.
 * - Fewer than `MIN_RISK_OBSERVATIONS` aligned observations is REJECTED with an `AnalyticsError`,
 *   the same statistical floor volatility, beta, and correlation use — a covariance from a
 *   handful of overlapping days would mislead more than inform.
 * - A flat holding (zero variance) or a singular covariance matrix (e.g. two perfectly correlated
 *   series, or more holdings than independent observations) is REJECTED, because the minimum is
 *   then not unique and the weights would be arbitrary. Positive-definiteness is checked with a
 *   Cholesky factorization; a non-positive pivot rejects the input.
 */
export function globalMinimumVarianceWeights(series: ReturnSeries[]): MinimumVarianceAllocation {
  if (series.length < MIN_VARIANCE_MIN_SERIES || series.length > MIN_VARIANCE_MAX_SERIES) {
    throw new AnalyticsError(
      `Minimum-variance weighting needs between ${MIN_VARIANCE_MIN_SERIES} and ` +
        `${MIN_VARIANCE_MAX_SERIES} return series; received ${series.length}.`,
    );
  }

  const seen = new Set<string>();
  for (const entry of series) {
    if (seen.has(entry.symbol)) {
      throw new AnalyticsError(`Return series ${entry.symbol} appears more than once.`);
    }
    seen.add(entry.symbol);
    validateReturnSeries(entry.returns, entry.symbol);
  }

  const columns = alignReturnColumns(series.map((entry) => entry.returns));
  const observations = columns.length === 0 ? 0 : columns[0].length;
  if (observations < MIN_RISK_OBSERVATIONS) {
    throw new AnalyticsError(
      `Minimum-variance weighting needs at least ${MIN_RISK_OBSERVATIONS} aligned observations ` +
        `across every series; only ${observations} dates overlap.`,
    );
  }

  const covariance = sampleCovarianceMatrix(columns);
  if (!isPositiveDefinite(covariance)) {
    throw new AnalyticsError(
      'The covariance matrix is singular or not positive definite (a flat holding, perfectly ' +
        'correlated holdings, or too few observations), so the minimum-variance portfolio is not ' +
        'unique; minimum-variance weighting is rejected.',
    );
  }

  const { weights, iterations, converged } = minimizeVarianceOnSimplex(covariance);
  if (!converged) {
    throw new AnalyticsError(
      `Minimum-variance weighting did not converge within ${MIN_VARIANCE_MAX_ITERATIONS} iterations.`,
    );
  }
  const dailyVariance = quadraticForm(covariance, weights);
  const volatility = Math.sqrt(Math.max(0, dailyVariance) * TRADING_DAYS_PER_YEAR);

  return {
    method: 'global-minimum-variance',
    weights: series.map((entry, index) => ({ symbol: entry.symbol, weight: weights[index] })),
    observations,
    volatility,
    iterations,
    converged,
  };
}

// --- Internal helpers -------------------------------------------------------

/**
 * Inner-joins several dated return series on date, returning one aligned column of values per
 * series in the original order. A date survives only when EVERY series carries it, so no column
 * is ever padded with an imputed return. Columns are ordered by date so the covariance is
 * reproducible.
 */
function alignReturnColumns(seriesReturns: DatedValue[][]): number[][] {
  if (seriesReturns.length === 0) return [];

  const maps = seriesReturns.map((points) => new Map(points.map((point) => [point.date, point.value])));
  const sharedDates = [...new Set(seriesReturns[0].map((point) => point.date))]
    .filter((date) => maps.every((byDate) => byDate.has(date)))
    .sort((left, right) => left.localeCompare(right));

  return maps.map((byDate) => sharedDates.map((date) => byDate.get(date) as number));
}

/** Symmetric sample covariance matrix of aligned columns, using the shared ÷(N-1) estimator. */
function sampleCovarianceMatrix(columns: number[][]): number[][] {
  const n = columns.length;
  const matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      const value = sampleCovariance(columns[i], columns[j]);
      matrix[i][j] = value;
      matrix[j][i] = value;
    }
  }
  return matrix;
}

/**
 * Tests positive-definiteness by attempting a Cholesky factorization: a non-positive pivot means
 * the matrix is singular or indefinite. The pivot threshold is relative to the largest diagonal
 * entry so it holds across the tiny magnitudes daily-return covariances take.
 */
function isPositiveDefinite(matrix: number[][]): boolean {
  const n = matrix.length;
  const scale = Math.max(...matrix.map((row, index) => row[index]), 0);
  const pivotFloor = scale * 1e-10;

  const lower = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = matrix[i][j];
      for (let k = 0; k < j; k += 1) sum -= lower[i][k] * lower[j][k];
      if (i === j) {
        if (sum <= pivotFloor) return false;
        lower[i][i] = Math.sqrt(sum);
      } else {
        lower[i][j] = sum / lower[j][j];
      }
    }
  }
  return true;
}

/**
 * Minimizes wᵀΣw over the probability simplex with projected gradient descent from the
 * equal-weight start. A constant step of 1 / (2·‖Σ‖∞) is the reciprocal of an upper bound on the
 * gradient's Lipschitz constant (Gershgorin bounds the spectral radius by the max absolute row
 * sum), so every step is a descent and the iteration converges.
 */
function minimizeVarianceOnSimplex(covariance: number[][]): {
  weights: number[];
  iterations: number;
  converged: boolean;
} {
  const n = covariance.length;
  const lipschitzBound = Math.max(
    ...covariance.map((row) => row.reduce((total, value) => total + Math.abs(value), 0)),
  );
  const stepSize = 1 / (2 * lipschitzBound);

  let weights = new Array<number>(n).fill(1 / n);
  let iterations = 0;
  let converged = false;

  while (iterations < MIN_VARIANCE_MAX_ITERATIONS) {
    const gradient = covariance.map((row) => 2 * row.reduce((total, value, j) => total + value * weights[j], 0));
    const stepped = weights.map((weight, i) => weight - stepSize * gradient[i]);
    const next = projectOntoSimplex(stepped);
    iterations += 1;

    let maxChange = 0;
    for (let i = 0; i < n; i += 1) maxChange = Math.max(maxChange, Math.abs(next[i] - weights[i]));
    weights = next;
    if (maxChange < MIN_VARIANCE_CONVERGENCE_TOLERANCE) {
      converged = true;
      break;
    }
  }

  return { weights, iterations, converged };
}

/**
 * Exact Euclidean projection of a vector onto the probability simplex {w : wᵢ ≥ 0, Σwᵢ = 1}
 * (Held–Wolfe–Crowder / Duchi): sort descending, find the largest prefix whose thresholded values
 * stay positive, and subtract the resulting threshold. Deterministic and O(n log n).
 */
function projectOntoSimplex(vector: number[]): number[] {
  const sorted = [...vector].sort((left, right) => right - left);
  let cumulative = 0;
  let threshold = 0;
  for (let j = 0; j < sorted.length; j += 1) {
    cumulative += sorted[j];
    const candidate = (cumulative - 1) / (j + 1);
    if (sorted[j] - candidate > 0) threshold = candidate;
  }
  return vector.map((value) => Math.max(value - threshold, 0));
}

/** The quadratic form wᵀΣw: the sample variance of the weighted daily portfolio return. */
function quadraticForm(matrix: number[][], vector: number[]): number {
  let total = 0;
  for (let i = 0; i < vector.length; i += 1) {
    for (let j = 0; j < vector.length; j += 1) total += vector[i] * matrix[i][j] * vector[j];
  }
  return total;
}

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

/**
 * Root-mean-square shortfall below a daily target, averaged over EVERY value (not only the
 * shortfall days). Values at or above the target contribute zero. This is the Sortino & Satchell
 * target semideviation and the denominator of the Sortino ratio.
 */
function targetDownsideDeviation(values: number[], dailyTarget: number): number {
  const sumSquaredShortfall = values.reduce((total, value) => {
    const shortfall = Math.min(0, value - dailyTarget);
    return total + shortfall * shortfall;
  }, 0);
  return Math.sqrt(sumSquaredShortfall / values.length);
}
