// Purpose: Shared domain contracts for forms, market data, calculations, and reports.

export type DateString = string;

export type InvestmentMode = 'amount' | 'shares';
export type IntervalUnit = 'trading-days' | 'weeks' | 'months' | 'years';
export type TaxMode = 'pre-tax' | 'after-tax';

export interface InvestmentPlan {
  mode: InvestmentMode;
  value: number;
  intervalValue: number;
  intervalUnit: IntervalUnit;
}

export interface PortfolioPositionInput {
  id: string;
  ticker: string;
  investment: InvestmentPlan;
}

export interface FeeRule {
  fixed: number;
  perShare: number;
  percentOfValue: number;
  minimum: number;
  maximum?: number;
}

/**
 * What an order is for. Fee schedules need this to apply the correct broker
 * branch: a cash/notional contribution buy sizes shares from a dollar budget, a
 * share-quantity contribution buys a whole or fractional lot, a dividend
 * reinvestment follows the DRIP scenario, and an end liquidation sells the
 * whole aggregate position and picks up regulatory sell fees.
 */
export type OrderPurpose =
  | 'contribution-cash'
  | 'contribution-shares'
  | 'dividend-reinvestment'
  | 'liquidation';

export type OrderSide = 'buy' | 'sell';

/**
 * Everything a broker fee schedule needs to price one modeled order. One modeled
 * order is treated as one execution; real partial fills can split it and change
 * per-execution minimums and caps, so a quote is an educational scenario, not a
 * broker statement.
 */
export interface OrderContext {
  purpose: OrderPurpose;
  side: OrderSide;
  /** Share quantity, already floored to the 0.001-share tick. */
  shares: number;
  /** Split-adjusted principal (execution price × shares) in dollars. */
  tradeValue: number;
  /** Execution price per share. */
  price: number;
}

/**
 * One auditable line of a fee quote. Regulatory pass-throughs are never folded
 * into the broker commission, so the audit and PDF can explain the total.
 */
export type FeeComponentKind =
  | 'commission'
  | 'platform'
  | 'settlement'
  | 'sec-31'
  | 'finra-taf'
  | 'cat'
  | 'custom';

export interface FeeComponent {
  kind: FeeComponentKind;
  /** Whole-cent amount after per-component rounding, floors, and caps. */
  amount: number;
}

export interface FeeBreakdown {
  components: FeeComponent[];
  /** Cent-denominated sum of every component. */
  total: number;
}

/** An official broker or regulator page a schedule was verified against. */
export interface FeeSourceRef {
  label: string;
  url: string;
}

export interface FeeConfig {
  brokerId: string;
  brokerName: string;
  /**
   * `preset` schedules are read-only, source-backed fee scenarios computed by the
   * versioned broker engine; their `buy`/`sell`/`dividendReinvestment` rules are
   * unused placeholders. `custom` schedules price every order from the editable
   * generic rules below and never receive hidden SEC/TAF/CAT charges.
   */
  kind: 'preset' | 'custom';
  buy: FeeRule;
  sell: FeeRule;
  dividendReinvestment: FeeRule;
  notes: string;
  /** Primary effective date of the modeled schedule (regulatory or broker). */
  effectiveDate: DateString;
  /** When the schedule was last checked against the official pages below. */
  checkedDate: DateString;
  /** Official broker/regulator pages backing a preset; empty for custom. */
  sources: FeeSourceRef[];
}

export interface BacktestInput {
  ticker: string;
  startDate: DateString;
  endDate: DateString;
  investment: InvestmentPlan;
  taxMode: TaxMode;
  dividendTaxRate: number;
  liquidateAtEnd: boolean;
  capitalGainsTaxRate: number;
  fees: FeeConfig;
  /**
   * Internal orchestration flag. When a holding is run inside a Portfolio report,
   * its capital-gain tax is deferred so gains and losses net across the whole
   * portfolio before a single flat-rate tax is applied. The holding still records
   * an auditable `realizedGainLoss`; it just does not subtract its own tax. A
   * standalone run leaves this unset and taxes the holding directly.
   */
  deferCapitalGainsTax?: boolean;
}

export interface PortfolioInput {
  positions: PortfolioPositionInput[];
  startDate: DateString;
  endDate: DateString;
  taxMode: TaxMode;
  dividendTaxRate: number;
  liquidateAtEnd: boolean;
  capitalGainsTaxRate: number;
  fees: FeeConfig;
}

