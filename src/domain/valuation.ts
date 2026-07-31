// Purpose: Pure, inspectable unlevered (FCFF) DCF valuation engine plus deterministic
// scenario, sensitivity, and current-price comparison helpers.
//
// Scope and conventions:
// - Educational, analyst-grade valuation. This module NEVER names an output "fair value",
//   never ranks a scenario as "best", never emits a recommendation, and never invents a
//   market assumption. Every input is supplied by the caller; every formula is explicit.
// - All rates are explicit decimal fractions (0.10 is 10%, -0.02 is -2%). Money is in the
//   caller's own revenue units (dollars, millions, whatever the caller passed) — the engine
//   only multiplies and discounts, it never assumes a scale.
// - Full internal precision is preserved. Nothing here rounds, truncates, or formats for
//   display; the UI layer owns all rounding.
// - Deterministic: no clock, no randomness, no I/O. The same inputs always produce the same
//   valuation.
// - The current market price is NEVER read inside DCF math. Upside/downside is a separate,
//   date-bearing helper (`compareToCurrentPrice`) so a valuation date and a quote date can
//   never be silently mixed.
//
// Modeling conventions chosen here (named so they cannot be confused):
// - Per-year assumptions accept EITHER a single scalar (expanded across every forecast year)
//   OR an explicit vector whose length equals `forecastYears`. See `YearlyRate`.
// - Change in net working capital uses the INCREMENTAL-REVENUE convention:
//       ΔNWC_t = nwcPercentOfIncrementalRevenue_t × (Revenue_t − Revenue_(t-1))
//   with Revenue_0 = baseRevenue. A positive percent is a cash USE as the business grows;
//   a negative percent is a working-capital RELEASE. The field name states the convention.
// - Terminal value is a Gordon-growth perpetuity struck at the END of the final forecast
//   year and discounted back N periods (standard end-of-year discount timing).
// - Tax is charged on POSITIVE EBIT only: NOPAT = EBIT − max(EBIT, 0) × cashTaxRate. This engine
//   models no net operating losses or deferred tax assets, so it never imputes a cash tax benefit
//   on an operating loss — the loss flows through in full. This is the conservative educational
//   stance: a naive EBIT × (1 − tax) would shrink a loss and quietly overstate FCFF and value.

/** Raised for any invalid assumption or degenerate valuation. Fails closed with a specific message. */
export class ValuationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValuationError';
  }
}

/** A per-forecast-year assumption: one scalar expanded across years, or an explicit per-year vector. */
export type YearlyRate = number | readonly number[];

/**
 * Complete assumption set for one unlevered DCF. Every field is user-owned; the engine
 * assumes nothing. Rates are decimals.
 */
export interface DcfAssumptions {
  /** Year-0 (base) revenue. Must be finite and strictly positive. */
  baseRevenue: number;
  /** Number of explicit annual forecast periods. Integer within {@link VALUATION_BOUNDS.forecastYears}. */
  forecastYears: number;
  /** Revenue growth per forecast year. Revenue_t = Revenue_(t-1) × (1 + growth_t). */
  revenueGrowth: YearlyRate;
  /** Operating (EBIT) margin per forecast year. EBIT_t = Revenue_t × operatingMargin_t. */
  operatingMargin: YearlyRate;
  /**
   * Cash tax rate applied to POSITIVE EBIT only. NOPAT_t = EBIT_t − max(EBIT_t, 0) × cashTaxRate,
   * so an operating loss is carried in full with no imputed tax benefit (no NOL modeling here).
   */
  cashTaxRate: number;
  /** Depreciation & amortization as a fraction of that year's revenue. */
  daPercentOfRevenue: YearlyRate;
  /** Capital expenditure as a fraction of that year's revenue. */
  capexPercentOfRevenue: YearlyRate;
  /** ΔNWC as a fraction of INCREMENTAL revenue (Revenue_t − Revenue_(t-1)). See module header. */
  nwcPercentOfIncrementalRevenue: YearlyRate;
  /** Weighted average cost of capital. Strictly positive and strictly greater than terminalGrowth. */
  wacc: number;
  /** Perpetuity growth rate used for terminal value. Must be strictly less than wacc. */
  terminalGrowth: number;
  /** Net debt = total debt − cash & equivalents. May be negative (net cash). */
  netDebt: number;
  /** Diluted shares outstanding. Must be finite and strictly positive. */
  dilutedShares: number;
}

