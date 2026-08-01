// Purpose: Pure Portfolio Lab engine — allocates a fixed initial capital across long-only
// weights once, then measures what buy-and-hold did to that portfolio.
//
// Scope and conventions:
// - BUY-AND-HOLD ONLY. Capital is deployed once, on the first trading date every holding shares.
//   Share counts are fractional and then fixed forever: nothing is rebalanced, trimmed, topped up,
//   or drifted back toward the target weights. A holding that doubles simply becomes a larger
//   fraction of the portfolio, and that drift is reported rather than corrected.
// - Only `close` is read, so every figure here is a price return: dividends are intentionally
//   excluded and totals understate total return. Closes are expected to be split-adjusted.
// - Every rate, return, weight, and drawdown is a decimal fraction (0.05 is +5%, -0.2 is a 20%
//   drawdown). Nothing here converts to percent, rounds for display, or formats.
// - Deterministic: no clock, no randomness, no I/O. The risk-free rate is always supplied by the
//   caller, never assumed.
// - Every holding is measured over the exact intersection of the holdings' trading dates. One
//   holding listing later, or missing a session, shortens the window for all of them; nothing is
//   back-filled, carried forward, or read as a zero return.
// - `undefined` means "not computable from this data", never zero.
// - Sectors are never inferred. `MarketData` carries no sector field, so sector concentration is
//   reported as explicitly unavailable rather than guessed from the ticker, name, or type.
// - The risk diagnosis is educational: it emits translation codes describing what this history
//   did. It never ranks a holding, never recommends a weight, and never forecasts.

import {
  AnalyticsError,
  CALENDAR_DAYS_PER_YEAR,
  HOLDING_CONCENTRATION_THRESHOLD,
  annualizedSharpeRatio,
  annualizedSortinoRatio,
  annualizedVolatility,
  beta as betaOf,
  compoundAnnualGrowthRate,
  correlation,
  cumulativePriceReturns,
  historicalValueAtRisk,
  jensenAlpha,
  maxCloseDrawdown,
  resolveReturnBasis,
  riskSampleStatus,
  toReturnBasisBars,
  validatePriceSeries,
  validateWeights,
} from '@/domain/analytics';
import type {
  ConcentrationFlag,
  DatedValue,
  MaxDrawdownResult,
  ReturnBasis,
  RiskSampleStatus,
  WeightedHolding,
} from '@/domain/analytics';
import {
  classifyDrawdown,
  classifyVolatility,
  normalizeSymbol,
} from '@/domain/market-overview';
import type { DrawdownBand, VolatilityBand } from '@/domain/market-overview';
import { MIN_COMMON_CLOSES, buildCorrelationMatrix, commonTradingDates } from '@/domain/stock-comparison';
import type { CorrelationMatrix } from '@/domain/stock-comparison';
import type { DateString, MarketData, PriceBar } from '@/types/backtest';
import { daysBetween } from '@/utils/date';

/** A portfolio needs at least one holding; one holding is a degenerate but honest portfolio. */
export const MIN_PORTFOLIO_HOLDINGS = 1;

/** Above ten holdings the weight editor, attribution table, and correlation grid stop being readable. */
export const MAX_PORTFOLIO_HOLDINGS = 10;

/**
 * How far the attribution may drift from the portfolio total before the cross-check fails,
 * as a fraction of the capital actually allocated. The per-holding contributions are the same
 * dollars as the portfolio gain, summed in a different order, so only floating-point rounding
 * can separate them; anything larger means the allocation and the totals disagree.
 */
export const ATTRIBUTION_CROSS_CHECK_TOLERANCE = 1e-9;

/**
 * The confidence the portfolio's historical one-day VaR is stated at. Fixed at 95% here, and
 * passed EXPLICITLY into the pure `historicalValueAtRisk` helper so the default lives in the view
 * layer, never hidden inside the math.
 */
export const PORTFOLIO_VAR_CONFIDENCE = 0.95;

/** Upper bounds, exclusive, for each effective-holdings concentration band. */
export const EFFECTIVE_HOLDINGS_BAND_LIMITS = { concentrated: 2, focused: 4 } as const;

export type ConcentrationBand = 'concentrated' | 'focused' | 'diversified';

/**
 * Bands the initial weights by how many equally weighted holdings they behave like, so a
 * 90/10 pair reads as concentrated rather than as "two holdings".
 */
export function classifyConcentration(effectiveHoldings: number): ConcentrationBand {
  if (effectiveHoldings < EFFECTIVE_HOLDINGS_BAND_LIMITS.concentrated) return 'concentrated';
  if (effectiveHoldings < EFFECTIVE_HOLDINGS_BAND_LIMITS.focused) return 'focused';
  return 'diversified';
}

// --- Inputs -----------------------------------------------------------------

export interface PortfolioLabHoldingInput {
  marketData: MarketData;
  /** Target portfolio weight as a fraction; long-only, so never negative. */
  weight: number;
}