export interface PriceBar {
  date: DateString;
  open: number;
  high: number;
  low: number;
  close: number;
  /**
   * Vendor-adjusted close aligned to this session, used only as a total-return
   * proxy. It reflects the price provider's own dividend-and-split back-adjustment;
   * it is NOT independently audited dividend accounting and is never used for DCA
   * execution, which always trades on the split-adjusted `high`/`close`. Present
   * only when the whole aligned adjusted-close axis was captured (see
   * `DataProvenance.totalReturnCoverage`); absent means total-return analytics fall
   * back to price return rather than mixing bases.
   */
  adjustedClose?: number;
  /** Daily share volume when the data source supplies it. */
  volume?: number;
  projected?: boolean;
}

export interface DividendEvent {
  id: string;
  exDate: DateString;
  payDate: DateString;
  cashAmount: number;
  splitAdjustedCashAmount: number;
  distributionType: string;
  frequency: number;
  projected?: boolean;
}

export interface SplitEvent {
  id: string;
  executionDate: DateString;
  splitFrom: number;
  splitTo: number;
  adjustmentType: string;
}

export interface TickerChangeEvent {
  date: DateString;
  ticker: string;
}

/** Purpose of a market-data request, which decides how strict provider coverage must be. */
export type MarketDataMode = 'analysis' | 'dca';

/**
 * Compact, honest description of where a security's data came from and exactly
 * which corporate-action checks were performed. It travels from the server
 * through reports, the UI rail, the assistant summary, and the PDF so no surface
 * can claim more assurance than was actually established.
 *
 * Residual limitation that every consumer must disclose: a corporate action that
 * is absent from *both* providers cannot be detected here.
 */
export interface DataProvenance {
  /** Stable classification used by every UI/export consumer before it renders market data. */
  sourceType: 'synthetic' | 'licensed-live';
  /** Human-readable provider or generator name; never implied from a ticker symbol. */
  provider: string;
  /** ISO timestamp for when this dataset was generated or fetched. */
  generatedAt: string;
  /** Plain-language limitation that must travel with the dataset. */
  disclaimer: string;
  /** Price series provider and adjustment basis. Dividends are NOT embedded in the OHLC. */
  priceProvider: 'yahoo' | 'demo';
  priceBasis: 'split-adjusted';
  /** Last completed US core-session date included in the price series, if any. */
  lastCompletedSession?: DateString;
  fetchedAt: string;
  /** Whether the full-window dividend multiset was cross-checked (DCA) or simply not needed (price-only analytics). */
  dividendCoverage: 'cross-checked' | 'not-requested' | 'demo';
  /**
   * Whether a vendor-adjusted total-return proxy is available for this series.
   * `yahoo-adjusted-close`: the complete aligned adjusted-close axis was captured,
   * so Total return can be shown alongside Price return. `unavailable`: the axis was
   * missing, misaligned, or had any invalid historical value, so total-return
   * analytics fall back to price return rather than mixing bases. `demo`: synthetic
   * preview data. This proxy reflects the vendor's own back-adjustment for dividends
   * and splits; it is NOT independently audited dividend accounting, and the analysis
   * route never loads dividend events, so a dividend count is never derived from it.
   */
  totalReturnCoverage: 'yahoo-adjusted-close' | 'unavailable' | 'demo';
  /** Whether provider-reported splits were cross-checked, none were reported, or this is demo data. */
  splitCoverage: 'cross-checked' | 'none-reported' | 'demo';
  /** Complex reorganizations (spin-offs, mergers) are surfaced only as far as providers report them. */
  reorganizationCoverage: 'provider-reported-only' | 'demo';
  mode: MarketDataMode | 'demo';
}

export interface MarketData {
  ticker: string;
  name: string;
  currency: string;
  locale: string;
  type: string;
  /** Yahoo exchange short code (e.g. NYQ, NMS, PCX) when supplied. */
  exchange?: string;
  /** Yahoo human-readable exchange (e.g. NasdaqGS, NYSEArca) when supplied. */
  exchangeName?: string;
  prices: PriceBar[];
  dividends: DividendEvent[];
  splits: SplitEvent[];
  tickerChanges: TickerChangeEvent[];
  /**
   * Honest provider attribution. `yahoo`: only Yahoo was read (price-only analysis
   * with no reported split). `hybrid`: Massive was actually queried (any DCA run,
   * or a reported split that needed independent verification). `demo`: synthetic
   * preview data. Consumers distinguish live from demo with `=== 'demo'`.
   */
  source: 'yahoo' | 'hybrid' | 'demo';
  fetchedAt: string;
  provenance: DataProvenance;
}

export type TransactionType =
  | 'contribution-buy'
  | 'dividend-reinvestment'
  | 'liquidation'
  | 'portfolio-tax-adjustment';