/** One fully expanded annual forecast row. All values are unrounded. */
export interface DcfForecastRow {
  /** Forecast period index, 1-based. */
  year: number;
  revenue: number;
  revenueGrowth: number;
  operatingMargin: number;
  ebit: number;
  nopat: number;
  da: number;
  capex: number;
  /** ΔNWC for the year under the incremental-revenue convention. */
  changeInNwc: number;
  /** Free cash flow to the firm: NOPAT + D&A − CapEx − ΔNWC. May be negative. */
  fcff: number;
  /** 1 / (1 + wacc)^year. */
  discountFactor: number;
  /** fcff × discountFactor. */
  presentValue: number;
}

/** The terminal-value derivation, exposed so the perpetuity math is fully auditable. */
export interface TerminalValueBridge {
  /** FCFF of the final explicit forecast year (FCFF_N). */
  finalYearFcff: number;
  terminalGrowth: number;
  wacc: number;
  /** FCFF_(N+1) = FCFF_N × (1 + terminalGrowth). */
  terminalYearFcff: number;
  /** Undiscounted terminal value at the end of year N: FCFF_(N+1) / (wacc − terminalGrowth). */
  terminalValue: number;
  /** Discount factor at year N. */
  discountFactor: number;
  /** Present value of the terminal value. */
  presentValueOfTerminal: number;
}

/** The enterprise-value → equity-value → per-share bridge. */
export interface EnterpriseToEquityBridge {
  /** Sum of the discounted explicit-forecast FCFF. */
  sumPresentValueFcff: number;
  presentValueOfTerminal: number;
  enterpriseValue: number;
  netDebt: number;
  /** enterpriseValue − netDebt. May be negative; never clamped. */
  equityValue: number;
  dilutedShares: number;
  /** equityValue / dilutedShares. May be negative; never clamped. */
  impliedSharePrice: number;
}

/** A complete, inspectable valuation result. */
export interface DcfValuation {
  /** The assumptions exactly as supplied, echoed for provenance. */
  assumptions: DcfAssumptions;
  rows: DcfForecastRow[];
  terminal: TerminalValueBridge;
  bridge: EnterpriseToEquityBridge;
  /** Convenience mirror of `bridge.impliedSharePrice`. */
  impliedSharePrice: number;
  /**
   * presentValueOfTerminal / enterpriseValue, as a decimal fraction, or `null` when enterprise
   * value is exactly zero (the ratio is 0/0 and genuinely undefined). The rest of the valuation —
   * the equity bridge and the implied share price — stays available even in that case.
   */
  terminalValuePercentOfEnterprise: number | null;
}

/**
 * Economically interpretable bounds. These are deliberately wide enough to express a
 * legitimate bear case (revenue decline, operating losses, working-capital release) while
 * still rejecting nonsensical inputs (revenue that vanishes past −100%, a negative cash tax
 * rate, a WACC of zero). Every bound is inclusive of both endpoints unless noted.
 */