export interface PortfolioLabRequest {
  /** One to ten holdings; tickers are compared case-insensitively and must be distinct. */
  holdings: PortfolioLabHoldingInput[];
  /** Capital deployed once, on the first common trading date; must be finite and positive. */
  initialCapital: number;
  /** Benchmark for beta and correlation, normally SPY. */
  benchmark?: MarketData;
  /** Annual risk-free rate as a decimal fraction; required, never defaulted. */
  annualRiskFreeRate: number;
}

// --- Outputs ----------------------------------------------------------------

/** One holding, bought once at the first common close and then left alone. */
export interface PortfolioLabHolding {
  /** Ticker trimmed and uppercased; the identity used everywhere downstream. */
  symbol: string;
  name: string;
  /** Instrument type as the data source classified it, for example `CS` or `ETF`. */
  type: string;
  currency: string;
  /** Honest provider attribution copied from the loaded data: `yahoo`, `hybrid`, or `demo`. */
  source: 'yahoo' | 'hybrid' | 'demo';
  /** Bars the caller supplied, not bars used. */
  suppliedBars: number;
  suppliedFirstDate: DateString;
  suppliedLastDate: DateString;
  /** Common sessions actually measured; identical for every holding in the portfolio. */
  usedSessions: number;
  usedFirstDate: DateString;
  usedLastDate: DateString;
  /** Weight the caller asked for, before any price movement drifted it. */
  targetWeight: number;
  /** Close on the first common date, the single price at which this holding was bought. */
  entryClose: number;
  /** Close on the last common date. */
  finalClose: number;
  /** Fractional shares bought once and then held unchanged for the whole window. */
  shares: number;
  /** Capital deployed here: `shares * entryClose`, which is `initialCapital * targetWeight`. */
  initialAllocation: number;
  /** `shares * finalClose`; no rebalancing cash ever entered or left this holding. */
  finalValue: number;
  /** Share of the final portfolio value this holding drifted to; not the target weight. */
  finalWeight: number;
  /** Price return (split-adjusted close) of this holding across the common window. */
  priceReturn: number;
  /** Vendor-adjusted total return across the window; present only with adjusted-close coverage. */
  totalReturn?: number;
  /** Dollars this holding added to, or took from, the portfolio: `finalValue - initialAllocation`. */
  contributionDollars: number;
  /**
   * This holding's share of the portfolio's total return, as a decimal fraction of allocated
   * capital: 0.05 means it added 5 percentage points. Summing these reproduces the portfolio
   * total return, which `attribution` cross-checks.
   */
  contributionToTotalReturn: number;
  /** Close-to-close returns between consecutive common dates; n sessions yield n-1 points. */
  dailyReturns: DatedValue[];
}

/** The exact date range every holding shares. */
export interface PortfolioWindow {
  startDate: DateString;
  endDate: DateString;
  /** Number of common trading sessions. */
  sessions: number;
  /** Every common date, ascending. */
  dates: DateString[];
  calendarDays: number;
  /** `calendarDays` expressed in years, for labelling the window length. */
  years: number;
  /** Holdings whose own supplied history begins on `startDate`, so the window starts no earlier. */
  startLimitedBy: string[];
  /** Holdings whose own supplied history ends on `endDate`, so the window ends no later. */
  endLimitedBy: string[];
  /** Holdings that supplied more bars than the window used, so alignment shortened them. */
  shortenedFor: string[];
}

/**
 * Why sector concentration is absent. `MarketData` has no sector field, and a sector guessed
 * from a ticker, a company name, or an instrument type would be a fabricated diagnostic, so
 * this workspace states the gap instead of filling it.
 */
export interface SectorConcentrationAvailability {
  available: false;
  /** Translation code for the explanation; no prose is produced here. */
  reason: 'sector-data-unavailable';
}

/** Concentration of the initial target weights, before price movement drifted them. */
export interface PortfolioConcentration {
  largestWeight: number;
  largestWeightSymbol: string;
  /** Herfindahl-Hirschman index of the target weights; 1/n when equally weighted, 1 for one holding. */
  herfindahlIndex: number;
  /** Reciprocal of the HHI: how many equally weighted holdings the portfolio behaves like. */
  effectiveHoldings: number;
  band: ConcentrationBand;
  /** Educational flags for holdings above `HOLDING_CONCENTRATION_THRESHOLD`; never advice. */
  flags: ConcentrationFlag[];
  sector: SectorConcentrationAvailability;
}

/**
 * Proof that the per-holding attribution and the portfolio totals are the same arithmetic.
 * Both sides are exact sums of the same dollars, so only floating-point rounding separates them.
 */