export interface Transaction {
  date: DateString;
  type: TransactionType;
  shares: number;
  price: number;
  grossCash: number;
  fee: number;
  tax: number;
  note: string;
  ticker?: string;
  /** Auditable per-order fee lines; absent on non-fee records like the tax adjustment. */
  feeComponents?: FeeComponent[];
}

export interface PortfolioPoint {
  date: DateString;
  value: number;
  unitValue: number;
  /** Portfolio value at the contribution execution price immediately before external flows. */
  preFlowValue: number;
  /** External contribution capital added on this date. */
  externalFlow: number;
  shares: number;
  cash: number;
}

export interface DrawdownResult {
  percent: number;
  peakDate?: DateString;
  troughDate?: DateString;
  recoveryDate?: DateString;
}

/**
 * Audit fields for the optional end-liquidation capital-gains estimate. Present
 * only when liquidation is modeled. This is a simplified flat-rate estimate, not
 * lot-level tax accounting: no FIFO/specific identification, holding-period
 * rates, wash sales, return of capital, or jurisdiction/account-specific rules.
 *
 * adjustedTaxBasis  = purchase principal + acquisition fees (per IRS Pub. 550)
 * netAmountRealized = gross market value − sell/liquidation fee
 * realizedGainLoss  = netAmountRealized − adjustedTaxBasis (may be negative)
 * taxableGain       = max(0, realizedGainLoss)
 * capitalGainsTax   = taxableGain × user rate when after-tax, else 0
 *
 * In a Portfolio report the holding-level tax is deferred: gains and losses net
 * across holdings (IRS Topic 409) before one flat-rate tax is applied, so a
 * holding's own `capitalGainsTax` is 0 and the portfolio total carries the tax.
 */
export interface LiquidationEstimate {
  adjustedTaxBasis: number;
  netAmountRealized: number;
  realizedGainLoss: number;
  taxableGain: number;
  sellFee: number;
  capitalGainsTax: number;
  /** Auditable breakdown of the sell/liquidation fee. */
  feeComponents: FeeComponent[];
}

/**
 * Cash-flow-neutral Time-Weighted Return, computed from the flow-neutral unit-value
 * (NAV-per-unit) series. External contributions issue units at the pre-flow unit value
 * and never move it; dividends, dividend tax, broker fees, and reinvestment stay inside
 * the unit value. Daily sub-period returns are geometrically linked. Annualization is
 * reported only after at least a full calendar year elapsed; shorter periods report the
 * period TWR with no fabricated annualization.
 */
export interface TimeWeightedReturn {
  /** Since-inception cumulative TWR as a decimal fraction (0.1 is +10%); flow-neutral. */
  cumulative: number;
  /**
   * Annualized (CAGR-equivalent) TWR as a decimal fraction. Present only when
   * `annualizationEligible` is true (at least 365 calendar days elapsed).
   */
  annualized?: number;
  /** Calendar days from the first invested session to the last. */
  durationDays: number;
  /** True only when `durationDays >= 365`, so no sub-year result is annualized. */
  annualizationEligible: boolean;
}

/**
 * Investor-experience Money-Weighted Return (annualized XIRR) from daily dated external
 * cash flows. Contributions are negative flows on their actual execution dates; the
 * after-fee/after-tax ending value is the terminal positive flow. Reinvested dividends
 * are internal portfolio economics, never external flows. Solved with a deterministic
 * bracketed solver under explicit iteration/convergence bounds. The result is never
 * NaN/Infinity: a no-root, no-flow, or ambiguous case is reported as undefined with an
 * explanatory status rather than a misleading zero.
 */
export type MoneyWeightedReturnStatus =
  | 'available'
  /** Fewer than two flows, or no contributed (negative) flow at all. */
  | 'no-external-flows'
  /** A non-finite amount or a non-ISO date: refused rather than silently cleaned. */
  | 'invalid-flows'
  /** Not the conventional one-sign-change pattern, so a unique root is not guaranteed. */
  | 'ambiguous-flows'
  /** The sign change exists but a bracket could not be established. */
  | 'no-solution'
  /** The bracketed solver hit its iteration bound without converging. */
  | 'not-converged';

export interface MoneyWeightedReturn {
  status: MoneyWeightedReturnStatus;
  /** Annualized since-inception rate as a decimal fraction; present only when `status === 'available'`. */
  annualizedRate?: number;
}