export const VALUATION_BOUNDS = Object.freeze({
  /**
   * −99% collapse up to +100%/yr. Below −1 revenue goes non-positive. The upper cap is
   * deliberately 100% (a single-year doubling): applied per year in a single-stage DCF, a growth
   * rate above that compounds to implausible revenue and silently inflates value. Genuine
   * hypergrowth belongs in a declining per-year vector or a multi-stage model, not one scalar.
   */
  revenueGrowth: { min: -0.99, max: 1 },
  /** Deep operating losses (EBIT of −200% of revenue) up to a 100% operating margin. */
  operatingMargin: { min: -2, max: 1 },
  /** A cash tax rate is a fraction of positive EBIT; kept in [0, 1]. */
  cashTaxRate: { min: 0, max: 1 },
  /** D&A cannot be negative and rarely exceeds revenue. */
  daPercentOfRevenue: { min: 0, max: 1 },
  /** CapEx is non-negative; a heavy build year may exceed revenue, so up to 200%. */
  capexPercentOfRevenue: { min: 0, max: 2 },
  /** Working capital can be a use (+) or a release (−) of up to 100% of incremental revenue. */
  nwcPercentOfIncrementalRevenue: { min: -1, max: 1 },
  /** WACC is strictly positive (enforced separately) and capped at 100%. */
  wacc: { min: 0, max: 1 },
  /** Terminal growth may be negative (secular decline); must also be < wacc (enforced separately). */
  terminalGrowth: { min: -1, max: 1 },
  /** Forecast horizon, integer. */
  forecastYears: { min: 1, max: 30 },
} as const);

interface Bound {
  min: number;
  max: number;
}

// --- Core valuation ---------------------------------------------------------

/**
 * Builds a full unlevered DCF from an explicit assumption set. Throws {@link ValuationError}
 * for any invalid input or degenerate result; it never clamps a bad result into looking valid.
 *
 * Negative outcomes are honest, not hidden: a negative FCFF discounts to a negative present
 * value, a negative equity value yields a negative implied price, and a negative final-year
 * FCFF produces a negative terminal value. None of these become NaN or Infinity — the input
 * validation and the strict WACC > terminalGrowth gate guarantee finiteness.
 */