export interface AttributionCrossCheck {
  /** Sum of every holding's `contributionDollars`. */
  contributionDollars: number;
  /** Portfolio gain measured directly: `finalValue - allocatedCapital`. */
  portfolioGain: number;
  /** `contributionDollars - portfolioGain`; zero but for floating-point rounding. */
  dollarDifference: number;
  /** Sum of every holding's `contributionToTotalReturn`. */
  contributionToTotalReturn: number;
  /** Portfolio total return measured directly. */
  totalPriceReturn: number;
  /** `contributionToTotalReturn - totalPriceReturn`; zero but for floating-point rounding. */
  returnDifference: number;
  /** `ATTRIBUTION_CROSS_CHECK_TOLERANCE`, echoed so the view can state the bound it was held to. */
  tolerance: number;
  /** True when both differences are inside the tolerance. */
  withinTolerance: boolean;
}

export interface PortfolioLabBenchmark {
  symbol: string;
  name: string;
  type: string;
  /** Common sessions the benchmark also traded; the only sessions beta and correlation use. */
  overlappingSessions: number;
  /** First common session the benchmark also traded. */
  startDate?: DateString;
  /** Last common session the benchmark also traded. */
  endDate?: DateString;
  /** True when the benchmark traded on every common session. */
  coversCommonWindow: boolean;
  /** Beta of the portfolio against the benchmark; undefined with fewer than two shared returns. */
  beta?: number;
  /** Correlation of the portfolio with the benchmark; undefined when either series never moved. */
  correlation?: number;
  /**
   * Jensen-style annualized alpha of the portfolio against the benchmark, on the overlapping
   * sessions. Undefined whenever beta is unavailable, so alpha is never fabricated without the
   * beta it is defined against.
   */
  alpha?: number;
}

/** Codes the view translates through `t()`; no user-visible prose is produced here. */
export type PortfolioDiagnosisCode =
  | 'concentration-concentrated'
  | 'concentration-focused'
  | 'concentration-diversified'
  | 'concentration-holding-above-threshold'
  | 'drawdown-shallow'
  | 'drawdown-moderate'
  | 'drawdown-deep'
  | 'drawdown-severe'
  | 'volatility-calm'
  | 'volatility-normal'
  | 'volatility-elevated'
  | 'volatility-stressed'
  | 'benchmark-unavailable'
  | 'benchmark-partial-overlap'
  | 'common-window-shortened'
  | 'sector-data-unavailable'
  | 'price-return-only'
  | 'total-return-basis'
  | 'limited-sample'
  | 'no-rebalancing'
  | 'not-investment-advice';

/** What a diagnosis note is about, so the view can group notes without parsing codes. */
export type PortfolioDiagnosisTopic =
  | 'concentration'
  | 'drawdown'
  | 'volatility'
  | 'benchmark'
  | 'limitation';

/**
 * Severity for ordering and styling only. `warning` means this history was rough or this
 * portfolio is narrow, never that anything should be bought, sold, or changed.
 */
export type PortfolioDiagnosisSeverity = 'info' | 'caution' | 'warning';

export interface PortfolioDiagnosisNote {
  code: PortfolioDiagnosisCode;
  topic: PortfolioDiagnosisTopic;
  severity: PortfolioDiagnosisSeverity;
  /** The measured figure the code was derived from, when there is one. */
  value?: number;
  /** The holding the note refers to, when it refers to one. */
  symbol?: string;
}

/**
 * Educational reading of the measured window. Notes are emitted in a fixed order —
 * concentration, drawdown, volatility, benchmark, limitations — so the same portfolio always
 * produces the same list.
 */
export interface PortfolioRiskDiagnosis {
  notes: PortfolioDiagnosisNote[];
  concentrationBand: ConcentrationBand;
  drawdownBand: DrawdownBand;
  /** Absent only when the window was too short to measure volatility at all. */
  volatilityBand?: VolatilityBand;
  /** Always true: this diagnosis describes history and is not investment advice. */
  educationalOnly: true;
}

/**
 * Historical one-day Value at Risk of the portfolio's daily returns on `returnBasis`. A positive
 * `value` is a one-day loss as a decimal fraction: 0.05 means the portfolio lost 5% or more on
 * `1 - confidence` of the measured sessions. This is a historical threshold that was breached
 * `1 - confidence` of the time, NOT a maximum loss — realized losses beyond it were larger.
 * `value` is undefined below the minimum risk sample, and can be negative when even the lower-tail
 * quantile was itself a gain. `confidence`, `method`, and `sample` are always present, so the view
 * can state how the figure was produced even when the value is unavailable.
 */
export interface PortfolioValueAtRisk {
  /** Confidence level the loss threshold is stated at, e.g. 0.95. */
  confidence: number;
  /** Positive one-day loss as a decimal fraction; undefined below the minimum risk sample. */
  value?: number;
  /** The estimator: sorted returns, nearest-rank lower-tail quantile, no interpolation. */
  method: 'historical-nearest-rank';
  /** Daily returns behind the estimate; identical to `riskSample.observations`. */
  sample: number;
}

