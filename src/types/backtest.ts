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

export interface FeeConfig {
  brokerId: string;
  brokerName: string;
  buy: FeeRule;
  sell: FeeRule;
  dividendReinvestment: FeeRule;
  notes: string;
  effectiveDate: DateString;
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

export interface MarketData {
  ticker: string;
  name: string;
  currency: string;
  locale: string;
  type: string;
  prices: PriceBar[];
  dividends: DividendEvent[];
  splits: SplitEvent[];
  tickerChanges: TickerChangeEvent[];
  source: 'hybrid' | 'demo';
  fetchedAt: string;
}

export type TransactionType = 'contribution-buy' | 'dividend-reinvestment' | 'liquidation';

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
  totalReturnPercent: number;
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
  totalReturnPercent: number;
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
}