export function buildDcfValuation(assumptions: DcfAssumptions): DcfValuation {
  const {
    baseRevenue,
    forecastYears,
    cashTaxRate,
    wacc,
    terminalGrowth,
    netDebt,
    dilutedShares,
  } = assumptions;

  requireFiniteInteger(forecastYears, 'forecastYears', VALUATION_BOUNDS.forecastYears);
  requireFinitePositive(baseRevenue, 'baseRevenue');
  requireFinitePositive(dilutedShares, 'dilutedShares');
  requireFinite(netDebt, 'netDebt');
  requireBounded(cashTaxRate, 'cashTaxRate', VALUATION_BOUNDS.cashTaxRate);
  requireBounded(wacc, 'wacc', VALUATION_BOUNDS.wacc);
  if (wacc <= 0) {
    throw new ValuationError('WACC must be strictly positive to discount future cash flows.');
  }
  requireBounded(terminalGrowth, 'terminalGrowth', VALUATION_BOUNDS.terminalGrowth);
  if (!(wacc > terminalGrowth)) {
    throw new ValuationError(
      'WACC must be strictly greater than the terminal growth rate; otherwise the terminal value is undefined or negative-denominator. Lower the terminal growth rate or raise WACC.',
    );
  }

  const growth = expandYearly(assumptions.revenueGrowth, forecastYears, 'revenueGrowth', VALUATION_BOUNDS.revenueGrowth);
  const margin = expandYearly(assumptions.operatingMargin, forecastYears, 'operatingMargin', VALUATION_BOUNDS.operatingMargin);
  const daPct = expandYearly(assumptions.daPercentOfRevenue, forecastYears, 'daPercentOfRevenue', VALUATION_BOUNDS.daPercentOfRevenue);
  const capexPct = expandYearly(assumptions.capexPercentOfRevenue, forecastYears, 'capexPercentOfRevenue', VALUATION_BOUNDS.capexPercentOfRevenue);
  const nwcPct = expandYearly(
    assumptions.nwcPercentOfIncrementalRevenue,
    forecastYears,
    'nwcPercentOfIncrementalRevenue',
    VALUATION_BOUNDS.nwcPercentOfIncrementalRevenue,
  );

  const rows: DcfForecastRow[] = [];
  let previousRevenue = baseRevenue;
  let sumPresentValueFcff = 0;

  for (let year = 1; year <= forecastYears; year += 1) {
    const i = year - 1;
    const revenue = previousRevenue * (1 + growth[i]);
    const ebit = revenue * margin[i];
    // Tax is applied only to positive EBIT. A simple DCF with no NOL / deferred-tax-asset
    // modeling must not impute a cash tax *benefit* on an operating loss — doing so would
    // shrink the loss and overstate FCFF and value. So NOPAT = EBIT − max(EBIT, 0) × tax:
    // identical to EBIT × (1 − tax) when EBIT ≥ 0, and the full, untaxed loss when EBIT < 0.
    const nopat = ebit - Math.max(ebit, 0) * cashTaxRate;
    const da = revenue * daPct[i];
    const capex = revenue * capexPct[i];
    const changeInNwc = nwcPct[i] * (revenue - previousRevenue);
    const fcff = nopat + da - capex - changeInNwc;
    const discountFactor = 1 / Math.pow(1 + wacc, year);
    const presentValue = fcff * discountFactor;

    rows.push({
      year,
      revenue,
      revenueGrowth: growth[i],
      operatingMargin: margin[i],
      ebit,
      nopat,
      da,
      capex,
      changeInNwc,
      fcff,
      discountFactor,
      presentValue,
    });

    sumPresentValueFcff += presentValue;
    previousRevenue = revenue;
  }

  const finalYearFcff = rows[rows.length - 1].fcff;
  const terminalYearFcff = finalYearFcff * (1 + terminalGrowth);
  // wacc > terminalGrowth guaranteed above, so the denominator is strictly positive and finite.
  const terminalValue = terminalYearFcff / (wacc - terminalGrowth);
  const terminalDiscountFactor = 1 / Math.pow(1 + wacc, forecastYears);
  const presentValueOfTerminal = terminalValue * terminalDiscountFactor;

  const enterpriseValue = sumPresentValueFcff + presentValueOfTerminal;
  const equityValue = enterpriseValue - netDebt;
  const impliedSharePrice = equityValue / dilutedShares;

  // A zero enterprise value makes the terminal-value SHARE of enterprise value undefined (0/0).
  // That single ratio is reported as null rather than refusing the whole valuation: the equity
  // bridge (EV − netDebt) and the implied share price remain perfectly well defined and auditable,
  // so withholding only the undefined ratio is the honest, type-safe choice over failing closed.
  const terminalValuePercentOfEnterprise =
    enterpriseValue === 0 ? null : presentValueOfTerminal / enterpriseValue;

  const terminal: TerminalValueBridge = {
    finalYearFcff,
    terminalGrowth,
    wacc,
    terminalYearFcff,
    terminalValue,
    discountFactor: terminalDiscountFactor,
    presentValueOfTerminal,
  };
  const bridge: EnterpriseToEquityBridge = {
    sumPresentValueFcff,
    presentValueOfTerminal,
    enterpriseValue,
    netDebt,
    equityValue,
    dilutedShares,
    impliedSharePrice,
  };

  // Defensive honesty gate: with validated finite inputs and a positive discount base this
  // cannot fire, but if an overflow ever produced a non-finite figure we refuse rather than
  // present it. It is intentionally the last step, after all math.
  assertAllFinite([
    ['sumPresentValueFcff', sumPresentValueFcff],
    ['terminalValue', terminalValue],
    ['presentValueOfTerminal', presentValueOfTerminal],
    ['enterpriseValue', enterpriseValue],
    ['equityValue', equityValue],
    ['impliedSharePrice', impliedSharePrice],
  ]);
  // The TV share of EV is either a finite number or a deliberate null (EV exactly zero); a
  // non-finite *number* would still be a bug, so gate it the same way as everything else.
  if (terminalValuePercentOfEnterprise !== null) {
    assertAllFinite([['terminalValuePercentOfEnterprise', terminalValuePercentOfEnterprise]]);
  }

  return {
    assumptions,
    rows,
    terminal,
    bridge,
    impliedSharePrice,
    terminalValuePercentOfEnterprise,
  };
}

// --- Scenario range ---------------------------------------------------------