export interface PortfolioLabViewModel {
  /** Holdings in the order supplied, each measured on the common window. */
  holdings: PortfolioLabHolding[];
  /** Capital the caller supplied, echoed unchanged. */
  initialCapital: number;
  /**
   * Capital actually deployed at the entry closes, and the portfolio's value on the first
   * common session. Equal to `initialCapital` up to floating-point rounding, because the
   * weights are required to sum to 1 within `WEIGHT_SUM_TOLERANCE`.
   */
  allocatedCapital: number;
  /** Portfolio value on the last common session, from the fixed share counts. */
  finalValue: number;
  /** `finalValue - allocatedCapital`. */
  totalGain: number;
  /** Price return (split-adjusted close) across the whole common window. */
  totalPriceReturn: number;
  /**
   * Vendor-adjusted total return of the portfolio across the window; present only when
   * `returnBasis` is `total` (every holding has adjusted-close coverage). A proxy, not
   * audited dividend accounting.
   */
  totalReturn?: number;
  /** Portfolio dollar value on every common session, from the fixed share counts. */
  valueSeries: DatedValue[];
  /** Cumulative portfolio price return rebased to 0 on the first common session. */
  cumulativeReturns: DatedValue[];
  /** Close-to-close portfolio returns; n sessions yield n-1 points. */
  dailyReturns: DatedValue[];
  /** Compound annual growth rate of portfolio value; undefined when no time elapsed. */
  cagr?: number;
  /** Annualized volatility of the portfolio's daily returns on `returnBasis`; undefined below the minimum sample. */
  volatility?: number;
  /** Annualized Sharpe ratio over the common window; undefined when unavailable. */
  sharpeRatio?: number;
  /**
   * Annualized Sortino ratio over the common window, on the same MAR (the supplied risk-free rate)
   * as the Sharpe ratio. Undefined below the minimum sample and undefined — never Infinity — when
   * no session fell below the MAR so downside deviation is zero.
   */
  sortinoRatio?: number;
  /**
   * Historical one-day Value at Risk of the portfolio at `PORTFOLIO_VAR_CONFIDENCE`. The descriptor
   * is always present; its `value` is undefined below the minimum sample, gated identically to
   * `volatility`, `sharpeRatio`, and `sortinoRatio`.
   */
  historicalValueAtRisk: PortfolioValueAtRisk;
  /** Observation count behind the risk figures and whether the sample is sufficient/limited. */
  riskSample: RiskSampleStatus;
  /** Worst close-to-close decline of the portfolio on `returnBasis` inside the common window. */
  maxDrawdown: MaxDrawdownResult;
  window: PortfolioWindow;
  /** Concentration of the initial target weights. */
  concentration: PortfolioConcentration;
  /** Pearson correlations of the holdings' aligned daily price returns. */
  correlations: CorrelationMatrix;
  attribution: AttributionCrossCheck;
  /** Absent when the caller supplied no benchmark. */
  benchmark?: PortfolioLabBenchmark;
  diagnosis: PortfolioRiskDiagnosis;
  /** Echoed so the view can state which risk-free rate the Sharpe ratio used. */
  annualRiskFreeRate: number;
  /** Always false: share counts are fixed at the entry date and never adjusted. */
  rebalanced: false;
  /**
   * The return basis for every daily/cumulative/risk figure. Dollar figures (values,
   * allocations, attribution) stay on split-adjusted close regardless. `total` only when
   * every holding (and the benchmark, if any) has complete adjusted-close coverage.
   */
  returnBasis: ReturnBasis;
  /** True when `returnBasis` is `price`, so dividends are excluded from every figure. */
  excludesDividends: boolean;
}

/**
 * Builds the Portfolio Lab view model for a buy-and-hold portfolio.
 *
 * Throws `AnalyticsError` when the holding count is outside 1–10, when two entries name the same
 * ticker, when a ticker is blank, when any weight is negative or not finite, when the weights do
 * not sum to 1 within `WEIGHT_SUM_TOLERANCE`, when `initialCapital` is not a finite positive
 * number, when any price series is empty or cannot support return math, when the holdings share
 * fewer than `MIN_COMMON_CLOSES` trading dates, or when the risk-free rate is not a finite number
 * above -1. Metrics the common window is too short to support come back undefined, never zero.
 */