export interface BacktestResult {
  ticker: string;
  companyName: string;
  startDate: DateString;
  endDate: DateString;
  finalPrice: number;
  finalShares: number;
  stockValue: number;
  cash: number;
  finalAmount: number;
  totalContributions: number;
  purchaseCost: number;
  priceReturn: number;
  grossDividends: number;
  dividendTax: number;
  capitalGainsTax: number;
  totalFees: number;
  totalProfit: number;
  /**
   * Simple dollar-efficiency ratio: net gain ÷ external contributions, in percent.
   * This is NOT a performance return and is NOT annualized; it ignores the timing and
   * size of cash flows. Time-weighted (`twr`) and money-weighted (`mwrr`) returns are
   * the performance measures.
   */
  netGainRatioPercent: number;
  /** Cash-flow-neutral Time-Weighted Return since inception. */
  twr: TimeWeightedReturn;
  /** Investor-experience Money-Weighted Return (annualized XIRR) since inception. */
  mwrr: MoneyWeightedReturn;
  durationDays: number;
  contributionCount: number;
  dividendCount: number;
  maxDrawdown: DrawdownResult;
  transactions: Transaction[];
  portfolio: PortfolioPoint[];
  splitCount: number;
  tickerChangeCount: number;
  crossCheckDifference: number;
  projected: boolean;
  /** Buy-side acquisition fees (contribution + reinvestment), excluding the sell fee. */
  acquisitionFees: number;
  /** Total fees broken down by component (commission, SEC, TAF, CAT, …) for the audit. */
  feeComponents: FeeComponent[];
  /** Populated only when end liquidation is modeled. */
  liquidation?: LiquidationEstimate;
}

export type ProjectionScenarioId = 'conservative' | 'baseline' | 'optimistic';

export interface ProjectionScenario {
  id: ProjectionScenarioId;
  label: string;
  annualRate: number;
  annualDividendYield: number;
  result: BacktestResult;
}

export interface ProjectionReport {
  sampleStartDate: DateString;
  sampleEndDate: DateString;
  completedYears: number;
  warning?: string;
  scenarios: ProjectionScenario[];
}

export interface BacktestReport {
  input: BacktestInput;
  marketData: MarketData;
  historical?: BacktestResult;
  projection?: ProjectionReport;
}

export interface PortfolioAggregateResult {
  startDate: DateString;
  endDate: DateString;
  holdingsCount: number;
  stockValue: number;
  cash: number;
  finalAmount: number;
  totalContributions: number;
  purchaseCost: number;
  priceReturn: number;
  grossDividends: number;
  dividendTax: number;
  capitalGainsTax: number;
  totalFees: number;
  totalProfit: number;
  /**
   * Simple dollar-efficiency ratio: net gain ÷ external contributions, in percent.
   * Not a performance return and not annualized. See `twr` / `mwrr` for performance.
   */
  netGainRatioPercent: number;
  /** Cash-flow-neutral Time-Weighted Return of the combined portfolio since inception. */
  twr: TimeWeightedReturn;
  /**
   * Investor-experience Money-Weighted Return (annualized XIRR) from the combined
   * portfolio cash flows and the portfolio terminal value — never an average of the
   * per-holding IRRs.
   */
  mwrr: MoneyWeightedReturn;
  durationDays: number;
  contributionCount: number;
  dividendCount: number;
  maxDrawdown: DrawdownResult;
  transactions: Transaction[];
  portfolio: PortfolioPoint[];
  splitCount: number;
  tickerChangeCount: number;
  crossCheckDifference: number;
  projected: boolean;
  /** Buy-side acquisition fees (contribution + reinvestment), excluding the sell fee. */
  acquisitionFees: number;
  /** Total fees broken down by component, summed across every holding. */
  feeComponents: FeeComponent[];
  /**
   * Populated only when end liquidation is modeled across the holdings. The
   * capital-gain tax here is netted once at the portfolio level, not the sum of
   * per-holding taxes.
   */
  liquidation?: LiquidationEstimate;
}

export interface PortfolioHoldingReport {
  position: PortfolioPositionInput;
  report: BacktestReport;
}

export interface PortfolioProjectionScenario {
  id: ProjectionScenarioId;
  label: string;
  result: PortfolioAggregateResult;
}

export interface PortfolioProjectionReport {
  scenarios: PortfolioProjectionScenario[];
  warning?: string;
}

export interface PortfolioReport {
  input: PortfolioInput;
  holdings: PortfolioHoldingReport[];
  historical?: PortfolioAggregateResult;
  projection?: PortfolioProjectionReport;
  source: 'hybrid' | 'demo';
  /** Aggregate provenance across the loaded holdings, or demo provenance. */
  provenance: DataProvenance;
}