/** One named scenario. The id is an identifier ONLY; every assumption is supplied explicitly. */
export interface DcfScenario {
  /** Free-form label such as 'bull' | 'base' | 'bear'. Never interpreted as a ranking. */
  id: string;
  assumptions: DcfAssumptions;
}

/** A scenario paired with its computed valuation. */
export interface DcfScenarioResult {
  id: string;
  valuation: DcfValuation;
}

/**
 * The numeric spread of implied prices across supplied scenarios. It reports the lowest and
 * highest implied prices as facts; it deliberately carries NO "best", "target", or
 * "recommended" field.
 */
export interface DcfScenarioRange {
  /** Results in the exact order the scenarios were supplied. */
  scenarios: DcfScenarioResult[];
  /** Minimum implied price across scenarios. */
  lowImpliedSharePrice: number;
  /** Maximum implied price across scenarios. */
  highImpliedSharePrice: number;
}

/**
 * Values each supplied scenario and returns them in input order alongside the numeric price
 * spread. The engine does NOT mechanically add or subtract arbitrary percentages to build the
 * scenarios; the caller owns every bull/base/bear assumption. No scenario is ever labelled best.
 */
export function buildScenarioRange(scenarios: readonly DcfScenario[]): DcfScenarioRange {
  if (scenarios.length === 0) {
    throw new ValuationError('At least one scenario is required to build a scenario range.');
  }

  const results: DcfScenarioResult[] = scenarios.map((scenario) => ({
    id: scenario.id,
    valuation: buildDcfValuation(scenario.assumptions),
  }));

  const prices = results.map((result) => result.valuation.impliedSharePrice);
  return {
    scenarios: results,
    lowImpliedSharePrice: Math.min(...prices),
    highImpliedSharePrice: Math.max(...prices),
  };
}

// --- Sensitivity tables -----------------------------------------------------

/** One sensitivity cell: either an available implied price, or an unavailable cell with a reason. */
export type SensitivityCell =
  | { available: true; impliedSharePrice: number }
  | { available: false; reason: string };

/** A labelled axis of assumption values driving a sensitivity table. */
export interface SensitivityAxis {
  label: string;
  values: number[];
}

/**
 * A two-axis grid of implied prices. `cells[r][c]` corresponds to `rowAxis.values[r]` and
 * `columnAxis.values[c]`. Invalid pairs (e.g. WACC ≤ terminal growth) are individual
 * unavailable cells; they never crash or blank the whole table.
 */
export interface SensitivityTable {
  rowAxis: SensitivityAxis;
  columnAxis: SensitivityAxis;
  cells: SensitivityCell[][];
}

/**
 * Implied price across a WACC (rows) × terminal-growth (columns) grid, holding all other
 * assumptions fixed. A pair that violates WACC > terminal growth — or any other bound — yields
 * an unavailable cell carrying the domain error message, so the surrounding grid still renders.
 */
export function buildWaccTerminalGrowthSensitivity(
  base: DcfAssumptions,
  waccValues: readonly number[],
  terminalGrowthValues: readonly number[],
): SensitivityTable {
  const cells = waccValues.map((wacc) =>
    terminalGrowthValues.map((terminalGrowth) =>
      safeImpliedPrice({ ...base, wacc, terminalGrowth }),
    ),
  );
  return {
    rowAxis: { label: 'wacc', values: [...waccValues] },
    columnAxis: { label: 'terminalGrowth', values: [...terminalGrowthValues] },
    cells,
  };
}

/**
 * Implied price across a revenue-growth (rows) × operating-margin (columns) grid. Each axis
 * value is applied as a SCALAR expanded across every forecast year, holding all other
 * assumptions fixed. Out-of-bounds axis values become unavailable cells, not table failures.
 */