export function buildPortfolioLab(request: PortfolioLabRequest): PortfolioLabViewModel {
  const { holdings, initialCapital, benchmark, annualRiskFreeRate } = request;
  validateRiskFreeRate(annualRiskFreeRate);
  validateInitialCapital(initialCapital);

  const supplied = normalizeHoldings(holdings);
  // One basis for every risk figure: total return only when every holding and the
  // benchmark all carry complete adjusted-close coverage. Dollar figures stay on close.
  const returnBasis = resolveReturnBasis([
    ...supplied.map((entry) => entry.marketData.provenance.totalReturnCoverage),
    ...(benchmark ? [benchmark.provenance.totalReturnCoverage] : []),
  ]);

  const commonDates = commonTradingDates(supplied.map((entry) => entry.marketData.prices));
  if (commonDates.length < MIN_COMMON_CLOSES) {
    throw new AnalyticsError(
      `A portfolio needs at least ${MIN_COMMON_CLOSES} trading dates shared by every holding; ` +
        `these share ${commonDates.length}.`,
    );
  }

  const commonDateSet = new Set(commonDates);
  const alignedBars = supplied.map((entry) =>
    entry.marketData.prices.filter((bar) => commonDateSet.has(bar.date)),
  );
  const alignedBasisBars = alignedBars.map((bars) => toReturnBasisBars(bars, returnBasis));

  // One allocation, once, at the first common close. Shares are fixed from here on.
  const shares = supplied.map((entry, index) => (initialCapital * entry.weight) / alignedBars[index][0].close);
  // The dollar sleeve deployed to each holding: shares × raw entry close (= initialCapital × weight).
  const initialSleeves = supplied.map((entry, index) => shares[index] * alignedBars[index][0].close);

  // Dollar value series on split-adjusted close: real buy-and-hold dollars.
  const valueSeries = commonDates.map((date, dateIndex) => ({
    date,
    value: alignedBars.reduce((total, bars, index) => total + shares[index] * bars[dateIndex].close, 0),
  }));
  // Return-basis value series drives every risk figure. Each holding's initial dollar sleeve
  // is grown by its OWN normalized basis-close index (basisClose_t / basisClose_0), so the
  // vendor's raw adjusted-close scale cannot distort the fixed target weights: multiplying any
  // holding's adjusted-close axis by a positive constant leaves the index — and thus every
  // portfolio result — unchanged. On the price basis this reduces exactly to shares × close,
  // so the dollar path and the return path differ only when total return applies.
  const basisValueSeries = commonDates.map((date, dateIndex) => ({
    date,
    value: alignedBasisBars.reduce(
      (total, bars, index) => total + initialSleeves[index] * (bars[dateIndex].close / bars[0].close),
      0,
    ),
  }));
  const allocatedCapital = valueSeries[0].value;
  const finalValue = valueSeries[valueSeries.length - 1].value;

  const measured = supplied.map((entry, index) =>
    measureHolding(entry, alignedBars[index], alignedBasisBars[index], shares[index], allocatedCapital, finalValue),
  );

  const bars = valueBars(basisValueSeries);
  const dailyReturns = valueSeriesReturns(basisValueSeries);
  const volatility = annualizedVolatility(dailyReturns);
  const maxDrawdown = maxCloseDrawdown(bars);
  const totalPriceReturn = finalValue / allocatedCapital - 1;

  const concentration = analyzePortfolioConcentration(
    measured.map((holding) => ({ symbol: holding.symbol, weight: holding.targetWeight })),
  );
  const window = describeWindow(measured, commonDates);
  const benchmarkSummary =
    benchmark && measureBenchmark(benchmark, commonDates, basisValueSeries, returnBasis, annualRiskFreeRate);
  const riskSample = riskSampleStatus(dailyReturns.length);

  return {
    holdings: measured,
    initialCapital,
    allocatedCapital,
    finalValue,
    totalGain: finalValue - allocatedCapital,
    totalPriceReturn,
    totalReturn:
      returnBasis === 'total'
        ? basisValueSeries[basisValueSeries.length - 1].value / basisValueSeries[0].value - 1
        : undefined,
    valueSeries,
    cumulativeReturns: cumulativePriceReturns(bars),
    dailyReturns,
    // A very short window can turn a small move into an absurd annualized headline. Use the
    // same minimum sample gate as the risk statistics; total period return remains available.
    cagr: riskSample.sufficient ? compoundAnnualGrowthRate(bars) : undefined,
    volatility,
    sharpeRatio: annualizedSharpeRatio(dailyReturns, annualRiskFreeRate),
    sortinoRatio: annualizedSortinoRatio(dailyReturns, annualRiskFreeRate),
    historicalValueAtRisk: {
      confidence: PORTFOLIO_VAR_CONFIDENCE,
      // Explicit 95%: the pure helper carries no hidden default.
      value: historicalValueAtRisk(dailyReturns, PORTFOLIO_VAR_CONFIDENCE),
      method: 'historical-nearest-rank',
      sample: dailyReturns.length,
    },
    riskSample,
    maxDrawdown,
    window,
    concentration,
    correlations: buildCorrelationMatrix(
      measured.map((holding) => ({ symbol: holding.symbol, returns: holding.dailyReturns })),
    ),
    attribution: crossCheckAttribution(measured, allocatedCapital, finalValue, totalPriceReturn),
    benchmark: benchmarkSummary,
    diagnosis: diagnosePortfolioRisk({
      concentration,
      maxDrawdown,
      volatility,
      window,
      benchmark: benchmarkSummary,
      returnBasis,
      riskSample,
    }),
    annualRiskFreeRate,
    rebalanced: false,
    returnBasis,
    excludesDividends: returnBasis === 'price',
  };
}

/**
 * Close-to-close returns of a dated value series, each stamped with the later of the two dates.
 * A series of n points yields n-1 returns, exactly as `dailyCloseReturns` does for price bars.
 */
export function valueSeriesReturns(series: DatedValue[]): DatedValue[] {
  const returns: DatedValue[] = [];
  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1].value;
    if (previous <= 0 || !Number.isFinite(previous)) {
      throw new AnalyticsError(`Value on ${series[index - 1].date} is not a finite positive number.`);
    }
    returns.push({ date: series[index].date, value: series[index].value / previous - 1 });
  }
  return returns;
}

/**
 * Concentration of a set of target weights, plus the explicit statement that sector
 * concentration cannot be reported. Sector weights are deliberately not derived: `MarketData`
 * has no sector field, so every holding would land in one unclassified bucket, and a bucket
 * holding 100% of the portfolio reads as concentration when it is only missing data.
 */
export function analyzePortfolioConcentration(weights: WeightedHolding[]): PortfolioConcentration {
  validateWeights(weights);

  const largest = weights.reduce((best, entry) => (entry.weight > best.weight ? entry : best), weights[0]);
  const herfindahlIndex = weights.reduce((total, entry) => total + entry.weight ** 2, 0);
  const effectiveHoldings = herfindahlIndex > 0 ? 1 / herfindahlIndex : 0;

  return {
    largestWeight: largest.weight,
    largestWeightSymbol: largest.symbol,
    herfindahlIndex,
    effectiveHoldings,
    band: classifyConcentration(effectiveHoldings),
    flags: weights
      .filter((entry) => entry.weight > HOLDING_CONCENTRATION_THRESHOLD)
      .sort((left, right) => right.weight - left.weight || left.symbol.localeCompare(right.symbol))
      .map((entry) => ({
        kind: 'holding' as const,
        label: entry.symbol,
        weight: entry.weight,
        threshold: HOLDING_CONCENTRATION_THRESHOLD,
      })),
    sector: { available: false, reason: 'sector-data-unavailable' },
  };
}

/**
 * Educational codes for an already-measured portfolio: how concentrated the initial weights
 * were, how deep the worst decline was, which volatility band the window sat in, what the
 * benchmark could and could not support, and what these figures deliberately exclude.
 *
 * Emits codes only, in a fixed order, so the view supplies every word through `t()` and the
 * same portfolio always produces the same notes.
 */
export function diagnosePortfolioRisk(input: {
  concentration: PortfolioConcentration;
  maxDrawdown: MaxDrawdownResult;
  volatility?: number;
  window: PortfolioWindow;
  benchmark?: PortfolioLabBenchmark;
  returnBasis?: ReturnBasis;
  riskSample?: RiskSampleStatus;
}): PortfolioRiskDiagnosis {
  const { concentration, maxDrawdown, volatility, window, benchmark, returnBasis = 'price', riskSample } = input;
  const notes: PortfolioDiagnosisNote[] = [];

  const concentrationBand = concentration.band;
  notes.push({
    code: `concentration-${concentrationBand}` as PortfolioDiagnosisCode,
    topic: 'concentration',
    severity: CONCENTRATION_SEVERITY[concentrationBand],
    value: concentration.effectiveHoldings,
  });
  for (const flag of concentration.flags) {
    notes.push({
      code: 'concentration-holding-above-threshold',
      topic: 'concentration',
      severity: 'caution',
      value: flag.weight,
      symbol: flag.label,
    });
  }

  const drawdownBand = classifyDrawdown(maxDrawdown.drawdown);
  notes.push({
    code: `drawdown-${drawdownBand}` as PortfolioDiagnosisCode,
    topic: 'drawdown',
    severity: DRAWDOWN_SEVERITY[drawdownBand],
    value: maxDrawdown.drawdown,
  });

  const volatilityBand = volatility === undefined ? undefined : classifyVolatility(volatility);
  if (volatilityBand !== undefined) {
    notes.push({
      code: `volatility-${volatilityBand}` as PortfolioDiagnosisCode,
      topic: 'volatility',
      severity: VOLATILITY_SEVERITY[volatilityBand],
      value: volatility,
    });
  }

  if (!benchmark) {
    notes.push({ code: 'benchmark-unavailable', topic: 'benchmark', severity: 'info' });
  } else if (!benchmark.coversCommonWindow) {
    notes.push({
      code: 'benchmark-partial-overlap',
      topic: 'benchmark',
      severity: 'caution',
      value: benchmark.overlappingSessions,
      symbol: benchmark.symbol,
    });
  }

  if (window.shortenedFor.length > 0) {
    // Reported only when alignment actually cost a holding some of its own history.
    notes.push({
      code: 'common-window-shortened',
      topic: 'limitation',
      severity: 'info',
      value: window.sessions,
    });
  }
  if (riskSample?.limited) {
    // Reported when the risk sample is sufficient to compute but shorter than a trading year.
    notes.push({
      code: 'limited-sample',
      topic: 'limitation',
      severity: 'caution',
      value: riskSample.observations,
    });
  }
  notes.push({ code: 'sector-data-unavailable', topic: 'limitation', severity: 'info' });
  notes.push({
    code: returnBasis === 'total' ? 'total-return-basis' : 'price-return-only',
    topic: 'limitation',
    severity: 'info',
  });
  notes.push({ code: 'no-rebalancing', topic: 'limitation', severity: 'info' });
  notes.push({ code: 'not-investment-advice', topic: 'limitation', severity: 'info' });

  return { notes, concentrationBand, drawdownBand, volatilityBand, educationalOnly: true };
}