export function buildGrowthMarginSensitivity(
  base: DcfAssumptions,
  revenueGrowthValues: readonly number[],
  operatingMarginValues: readonly number[],
): SensitivityTable {
  const cells = revenueGrowthValues.map((revenueGrowth) =>
    operatingMarginValues.map((operatingMargin) =>
      safeImpliedPrice({ ...base, revenueGrowth, operatingMargin }),
    ),
  );
  return {
    rowAxis: { label: 'revenueGrowth', values: [...revenueGrowthValues] },
    columnAxis: { label: 'operatingMargin', values: [...operatingMarginValues] },
    cells,
  };
}

// --- Comparable-company valuation ------------------------------------------

export type ComparableMetric = 'pe' | 'ev-revenue' | 'ev-ebitda';

export interface ComparableValuationInput {
  metric: ComparableMetric;
  /** EPS for P/E; total revenue or EBITDA for an enterprise-value multiple. */
  financialMetric: number;
  multiples: { low: number; median: number; high: number };
  /** Required for EV-based methods; net debt = debt minus cash, so net cash is negative. */
  netDebt?: number;
  /** Required for EV-based methods. */
  dilutedShares?: number;
}

export interface ComparableValuationResult {
  metric: ComparableMetric;
  impliedSharePrices: { low: number; median: number; high: number };
  multiples: { low: number; median: number; high: number };
  /** Explicit formula label for provenance in the view or report. */
  formula: 'multiple × EPS' | '(multiple × financial metric − net debt) ÷ diluted shares';
}

/**
 * Applies user-supplied peer multiples without inventing a peer set or ranking a method. For P/E,
 * the metric is positive diluted EPS. For EV/Revenue or EV/EBITDA, the multiple first produces
 * enterprise value and then uses the same explicit net-debt/share bridge as the DCF.
 */
export function buildComparableValuation(input: ComparableValuationInput): ComparableValuationResult {
  requireFinitePositive(input.financialMetric, 'financialMetric');
  const multiples = input.multiples;
  for (const [name, value] of Object.entries(multiples)) requireFinitePositive(value, `${name}Multiple`);
  if (!(multiples.low <= multiples.median && multiples.median <= multiples.high)) {
    throw new ValuationError('Comparable multiples must be ordered low ≤ median ≤ high.');
  }

  if (input.metric === 'pe') {
    return {
      metric: input.metric,
      multiples,
      impliedSharePrices: {
        low: multiples.low * input.financialMetric,
        median: multiples.median * input.financialMetric,
        high: multiples.high * input.financialMetric,
      },
      formula: 'multiple × EPS',
    };
  }

  if (input.netDebt === undefined || input.dilutedShares === undefined) {
    throw new ValuationError('EV-based comparable valuation requires net debt and diluted shares.');
  }
  requireFinite(input.netDebt, 'netDebt');
  requireFinitePositive(input.dilutedShares, 'dilutedShares');
  const price = (multiple: number) => (multiple * input.financialMetric - input.netDebt!) / input.dilutedShares!;
  const result: ComparableValuationResult = {
    metric: input.metric,
    multiples,
    impliedSharePrices: { low: price(multiples.low), median: price(multiples.median), high: price(multiples.high) },
    formula: '(multiple × financial metric − net debt) ÷ diluted shares',
  };
  assertAllFinite(Object.entries(result.impliedSharePrices) as [string, number][]);
  return result;
}

function safeImpliedPrice(assumptions: DcfAssumptions): SensitivityCell {
  try {
    return { available: true, impliedSharePrice: buildDcfValuation(assumptions).impliedSharePrice };
  } catch (error) {
    if (error instanceof ValuationError) {
      return { available: false, reason: error.message };
    }
    throw error;
  }
}

// --- Current-price comparison (separate, date-bearing) ----------------------

/**
 * Inputs for comparing a DCF implied price to a live market quote. The implied price is passed
 * in — this helper never reaches into DCF math — and both dates are required so a stale quote
 * can never be silently compared against a fresh valuation.
 */
export interface CurrentPriceComparisonInput {
  impliedSharePrice: number;
  currentPrice: number;
  /** ISO date the valuation's assumptions were struck. */
  valuationDate: string;
  /** ISO date the current price was observed. */
  quoteDate: string;
}

/** The dated upside/downside comparison. `upsideDownside` is a decimal fraction. */
export interface CurrentPriceComparison {
  impliedSharePrice: number;
  currentPrice: number;
  valuationDate: string;
  quoteDate: string;
  /** (impliedSharePrice − currentPrice) / currentPrice. Positive is upside, negative is downside. */
  upsideDownside: number;
}

/**
 * Compares an implied share price to a current market price and returns the dated
 * upside/downside. Deliberately kept apart from the DCF engine: it accepts an already-computed
 * implied price and refuses unless a finite, strictly positive current price and both dates are
 * supplied. It returns a comparison only — never a buy/sell judgement.
 */
export function compareToCurrentPrice(input: CurrentPriceComparisonInput): CurrentPriceComparison {
  const { impliedSharePrice, currentPrice, valuationDate, quoteDate } = input;

  if (!Number.isFinite(impliedSharePrice)) {
    throw new ValuationError('The implied share price must be a finite number to compare against a market price.');
  }
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new ValuationError('A finite, strictly positive current market price is required for an upside/downside comparison.');
  }
  if (!isValidIsoDate(valuationDate) || !isValidIsoDate(quoteDate)) {
    throw new ValuationError(
      'Both a valuation date and a quote date must be supplied as ISO calendar dates (YYYY-MM-DD) so the comparison is unambiguously dated.',
    );
  }

  return {
    impliedSharePrice,
    currentPrice,
    valuationDate,
    quoteDate,
    upsideDownside: (impliedSharePrice - currentPrice) / currentPrice,
  };
}

// --- Validation helpers -----------------------------------------------------

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new ValuationError(`${name} must be a finite number.`);
  }
}

function requireFinitePositive(value: number, name: string): void {
  requireFinite(value, name);
  if (value <= 0) {
    throw new ValuationError(`${name} must be strictly greater than zero.`);
  }
}

function requireFiniteInteger(value: number, name: string, bound: Bound): void {
  if (!Number.isInteger(value)) {
    throw new ValuationError(`${name} must be a whole number of years.`);
  }
  if (value < bound.min || value > bound.max) {
    throw new ValuationError(`${name} must be between ${bound.min} and ${bound.max}.`);
  }
}

function requireBounded(value: number, name: string, bound: Bound): void {
  requireFinite(value, name);
  if (value < bound.min || value > bound.max) {
    throw new ValuationError(
      `${name} must be between ${bound.min} and ${bound.max} (decimal fractions); received ${value}.`,
    );
  }
}

/**
 * Expands a scalar-or-vector per-year assumption to a fixed-length array and bounds-checks every
 * entry. A vector whose length does not match the forecast horizon is a hard error — silently
 * padding or truncating it would misstate the model.
 */
function expandYearly(value: YearlyRate, years: number, name: string, bound: Bound): number[] {
  if (typeof value === 'number') {
    requireBounded(value, name, bound);
    return Array.from({ length: years }, () => value);
  }
  if (value.length !== years) {
    throw new ValuationError(
      `${name} vector has ${value.length} entries but the forecast horizon is ${years} year(s). Supply one value per year or a single scalar.`,
    );
  }
  return value.map((entry, index) => {
    requireBounded(entry, `${name}[${index}]`, bound);
    return entry;
  });
}

function assertAllFinite(entries: [string, number][]): void {
  for (const [name, value] of entries) {
    if (!Number.isFinite(value)) {
      throw new ValuationError(`Internal error: ${name} resolved to a non-finite value and was withheld.`);
    }
  }
}

/**
 * Syntactic ISO 8601 calendar-date check, deliberately date-ONLY (`YYYY-MM-DD`). Restricting to a
 * date with no time or zone component sidesteps every timezone/locale ambiguity; the components are
 * validated arithmetically (real month, real day including leap years) WITHOUT `new Date()`, which
 * would otherwise reinterpret the string in the host timezone. This checks well-formedness only,
 * not whether the date is sensible relative to today — that remains the caller's concern.
 */
function isValidIsoDate(value: string): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    return false;
  }
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}