// --- Internal helpers -------------------------------------------------------

const CONCENTRATION_SEVERITY: Record<ConcentrationBand, PortfolioDiagnosisSeverity> = {
  concentrated: 'warning',
  focused: 'caution',
  diversified: 'info',
};

const DRAWDOWN_SEVERITY: Record<DrawdownBand, PortfolioDiagnosisSeverity> = {
  shallow: 'info',
  moderate: 'info',
  deep: 'caution',
  severe: 'warning',
};

const VOLATILITY_SEVERITY: Record<VolatilityBand, PortfolioDiagnosisSeverity> = {
  calm: 'info',
  normal: 'info',
  elevated: 'caution',
  stressed: 'warning',
};

interface NormalizedHolding {
  symbol: string;
  weight: number;
  marketData: MarketData;
}

function normalizeHoldings(holdings: PortfolioLabHoldingInput[]): NormalizedHolding[] {
  if (holdings.length < MIN_PORTFOLIO_HOLDINGS || holdings.length > MAX_PORTFOLIO_HOLDINGS) {
    throw new AnalyticsError(
      `A portfolio needs between ${MIN_PORTFOLIO_HOLDINGS} and ${MAX_PORTFOLIO_HOLDINGS} holdings; ` +
        `received ${holdings.length}.`,
    );
  }

  const seen = new Set<string>();
  const normalized = holdings.map((entry) => {
    const symbol = normalizeSymbol(entry.marketData.ticker);
    if (symbol.length === 0) {
      throw new AnalyticsError('Every holding needs a ticker; one entry has a blank ticker.');
    }
    if (seen.has(symbol)) {
      throw new AnalyticsError(`Holding ${symbol} appears more than once in the portfolio.`);
    }
    seen.add(symbol);

    if (entry.marketData.prices.length === 0) {
      throw new AnalyticsError(`Holding ${symbol} has no price history to measure.`);
    }
    validatePriceSeries(entry.marketData.prices);

    return { symbol, weight: entry.weight, marketData: entry.marketData };
  });

  // Rejects non-finite and negative weights, and any set that does not sum to 1 within tolerance.
  validateWeights(normalized);
  return normalized;
}

function measureHolding(
  entry: NormalizedHolding,
  aligned: PriceBar[],
  alignedBasis: PriceBar[],
  shares: number,
  allocatedCapital: number,
  portfolioFinalValue: number,
): PortfolioLabHolding {
  const { symbol, weight, marketData } = entry;
  const suppliedFirst = marketData.prices[0];
  const suppliedLast = marketData.prices[marketData.prices.length - 1];
  const entryClose = aligned[0].close;
  const finalClose = aligned[aligned.length - 1].close;
  const initialAllocation = shares * entryClose;
  const finalValue = shares * finalClose;
  const contributionDollars = finalValue - initialAllocation;
  const first = aligned[0];
  const last = aligned[aligned.length - 1];
  const totalReturn =
    marketData.provenance.totalReturnCoverage === 'yahoo-adjusted-close' &&
    first.adjustedClose !== undefined &&
    last.adjustedClose !== undefined
      ? last.adjustedClose / first.adjustedClose - 1
      : undefined;

  return {
    symbol,
    name: marketData.name,
    type: marketData.type,
    currency: marketData.currency,
    source: marketData.source,
    suppliedBars: marketData.prices.length,
    suppliedFirstDate: suppliedFirst.date,
    suppliedLastDate: suppliedLast.date,
    usedSessions: aligned.length,
    usedFirstDate: aligned[0].date,
    usedLastDate: aligned[aligned.length - 1].date,
    targetWeight: weight,
    entryClose,
    finalClose,
    shares,
    initialAllocation,
    finalValue,
    finalWeight: finalValue / portfolioFinalValue,
    priceReturn: finalClose / entryClose - 1,
    totalReturn,
    contributionDollars,
    contributionToTotalReturn: contributionDollars / allocatedCapital,
    // Correlations are measured on the comparison's return basis, so a total-return
    // comparison never correlates one holding's total returns against another's price returns.
    dailyReturns: dailyReturnsOf(alignedBasis),
  };
}

/** Close-to-close returns of aligned bars; two bars are the minimum that yields one return. */
function dailyReturnsOf(aligned: PriceBar[]): DatedValue[] {
  return valueSeriesReturns(aligned.map((bar) => ({ date: bar.date, value: bar.close })));
}

/**
 * The portfolio value series expressed as bars, so the shared close-based analytics — drawdown,
 * CAGR, cumulative return — apply to it unchanged. Only `close` is ever read; the other legs
 * exist to satisfy the shape and carry no separate meaning.
 */
function valueBars(series: DatedValue[]): PriceBar[] {
  return series.map((point) => ({
    date: point.date,
    open: point.value,
    high: point.value,
    low: point.value,
    close: point.value,
  }));
}

function crossCheckAttribution(
  holdings: PortfolioLabHolding[],
  allocatedCapital: number,
  finalValue: number,
  totalPriceReturn: number,
): AttributionCrossCheck {
  const contributionDollars = holdings.reduce((total, holding) => total + holding.contributionDollars, 0);
  const contributionToTotalReturn = holdings.reduce(
    (total, holding) => total + holding.contributionToTotalReturn,
    0,
  );
  const portfolioGain = finalValue - allocatedCapital;
  const dollarDifference = contributionDollars - portfolioGain;
  const returnDifference = contributionToTotalReturn - totalPriceReturn;

  return {
    contributionDollars,
    portfolioGain,
    dollarDifference,
    contributionToTotalReturn,
    totalPriceReturn,
    returnDifference,
    tolerance: ATTRIBUTION_CROSS_CHECK_TOLERANCE,
    withinTolerance:
      Math.abs(dollarDifference) <= ATTRIBUTION_CROSS_CHECK_TOLERANCE * allocatedCapital &&
      Math.abs(returnDifference) <= ATTRIBUTION_CROSS_CHECK_TOLERANCE,
  };
}

/**
 * Beta and correlation of the portfolio against the benchmark, measured only on the common
 * sessions the benchmark also traded. Both legs are rebuilt on that same date set, so a session
 * the benchmark missed never leaves the portfolio's return spanning two days against the
 * benchmark's one.
 */
function measureBenchmark(
  benchmark: MarketData,
  commonDates: DateString[],
  basisValueSeries: DatedValue[],
  basis: ReturnBasis,
  annualRiskFreeRate: number,
): PortfolioLabBenchmark {
  const symbol = normalizeSymbol(benchmark.ticker);
  if (benchmark.prices.length === 0) {
    throw new AnalyticsError(`Benchmark ${symbol} has no price history to compare against.`);
  }
  validatePriceSeries(benchmark.prices);

  const benchmarkDates = new Set(benchmark.prices.map((bar) => bar.date));
  const overlappingDates = commonDates.filter((date) => benchmarkDates.has(date));
  const overlapping = new Set(overlappingDates);

  // Both legs on the same basis; `basis` is only 'total' when the benchmark also has coverage.
  const benchmarkBars = toReturnBasisBars(
    benchmark.prices.filter((bar) => overlapping.has(bar.date)),
    basis,
  );
  const benchmarkReturns = benchmarkBars.length < 2 ? [] : dailyReturnsOf(benchmarkBars);
  const portfolioOnOverlap = basisValueSeries.filter((point) => overlapping.has(point.date));
  const portfolioReturns = portfolioOnOverlap.length < 2 ? [] : valueSeriesReturns(portfolioOnOverlap);

  return {
    symbol,
    name: benchmark.name,
    type: benchmark.type,
    overlappingSessions: overlappingDates.length,
    startDate: overlappingDates[0],
    endDate: overlappingDates[overlappingDates.length - 1],
    coversCommonWindow: overlappingDates.length === commonDates.length,
    beta: betaOf(portfolioReturns, benchmarkReturns),
    correlation: correlation(portfolioReturns, benchmarkReturns),
    // Same overlap and basis as beta; jensenAlpha returns undefined whenever beta is unavailable.
    alpha: jensenAlpha(portfolioReturns, benchmarkReturns, annualRiskFreeRate),
  };
}

function describeWindow(holdings: PortfolioLabHolding[], commonDates: DateString[]): PortfolioWindow {
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
    startLimitedBy: holdings
      .filter((holding) => holding.suppliedFirstDate === startDate)
      .map((holding) => holding.symbol),
    endLimitedBy: holdings
      .filter((holding) => holding.suppliedLastDate === endDate)
      .map((holding) => holding.symbol),
    shortenedFor: holdings
      .filter((holding) => holding.suppliedBars > commonDates.length)
      .map((holding) => holding.symbol),
  };
}

function validateRiskFreeRate(rate: number): void {
  if (!Number.isFinite(rate) || rate <= -1) {
    throw new AnalyticsError('The annual risk-free rate must be a finite number greater than -1.');
  }
}

function validateInitialCapital(capital: number): void {
  if (!Number.isFinite(capital) || capital <= 0) {
    throw new AnalyticsError('The initial capital must be a finite positive number.');
  }
}
