// Purpose: Pure selection layer for SEC EDGAR company fundamentals.
//
// This module turns a raw SEC `companyfacts` document into an auditable, annual,
// "as most recently reported" five-year view. It performs NO network I/O and holds
// NO provider secrets — SEC company facts are public and require none. Every rule
// here is deterministic so the same document always yields the same selection.
//
// Guardrails encoded below (see README calculation contract expectations):
//   - Only annual forms (10-K, 10-K/A, 20-F) with fiscal period FY are eligible.
//   - Flow (duration) facts must span a full fiscal year (350–380 days) so 52/53-week
//     years are accepted while quarterly and stub/transition periods are rejected.
//   - Instant facts must be genuine point-in-time values (no duration span).
//   - Units are validated per metric (USD, USD/shares, shares); a wrong unit is ignored.
//   - Concept aliases are explicit and ordered; the highest-precedence alias present
//     in a fiscal year wins ("concept alias precedence").
//   - Within one economic period (start/end) the latest `filed` value wins so the view is
//     restatement-aware; a true `filed` tie prefers the amended annual form, then the
//     lexically greatest accession, so selection is fully deterministic.
//   - SEC `fy` identifies the filing's fiscal year, not necessarily the comparative
//     period represented by a fact. Display fiscal year is therefore derived from the
//     fact's period end; `fy` remains preserved in the source receipt for audit.
//   - A missing standard tag is NEVER inferred and a missing value is NEVER treated as
//     zero. `companyfacts` carries standard-taxonomy facts only, so "unavailable" is a
//     normal, first-class outcome that is reported with a reason.
//   - Constructed metrics (operating margin, free cash flow) are produced only when
//     their components align on the same fiscal period, and they always carry the
//     component receipts.

/** Latest-reported disclaimer the consumer (Company Summary page) must display verbatim. */
export const FUNDAMENTALS_DISCLAIMER =
  'As most recently reported; later restatements may apply.';

/** Number of trailing fiscal years surfaced by the MVP annual view. */
export const FUNDAMENTALS_YEARS = 5;

/** Allowed annual filing forms. 20-F/A is intentionally excluded per the data contract. */
const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '20-F']);

/** Inclusive flow-duration window, in days, that admits 52- and 53-week fiscal years. */
const MIN_ANNUAL_DAYS = 350;
const MAX_ANNUAL_DAYS = 380;

const MS_PER_DAY = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// --- Raw SEC companyfacts shapes (only the fields we read) ---------------------

/** A single XBRL fact as returned inside a `companyfacts` unit array. */
export interface SecFact {
  start?: string;
  end?: string;
  val?: number;
  accn?: string;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
}

interface SecConcept {
  label?: string;
  description?: string;
  units?: Record<string, SecFact[]>;
}

type SecTaxonomy = Record<string, SecConcept>;

export interface CompanyFacts {
  cik?: number;
  entityName?: string;
  facts?: Record<string, SecTaxonomy>;
}

// --- Public result shape -------------------------------------------------------

/** Auditable provenance for one selected observation or component. */
export interface SourceReceipt {
  taxonomy: string;
  concept: string;
  unit: string;
  accn: string;
  form: string;
  fp: string;
  fy: number;
  filed: string;
  start?: string;
  end: string;
  /** Official SEC filing-index URL for the accession. */
  sourceUrl: string;
}

/** Economic period year for display; SEC `fy` can describe the filing, not a restated fact's end year. */
export function receiptEconomicYear(receipt: SourceReceipt): number {
  return Number.parseInt(receipt.end.slice(0, 4), 10);
}

export interface FundamentalsObservation {
  fiscalYear: number;
  /** Period end (fiscal year end) the value describes. */
  periodEnd: string;
  value: number;
  /** One receipt for a directly reported metric; the components for a constructed one. */
  receipts: SourceReceipt[];
  /** The evidence class belongs to the observation because a series may mix origins by year. */
  origin?: FinancialFactOrigin;
  derivation?: FinancialDerivation;
}

export type FinancialFactOrigin =
  | 'direct-standard'
  | 'constructed-standard'
  | 'direct-custom-extension'
  | 'manual-user';

export type FinancialCoverageStatus =
  | 'complete'
  | 'limited-history'
  | 'manual-required'
  | 'not-meaningful'
  | 'not-separately-reported'
  | 'unavailable';

export interface FinancialDerivation {
  formula: string;
  componentMetrics: FundamentalsMetricKey[];
  componentReceipts: SourceReceipt[];
}

export type FundamentalsReasonCode =
  | 'no-annual-standard-fact'
  | 'components-not-aligned'
  | 'limited-history'
  | 'financial-issuer-gate';

export interface FundamentalsCoverageSummary {
  status: FinancialCoverageStatus;
  availableYears: number;
  requestedYears: number;
  mixedOrigins: boolean;
  reasonCode?: FundamentalsReasonCode;
}

export type FundamentalsUnit = 'USD' | 'USD/shares' | 'shares' | 'ratio';

export interface FundamentalsSeries {
  metric: FundamentalsMetricKey;
  unit: FundamentalsUnit;
  /** Human-readable basis note (e.g. share-count basis, capex sign convention). */
  basis: string;
  available: boolean;
  /** Latest fiscal year first. Empty when the metric is unavailable. */
  observations: FundamentalsObservation[];
  /** Always present on normalized API output; optional for legacy in-memory fixtures. */
  coverage?: FundamentalsCoverageSummary;
  /** Present only when `available` is false; a plain-language reason. */
  unavailableReason?: string;
}

export interface FundamentalsIdentity {
  /** Zero-padded 10-digit CIK. */
  cik: string;
  ticker: string;
  name: string;
  /** SEC Standard Industrial Classification code, when the submissions feed supplied it. */
  sicCode?: number;
  sicDescription?: string;
  /**
   * True for SIC 6000–6999 (finance/insurance/real-estate issuers). The consumer uses
   * this to suppress inappropriate gross-margin / inventory / cash-conversion-cycle
   * style metrics. Defaults to false when the SIC is unknown (fail safe: no false claim).
   */
  isFinancialIssuer: boolean;
  /** No sector/GICS classification is fabricated; SEC provides SIC only. */
  sectorClassification: null;
}

export interface FundamentalsResult {
  identity: FundamentalsIdentity;
  /** Reporting basis of the surfaced view. Display-only; never a backtest input. */
  period: 'annual';
  basis: 'as-most-recently-reported';
  displayOnly: true;
  disclaimer: string;
  /** The (up to five) fiscal years covered, latest first. */
  fiscalYears: number[];
  metrics: FundamentalsSeries[];
  /** Every metric that could not be produced, with a reason. */
  coverage: {
    unavailable: Array<{ metric: FundamentalsMetricKey; reason: string; reasonCode?: FundamentalsReasonCode }>;
    reconciliations?: FundamentalsReconciliation[];
  };
}

export interface FundamentalsReconciliation {
  metric: FundamentalsMetricKey;
  fiscalYear: number;
  directValue: number;
  constructedValue: number;
  difference: number;
  tolerance: number;
  status: 'aligned' | 'mismatch';
  directReceipts: SourceReceipt[];
  componentReceipts: SourceReceipt[];
}

// --- Metric catalog ------------------------------------------------------------

export type FundamentalsMetricKey =
  | 'revenue'
  | 'netIncome'
  | 'operatingIncome'
  | 'dilutedEps'
  | 'operatingCashFlow'
  | 'capitalExpenditure'
  | 'depreciationAndAmortization'
  | 'debtCurrent'
  | 'longTermDebtNoncurrent'
  | 'totalDebt'
  | 'cashAndEquivalents'
  | 'grossProfit'
  | 'costOfRevenue'
  | 'incomeTaxExpense'
  | 'pretaxIncome'
  | 'totalAssets'
  | 'currentAssets'
  | 'currentLiabilities'
  | 'stockholdersEquity'
  | 'inventoryNet'
  | 'accountsReceivableNetCurrent'
  | 'accountsPayableCurrent'
  | 'interestExpense'
  | 'dilutedShares'
  | 'sharesOutstanding'
  | 'operatingMargin'
  | 'freeCashFlow'
  | 'ebitda'
  | 'netDebt';

interface ConceptAlias {
  taxonomy: string;
  concept: string;
}

interface DirectMetricSpec {
  key: FundamentalsMetricKey;
  kind: 'duration' | 'instant';
  unit: Exclude<FundamentalsUnit, 'ratio'>;
  basis: string;
  /** Ordered aliases; earlier entries take precedence within a fiscal year. */
  aliases: ConceptAlias[];
  /** Reject non-positive values (used for share counts and capex magnitudes). */
  nonNegative?: boolean;
}

const REASON_NO_ANNUAL =
  'No annual (10-K/20-F) filing reported a standard tag for this metric.';
const REASON_MARGIN =
  'Operating margin is unavailable because operating income and revenue could not be aligned for a common fiscal year.';
const REASON_FCF =
  'Free cash flow is unavailable because operating cash flow and capital expenditure could not be aligned for a common fiscal year.';
const REASON_EBITDA =
  'EBITDA is unavailable because operating income and depreciation/amortization could not be aligned for a common fiscal year.';
const REASON_NET_DEBT =
  'Net debt is unavailable because total debt and cash equivalents could not be aligned on a common annual balance-sheet date.';

/**
 * Directly reported metrics. Revenue precedence follows the ASC 606 transition:
 * the modern contract-revenue tag first, then the legacy `Revenues`, then
 * `SalesRevenueNet`, so a company that switched tags across years stays consistent.
 */
const DIRECT_METRICS: DirectMetricSpec[] = [
  {
    key: 'revenue',
    kind: 'duration',
    unit: 'USD',
    basis: 'Total revenue',
    aliases: [
      { taxonomy: 'us-gaap', concept: 'RevenueFromContractWithCustomerExcludingAssessedTax' },
      { taxonomy: 'us-gaap', concept: 'RevenueFromContractWithCustomerIncludingAssessedTax' },
      { taxonomy: 'us-gaap', concept: 'Revenues' },
      { taxonomy: 'us-gaap', concept: 'SalesRevenueNet' },
    ],
  },
  {
    key: 'netIncome',
    kind: 'duration',
    unit: 'USD',
    basis: 'Net income (loss)',
    aliases: [
      { taxonomy: 'us-gaap', concept: 'NetIncomeLoss' },
      { taxonomy: 'us-gaap', concept: 'ProfitLoss' },
    ],
  },
  {
    key: 'operatingIncome',
    kind: 'duration',
    unit: 'USD',
    basis: 'Operating income (loss)',
    aliases: [{ taxonomy: 'us-gaap', concept: 'OperatingIncomeLoss' }],
  },
  {
    key: 'dilutedEps',
    kind: 'duration',
    unit: 'USD/shares',
    basis: 'Diluted earnings per share',
    aliases: [{ taxonomy: 'us-gaap', concept: 'EarningsPerShareDiluted' }],
  },
  {
    key: 'operatingCashFlow',
    kind: 'duration',
    unit: 'USD',
    basis: 'Net cash from operating activities',
    aliases: [
      { taxonomy: 'us-gaap', concept: 'NetCashProvidedByUsedInOperatingActivities' },
      {
        taxonomy: 'us-gaap',
        concept: 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
      },
    ],
  },
  {
    key: 'capitalExpenditure',
    kind: 'duration',
    unit: 'USD',
    // SEC reports these `Payments…` concepts as a POSITIVE cash outflow magnitude. We
    // keep them positive (no sign flip) and subtract them when constructing free cash
    // flow, so the sign convention is documented and consistent across aliases.
    basis: 'Capital expenditure (positive cash outflow)',
    nonNegative: true,
    aliases: [
      { taxonomy: 'us-gaap', concept: 'PaymentsToAcquirePropertyPlantAndEquipment' },
      { taxonomy: 'us-gaap', concept: 'PaymentsToAcquireProductiveAssets' },
      { taxonomy: 'us-gaap', concept: 'PaymentsForCapitalImprovements' },
    ],
  },
  {
    key: 'depreciationAndAmortization',
    kind: 'duration',
    unit: 'USD',
    basis: 'Depreciation, depletion, and amortization',
    nonNegative: true,
    aliases: [
      { taxonomy: 'us-gaap', concept: 'DepreciationDepletionAndAmortization' },
      { taxonomy: 'us-gaap', concept: 'DepreciationAndAmortization' },
    ],
  },
  {
    key: 'debtCurrent',
    kind: 'instant',
    unit: 'USD',
    basis: 'Selected current interest-bearing debt; separately reported commercial paper is added only to aligned current term debt, never to a comprehensive current-debt concept',
    nonNegative: true,
    aliases: [
      { taxonomy: 'us-gaap', concept: 'DebtCurrent' },
      { taxonomy: 'us-gaap', concept: 'ShortTermBorrowings' },
      { taxonomy: 'us-gaap', concept: 'LongTermDebtCurrent' },
    ],
  },
  {
    key: 'longTermDebtNoncurrent',
    kind: 'instant',
    unit: 'USD',
    basis: 'Noncurrent interest-bearing debt',
    nonNegative: true,
    aliases: [
      { taxonomy: 'us-gaap', concept: 'LongTermDebtAndFinanceLeaseObligationsNoncurrent' },
      { taxonomy: 'us-gaap', concept: 'LongTermDebtNoncurrent' },
    ],
  },
  {
    key: 'cashAndEquivalents',
    kind: 'instant',
    unit: 'USD',
    basis: 'Cash and cash equivalents; restricted cash and short-term investments excluded',
    nonNegative: true,
    aliases: [{ taxonomy: 'us-gaap', concept: 'CashAndCashEquivalentsAtCarryingValue' }],
  },
  {
    key: 'grossProfit',
    kind: 'duration',
    unit: 'USD',
    basis: 'Gross profit',
    aliases: [{ taxonomy: 'us-gaap', concept: 'GrossProfit' }],
  },
  {
    key: 'costOfRevenue',
    kind: 'duration',
    unit: 'USD',
    basis: 'Cost of revenue (positive expense)',
    nonNegative: true,
    aliases: [
      { taxonomy: 'us-gaap', concept: 'CostOfGoodsAndServicesSold' },
      { taxonomy: 'us-gaap', concept: 'CostOfRevenue' },
      { taxonomy: 'us-gaap', concept: 'CostOfGoodsSold' },
    ],
  },
  {
    key: 'incomeTaxExpense',
    kind: 'duration',
    unit: 'USD',
    basis: 'Income tax expense (benefit)',
    aliases: [{ taxonomy: 'us-gaap', concept: 'IncomeTaxExpenseBenefit' }],
  },
  {
    key: 'pretaxIncome',
    kind: 'duration',
    unit: 'USD',
    basis: 'Income from continuing operations before income taxes',
    aliases: [
      { taxonomy: 'us-gaap', concept: 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest' },
      { taxonomy: 'us-gaap', concept: 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments' },
    ],
  },
  {
    key: 'totalAssets',
    kind: 'instant',
    unit: 'USD',
    basis: 'Total assets',
    nonNegative: true,
    aliases: [{ taxonomy: 'us-gaap', concept: 'Assets' }],
  },
  {
    key: 'currentAssets',
    kind: 'instant',
    unit: 'USD',
    basis: 'Current assets',
    nonNegative: true,
    aliases: [{ taxonomy: 'us-gaap', concept: 'AssetsCurrent' }],
  },
  {
    key: 'currentLiabilities',
    kind: 'instant',
    unit: 'USD',
    basis: 'Current liabilities',
    nonNegative: true,
    aliases: [{ taxonomy: 'us-gaap', concept: 'LiabilitiesCurrent' }],
  },
  {
    key: 'stockholdersEquity',
    kind: 'instant',
    unit: 'USD',
    basis: 'Stockholders equity attributable to the parent',
    aliases: [{ taxonomy: 'us-gaap', concept: 'StockholdersEquity' }],
  },
  {
    key: 'inventoryNet',
    kind: 'instant',
    unit: 'USD',
    basis: 'Net inventory',
    nonNegative: true,
    aliases: [{ taxonomy: 'us-gaap', concept: 'InventoryNet' }],
  },
  {
    key: 'accountsReceivableNetCurrent',
    kind: 'instant',
    unit: 'USD',
    basis: 'Current net accounts receivable',
    nonNegative: true,
    aliases: [
      { taxonomy: 'us-gaap', concept: 'AccountsReceivableNetCurrent' },
      { taxonomy: 'us-gaap', concept: 'ReceivablesNetCurrent' },
    ],
  },
  {
    key: 'accountsPayableCurrent',
    kind: 'instant',
    unit: 'USD',
    basis: 'Current accounts payable',
    nonNegative: true,
    aliases: [
      { taxonomy: 'us-gaap', concept: 'AccountsPayableCurrent' },
      { taxonomy: 'us-gaap', concept: 'AccountsPayableTradeCurrent' },
    ],
  },
  {
    key: 'interestExpense',
    kind: 'duration',
    unit: 'USD',
    basis: 'Interest expense',
    nonNegative: true,
    aliases: [
      { taxonomy: 'us-gaap', concept: 'InterestExpense' },
      { taxonomy: 'us-gaap', concept: 'InterestExpenseNonoperating' },
      { taxonomy: 'us-gaap', concept: 'InterestExpenseDebt' },
      { taxonomy: 'us-gaap', concept: 'InterestAndDebtExpense' },
    ],
  },
  {
    key: 'dilutedShares',
    kind: 'duration',
    unit: 'shares',
    basis: 'Diluted weighted-average shares outstanding',
    nonNegative: true,
    aliases: [{ taxonomy: 'us-gaap', concept: 'WeightedAverageNumberOfDilutedSharesOutstanding' }],
  },
  {
    key: 'sharesOutstanding',
    kind: 'instant',
    unit: 'shares',
    basis: 'Common shares outstanding (cover-date, point-in-time)',
    nonNegative: true,
    aliases: [{ taxonomy: 'dei', concept: 'EntityCommonStockSharesOutstanding' }],
  },
];

/**
 * Commercial paper is selected separately because it cannot be another `debtCurrent`
 * alias: alias precedence chooses one fact, while issuers such as Apple report current
 * term debt and commercial paper as two additive balances. The composition step below
 * adds this fact only when `LongTermDebtCurrent` is the selected, non-comprehensive
 * current-debt concept. `DebtCurrent` and `ShortTermBorrowings` are left untouched to
 * avoid double-counting balances they may already include.
 */
const COMMERCIAL_PAPER_SPEC: DirectMetricSpec = {
  key: 'debtCurrent',
  kind: 'instant',
  unit: 'USD',
  basis: 'Separately reported commercial paper',
  nonNegative: true,
  aliases: [{ taxonomy: 'us-gaap', concept: 'CommercialPaper' }],
};

const DEPRECIATION_COMPONENT_SPEC: DirectMetricSpec = {
  key: 'depreciationAndAmortization',
  kind: 'duration',
  unit: 'USD',
  basis: 'Depreciation component',
  nonNegative: true,
  aliases: [
    { taxonomy: 'us-gaap', concept: 'Depreciation' },
    { taxonomy: 'us-gaap', concept: 'DepreciationDepletionAndAmortizationPropertyPlantAndEquipment' },
  ],
};

const AMORTIZATION_COMPONENT_SPEC: DirectMetricSpec = {
  key: 'depreciationAndAmortization',
  kind: 'duration',
  unit: 'USD',
  basis: 'Amortization component',
  nonNegative: true,
  aliases: [
    { taxonomy: 'us-gaap', concept: 'AmortizationOfIntangibleAssets' },
    { taxonomy: 'us-gaap', concept: 'FiniteLivedIntangibleAssetsAmortizationExpense' },
  ],
};

// --- Selection internals -------------------------------------------------------

interface SelectedObservation {
  fiscalYear: number;
  periodEnd: string;
  value: number;
  /** One receipt for a direct metric; both component receipts for a constructed one. */
  receipts: SourceReceipt[];
  origin?: FinancialFactOrigin;
  derivation?: FinancialDerivation;
}

/** A qualifying fact tagged with the precedence rank of the alias it came from. */
interface RankedFact {
  rank: number;
  taxonomy: string;
  concept: string;
  unit: string;
  fact: SecFact;
}

export interface FundamentalsIdentityInput {
  cik: string;
  cikNumber: number;
  ticker: string;
  name: string;
  sicCode?: number;
  sicDescription?: string;
}

/**
 * Builds the auditable five-year annual fundamentals view from a `companyfacts`
 * document and the caller-resolved identity (CIK/ticker/name and, when available,
 * SIC). Pure and deterministic; performs no I/O.
 */
export function buildFundamentals(
  facts: CompanyFacts,
  identity: FundamentalsIdentityInput,
): FundamentalsResult {
  // 1. Select every eligible annual observation per direct metric (all years).
  const selected = new Map<FundamentalsMetricKey, SelectedObservation[]>();
  for (const spec of DIRECT_METRICS) {
    selected.set(spec.key, selectDirectMetric(facts, spec, identity.cikNumber));
  }

  const isKnownNonFinancialIssuer =
    identity.sicCode !== undefined && !(identity.sicCode >= 6000 && identity.sicCode <= 6999);
  const directRevenue = selected.get('revenue') ?? [];
  const revenueComponents = isKnownNonFinancialIssuer
    ? constructRevenueFromGrossProfitAndCostOfRevenue(
        selected.get('grossProfit') ?? [],
        selected.get('costOfRevenue') ?? [],
      )
    : [];
  selected.set('revenue', mergeDirectWithFallback(directRevenue, revenueComponents));

  const directDa = selected.get('depreciationAndAmortization') ?? [];
  const constructedDa = isKnownNonFinancialIssuer
    ? constructDepreciationAndAmortization(
        selectDirectMetric(facts, DEPRECIATION_COMPONENT_SPEC, identity.cikNumber),
        selectDirectMetric(facts, AMORTIZATION_COMPONENT_SPEC, identity.cikNumber),
      )
    : [];
  selected.set('depreciationAndAmortization', mergeDirectWithFallback(directDa, constructedDa));
  selected.set(
    'debtCurrent',
    includeAlignedCommercialPaper(
      selected.get('debtCurrent') ?? [],
      selectDirectMetric(facts, COMMERCIAL_PAPER_SPEC, identity.cikNumber),
    ),
  );

  // 2. Anchor the window on the most recent annual flow year across income-statement
  //    and cash-flow metrics, then keep the latest five fiscal years.
  const anchorYears: number[] = [];
  for (const spec of DIRECT_METRICS) {
    if (spec.kind !== 'duration') continue;
    for (const obs of selected.get(spec.key) ?? []) anchorYears.push(obs.fiscalYear);
  }
  const maxFy = anchorYears.length ? Math.max(...anchorYears) : undefined;
  const minFy = maxFy === undefined ? undefined : maxFy - (FUNDAMENTALS_YEARS - 1);

  const inWindow = (fy: number): boolean =>
    minFy === undefined || maxFy === undefined ? false : fy >= minFy && fy <= maxFy;

  // 3. Emit direct series constrained to the window (latest year first).
  const metrics: FundamentalsSeries[] = [];
  const unavailable: Array<{ metric: FundamentalsMetricKey; reason: string; reasonCode: FundamentalsReasonCode }> = [];
  const windowed = new Map<FundamentalsMetricKey, SelectedObservation[]>();

  for (const spec of DIRECT_METRICS) {
    const observations = (selected.get(spec.key) ?? [])
      .filter((obs) => inWindow(obs.fiscalYear))
      .sort((a, b) => b.fiscalYear - a.fiscalYear);
    windowed.set(spec.key, observations);
    metrics.push(toSeries(spec.key, spec.unit, spec.basis, observations, REASON_NO_ANNUAL, 'no-annual-standard-fact', unavailable));
  }

  // 4. Constructed metrics from aligned component observations.
  const operatingMargin = constructOperatingMargin(
    windowed.get('operatingIncome') ?? [],
    windowed.get('revenue') ?? [],
  );
  metrics.push(
    toSeries('operatingMargin', 'ratio', 'Operating income ÷ revenue', operatingMargin, REASON_MARGIN, 'components-not-aligned', unavailable),
  );

  const ebitda = constructSum(
    windowed.get('operatingIncome') ?? [],
    windowed.get('depreciationAndAmortization') ?? [],
  );
  metrics.push(
    toSeries(
      'ebitda',
      'USD',
      'Operating income + depreciation and amortization',
      ebitda,
      REASON_EBITDA,
      'components-not-aligned',
      unavailable,
    ),
  );

  const totalDebt = constructInstantSum(
    windowed.get('debtCurrent') ?? [],
    windowed.get('longTermDebtNoncurrent') ?? [],
  );
  metrics.push(
    toSeries(
      'totalDebt',
      'USD',
      'Current interest-bearing debt + noncurrent debt',
      totalDebt,
      REASON_NO_ANNUAL,
      'components-not-aligned',
      unavailable,
    ),
  );

  const netDebt = constructInstantDifference(
    totalDebt,
    windowed.get('cashAndEquivalents') ?? [],
  );
  metrics.push(
    toSeries(
      'netDebt',
      'USD',
      'Current interest-bearing debt + noncurrent debt − cash and cash equivalents; marketable securities excluded',
      netDebt,
      REASON_NET_DEBT,
      'components-not-aligned',
      unavailable,
    ),
  );

  const freeCashFlow = constructFreeCashFlow(
    windowed.get('operatingCashFlow') ?? [],
    windowed.get('capitalExpenditure') ?? [],
  );
  metrics.push(
    toSeries(
      'freeCashFlow',
      'USD',
      'Operating cash flow − capital expenditures',
      freeCashFlow,
      REASON_FCF,
      'components-not-aligned',
      unavailable,
    ),
  );

  // 5. Fiscal years actually covered by at least one metric (latest first).
  const coveredYears = new Set<number>();
  for (const series of metrics) {
    for (const obs of series.observations) coveredYears.add(obs.fiscalYear);
  }
  const fiscalYears = [...coveredYears].sort((a, b) => b - a);

  const sicCode = identity.sicCode;
  return {
    identity: {
      cik: identity.cik,
      ticker: identity.ticker,
      name: identity.name,
      ...(sicCode !== undefined ? { sicCode } : {}),
      ...(identity.sicDescription ? { sicDescription: identity.sicDescription } : {}),
      isFinancialIssuer: sicCode !== undefined && sicCode >= 6000 && sicCode <= 6999,
      sectorClassification: null,
    },
    period: 'annual',
    basis: 'as-most-recently-reported',
    displayOnly: true,
    disclaimer: FUNDAMENTALS_DISCLAIMER,
    fiscalYears,
    metrics,
    coverage: {
      unavailable,
      reconciliations: reconcileDirectAndConstructedRevenue(directRevenue, revenueComponents),
    },
  };
}

function toSeries(
  metric: FundamentalsMetricKey,
  unit: FundamentalsUnit,
  basis: string,
  observations: SelectedObservation[],
  reason: string,
  reasonCode: FundamentalsReasonCode,
  unavailable: Array<{ metric: FundamentalsMetricKey; reason: string; reasonCode: FundamentalsReasonCode }>,
): FundamentalsSeries {
  if (observations.length === 0) {
    unavailable.push({ metric, reason, reasonCode });
    return {
      metric,
      unit,
      basis,
      available: false,
      observations: [],
      unavailableReason: reason,
      coverage: {
        status: 'unavailable',
        availableYears: 0,
        requestedYears: FUNDAMENTALS_YEARS,
        mixedOrigins: false,
        reasonCode,
      },
    };
  }
  const origins = new Set(observations.map((observation) => observation.origin));
  return {
    metric,
    unit,
    basis,
    available: true,
    observations: observations.map((obs) => ({
      fiscalYear: obs.fiscalYear,
      periodEnd: obs.periodEnd,
      value: obs.value,
      receipts: obs.receipts,
      origin: obs.origin,
      ...(obs.derivation ? { derivation: obs.derivation } : {}),
    })),
    coverage: {
      status: observations.length >= FUNDAMENTALS_YEARS ? 'complete' : 'limited-history',
      availableYears: observations.length,
      requestedYears: FUNDAMENTALS_YEARS,
      mixedOrigins: origins.size > 1,
      ...(observations.length >= FUNDAMENTALS_YEARS ? {} : { reasonCode: 'limited-history' as const }),
    },
  };
}

/**
 * Selects one observation per economic annual period for a direct metric: eligible
 * facts are grouped by start/end (or end for instant facts), the highest-precedence
 * alias present in that period wins, duplicates are removed, and the restatement
 * rule picks the latest-reported value. SEC `fy` is not used as the period key because
 * later 10-K filings repeat comparative years with the newer filing's `fy`.
 */
function selectDirectMetric(
  facts: CompanyFacts,
  spec: DirectMetricSpec,
  cikNumber: number,
): SelectedObservation[] {
  const eligible: RankedFact[] = [];
  spec.aliases.forEach((alias, rank) => {
    const concept = facts.facts?.[alias.taxonomy]?.[alias.concept];
    const units = concept?.units?.[spec.unit];
    if (!Array.isArray(units)) return;
    for (const fact of units) {
      if (!isEligible(fact, spec)) continue;
      eligible.push({ rank, taxonomy: alias.taxonomy, concept: alias.concept, unit: spec.unit, fact });
    }
  });

  const byPeriod = new Map<string, RankedFact[]>();
  for (const entry of eligible) {
    const periodKey = spec.kind === 'duration'
      ? `${entry.fact.start}|${entry.fact.end}`
      : `${entry.fact.end}`;
    const bucket = byPeriod.get(periodKey);
    if (bucket) bucket.push(entry);
    else byPeriod.set(periodKey, [entry]);
  }

  const winnersByYear = new Map<number, RankedFact>();
  for (const bucket of byPeriod.values()) {
    // Highest-precedence alias present in this economic period wins.
    const bestRank = Math.min(...bucket.map((entry) => entry.rank));
    const sameAlias = bucket.filter((entry) => entry.rank === bestRank);
    const winner = pickRestatement(dedupe(sameAlias));
    const periodEnd = winner.fact.end as string;
    const fiscalYear = Number(periodEnd.slice(0, 4));
    const existing = winnersByYear.get(fiscalYear);
    if (!existing) {
      winnersByYear.set(fiscalYear, winner);
      continue;
    }
    const existingEnd = existing.fact.end as string;
    if (periodEnd > existingEnd) winnersByYear.set(fiscalYear, winner);
    else if (periodEnd === existingEnd) winnersByYear.set(fiscalYear, pickRestatement([existing, winner]));
  }

  const observations: SelectedObservation[] = [];
  for (const [fiscalYear, winner] of winnersByYear) {
    observations.push({
      fiscalYear,
      periodEnd: winner.fact.end as string,
      value: winner.fact.val as number,
      receipts: [toReceipt(winner, cikNumber)],
      origin: 'direct-standard',
    });
  }
  return observations;
}

/** True when a fact is an eligible annual observation for the metric. */
function isEligible(fact: SecFact, spec: DirectMetricSpec): boolean {
  if (fact.fp !== 'FY') return false;
  if (typeof fact.form !== 'string' || !ANNUAL_FORMS.has(fact.form)) return false;
  if (typeof fact.fy !== 'number' || !Number.isInteger(fact.fy)) return false;
  if (typeof fact.accn !== 'string' || fact.accn.length === 0) return false;
  if (!isValidDate(fact.filed)) return false;
  if (!isValidDate(fact.end)) return false;

  if (typeof fact.val !== 'number' || !Number.isFinite(fact.val)) return false;
  if (spec.nonNegative && fact.val < 0) return false;

  if (spec.kind === 'duration') {
    if (!isValidDate(fact.start)) return false;
    const days = durationDays(fact.start as string, fact.end as string);
    if (days < MIN_ANNUAL_DAYS || days > MAX_ANNUAL_DAYS) return false;
  } else {
    // Instant fact: a genuine point-in-time value carries no distinct duration span.
    if (fact.start !== undefined && fact.start !== fact.end) return false;
  }
  return true;
}

/** Removes exact duplicates keyed by (concept, unit, start, end, accn). */
function dedupe(entries: RankedFact[]): RankedFact[] {
  const seen = new Set<string>();
  const out: RankedFact[] = [];
  for (const entry of entries) {
    const key = `${entry.concept}|${entry.unit}|${entry.fact.start ?? ''}|${entry.fact.end ?? ''}|${entry.fact.accn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/**
 * Restatement-aware winner for one fiscal year: latest `filed`; on a true tie prefer
 * the amended annual form (10-K/A); still tied, the lexically greatest accession.
 * Deterministic regardless of input order.
 */
function pickRestatement(entries: RankedFact[]): RankedFact {
  return entries.reduce((best, candidate) => {
    const bf = best.fact.filed as string;
    const cf = candidate.fact.filed as string;
    if (cf > bf) return candidate;
    if (cf < bf) return best;
    const bestAmended = isAmended(best.fact.form);
    const candidateAmended = isAmended(candidate.fact.form);
    if (candidateAmended !== bestAmended) return candidateAmended ? candidate : best;
    return (candidate.fact.accn as string) > (best.fact.accn as string) ? candidate : best;
  });
}

function isAmended(form: string | undefined): boolean {
  return typeof form === 'string' && form.endsWith('/A');
}

function toReceipt(entry: RankedFact, cikNumber: number): SourceReceipt {
  const fact = entry.fact;
  return {
    taxonomy: entry.taxonomy,
    concept: entry.concept,
    unit: entry.unit,
    accn: fact.accn as string,
    form: fact.form as string,
    fp: fact.fp as string,
    fy: fact.fy as number,
    filed: fact.filed as string,
    ...(fact.start !== undefined ? { start: fact.start } : {}),
    end: fact.end as string,
    sourceUrl: secFilingIndexUrl(cikNumber, fact.accn as string),
  };
}

/**
 * Operating margin = operating income ÷ revenue, aligned by fiscal year and identical
 * period start/end, skipping any year where revenue is not strictly positive. Each result
 * carries both component receipts (operating income first, then revenue).
 */
function constructOperatingMargin(
  operatingIncome: SelectedObservation[],
  revenue: SelectedObservation[],
): SelectedObservation[] {
  const revenueByFy = indexByFiscalYear(revenue);
  const out: SelectedObservation[] = [];
  for (const income of operatingIncome) {
    const rev = revenueByFy.get(income.fiscalYear);
    if (!rev || !sameAnnualPeriod(income, rev)) continue;
    if (!(rev.value > 0)) continue;
    out.push({
      fiscalYear: income.fiscalYear,
      periodEnd: income.periodEnd,
      value: income.value / rev.value,
      receipts: [...income.receipts, ...rev.receipts],
      origin: 'constructed-standard',
      derivation: {
        formula: 'operatingIncome / revenue',
        componentMetrics: ['operatingIncome', 'revenue'],
        componentReceipts: [...income.receipts, ...rev.receipts],
      },
    });
  }
  return out;
}

/**
 * Free cash flow = operating cash flow − capital expenditure, aligned by fiscal year
 * and identical period start/end. Component receipts are always attached (operating cash
 * flow first, then capex); a year missing either aligned component is simply absent
 * (never fabricated or zero-filled).
 */
function constructFreeCashFlow(
  operating: SelectedObservation[],
  capex: SelectedObservation[],
): SelectedObservation[] {
  const capexByFy = indexByFiscalYear(capex);
  const out: SelectedObservation[] = [];
  for (const ocf of operating) {
    const capexObs = capexByFy.get(ocf.fiscalYear);
    if (!capexObs || !sameAnnualPeriod(ocf, capexObs)) continue;
    out.push({
      fiscalYear: ocf.fiscalYear,
      periodEnd: ocf.periodEnd,
      value: ocf.value - capexObs.value,
      receipts: [...ocf.receipts, ...capexObs.receipts],
      origin: 'constructed-standard',
      derivation: {
        formula: 'operatingCashFlow - capitalExpenditure',
        componentMetrics: ['operatingCashFlow', 'capitalExpenditure'],
        componentReceipts: [...ocf.receipts, ...capexObs.receipts],
      },
    });
  }
  return out;
}

function constructSum(
  left: SelectedObservation[],
  right: SelectedObservation[],
): SelectedObservation[] {
  const rightByFy = indexByFiscalYear(right);
  const out: SelectedObservation[] = [];
  for (const leftObservation of left) {
    const rightObservation = rightByFy.get(leftObservation.fiscalYear);
    if (!rightObservation || !sameAnnualPeriod(leftObservation, rightObservation)) continue;
    out.push({
      fiscalYear: leftObservation.fiscalYear,
      periodEnd: leftObservation.periodEnd,
      value: leftObservation.value + rightObservation.value,
      receipts: [...leftObservation.receipts, ...rightObservation.receipts],
      origin: 'constructed-standard',
      derivation: {
        formula: 'operatingIncome + depreciationAndAmortization',
        componentMetrics: ['operatingIncome', 'depreciationAndAmortization'],
        componentReceipts: [...leftObservation.receipts, ...rightObservation.receipts],
      },
    });
  }
  return out;
}

function constructInstantDifference(
  left: SelectedObservation[],
  right: SelectedObservation[],
): SelectedObservation[] {
  const rightByFy = indexByFiscalYear(right);
  const out: SelectedObservation[] = [];
  for (const leftObservation of left) {
    const rightObservation = rightByFy.get(leftObservation.fiscalYear);
    if (!rightObservation || leftObservation.periodEnd !== rightObservation.periodEnd) continue;
    out.push({
      fiscalYear: leftObservation.fiscalYear,
      periodEnd: leftObservation.periodEnd,
      value: leftObservation.value - rightObservation.value,
      receipts: [...leftObservation.receipts, ...rightObservation.receipts],
      origin: 'constructed-standard',
      derivation: {
        formula: 'totalDebt - cashAndEquivalents',
        componentMetrics: ['totalDebt', 'cashAndEquivalents'],
        componentReceipts: [...leftObservation.receipts, ...rightObservation.receipts],
      },
    });
  }
  return out;
}

function constructInstantSum(
  left: SelectedObservation[],
  right: SelectedObservation[],
): SelectedObservation[] {
  const rightByFy = indexByFiscalYear(right);
  const out: SelectedObservation[] = [];
  for (const leftObservation of left) {
    const rightObservation = rightByFy.get(leftObservation.fiscalYear);
    if (!rightObservation || leftObservation.periodEnd !== rightObservation.periodEnd) continue;
    out.push({
      fiscalYear: leftObservation.fiscalYear,
      periodEnd: leftObservation.periodEnd,
      value: leftObservation.value + rightObservation.value,
      receipts: [...leftObservation.receipts, ...rightObservation.receipts],
      origin: 'constructed-standard',
      derivation: {
        formula: 'debtCurrent + longTermDebtNoncurrent',
        componentMetrics: ['debtCurrent', 'longTermDebtNoncurrent'],
        componentReceipts: [...leftObservation.receipts, ...rightObservation.receipts],
      },
    });
  }
  return out;
}

/**
 * Adds a separately reported commercial-paper balance only to a selected
 * `LongTermDebtCurrent` observation on the identical balance-sheet date.
 *
 * `DebtCurrent` is treated as comprehensive and `ShortTermBorrowings` may already
 * include commercial paper, so neither is augmented. A missing or date-misaligned
 * commercial-paper fact leaves the selected current-debt observation unchanged;
 * absence is never fabricated as a reported zero or attached as a receipt.
 */
function includeAlignedCommercialPaper(
  currentDebt: SelectedObservation[],
  commercialPaper: SelectedObservation[],
): SelectedObservation[] {
  const commercialPaperByFy = indexByFiscalYear(commercialPaper);
  return currentDebt.map((debtObservation) => {
    if (debtObservation.receipts[0]?.concept !== 'LongTermDebtCurrent') return debtObservation;
    const paperObservation = commercialPaperByFy.get(debtObservation.fiscalYear);
    if (!paperObservation || paperObservation.periodEnd !== debtObservation.periodEnd) return debtObservation;
    return {
      fiscalYear: debtObservation.fiscalYear,
      periodEnd: debtObservation.periodEnd,
      value: debtObservation.value + paperObservation.value,
      receipts: [...debtObservation.receipts, ...paperObservation.receipts],
      origin: 'constructed-standard' as const,
      derivation: {
        formula: 'longTermDebtCurrent + commercialPaper',
        componentMetrics: ['debtCurrent'] as FundamentalsMetricKey[],
        componentReceipts: [...debtObservation.receipts, ...paperObservation.receipts],
      },
    };
  });
}

/**
 * Safe depth-one fallback for a missing direct revenue period. Only directly reported
 * standard facts from the same filing accession and exact annual period may be added.
 */
export function constructRevenueFromGrossProfitAndCostOfRevenue(
  grossProfit: FundamentalsObservation[],
  costOfRevenue: FundamentalsObservation[],
): FundamentalsObservation[] {
  const costsByYear = indexByFiscalYear(costOfRevenue);
  const output: FundamentalsObservation[] = [];
  for (const gross of grossProfit) {
    const cost = costsByYear.get(gross.fiscalYear);
    if (!cost || !sameAnnualPeriod(gross, cost)) continue;
    if (gross.origin !== 'direct-standard' || cost.origin !== 'direct-standard') continue;
    if (gross.receipts[0]?.unit !== 'USD' || cost.receipts[0]?.unit !== 'USD') continue;
    if (!(cost.value >= 0)) continue;
    const value = gross.value + cost.value;
    if (!Number.isFinite(value) || !(value > 0)) continue;
    const componentReceipts = [...gross.receipts, ...cost.receipts];
    output.push({
      fiscalYear: gross.fiscalYear,
      periodEnd: gross.periodEnd,
      value,
      receipts: componentReceipts,
      origin: 'constructed-standard',
      derivation: {
        formula: 'grossProfit + costOfRevenue',
        componentMetrics: ['grossProfit', 'costOfRevenue'],
        componentReceipts,
      },
    });
  }
  return output;
}

/** Direct combined D&A is merged first; this function supplies only missing periods. */
export function constructDepreciationAndAmortization(
  depreciation: FundamentalsObservation[],
  amortization: FundamentalsObservation[],
): FundamentalsObservation[] {
  const amortizationByYear = indexByFiscalYear(amortization);
  const output: FundamentalsObservation[] = [];
  for (const depreciationObservation of depreciation) {
    const amortizationObservation = amortizationByYear.get(depreciationObservation.fiscalYear);
    if (!amortizationObservation || !sameAnnualPeriod(depreciationObservation, amortizationObservation)) continue;
    if (depreciationObservation.origin !== 'direct-standard' || amortizationObservation.origin !== 'direct-standard') continue;
    if (depreciationObservation.receipts[0]?.unit !== 'USD' || amortizationObservation.receipts[0]?.unit !== 'USD') continue;
    if (depreciationObservation.value < 0 || amortizationObservation.value < 0) continue;
    const value = depreciationObservation.value + amortizationObservation.value;
    if (!Number.isFinite(value)) continue;
    const componentReceipts = [...depreciationObservation.receipts, ...amortizationObservation.receipts];
    output.push({
      fiscalYear: depreciationObservation.fiscalYear,
      periodEnd: depreciationObservation.periodEnd,
      value,
      receipts: componentReceipts,
      origin: 'constructed-standard',
      derivation: {
        formula: 'depreciation + amortization',
        componentMetrics: ['depreciationAndAmortization'],
        componentReceipts,
      },
    });
  }
  return output;
}

function mergeDirectWithFallback(
  direct: SelectedObservation[],
  fallback: FundamentalsObservation[],
): SelectedObservation[] {
  const directYears = new Set(direct.map((observation) => observation.fiscalYear));
  return [...direct, ...fallback.filter((observation) => !directYears.has(observation.fiscalYear))];
}

function reconcileDirectAndConstructedRevenue(
  direct: SelectedObservation[],
  constructed: FundamentalsObservation[],
): FundamentalsReconciliation[] {
  const constructedByYear = indexByFiscalYear(constructed);
  const output: FundamentalsReconciliation[] = [];
  for (const directObservation of direct) {
    const constructedObservation = constructedByYear.get(directObservation.fiscalYear);
    if (!constructedObservation || !sameAnnualPeriod(directObservation, constructedObservation)) continue;
    const difference = directObservation.value - constructedObservation.value;
    const tolerance = Math.max(1, Math.abs(directObservation.value) * 0.000001);
    output.push({
      metric: 'revenue',
      fiscalYear: directObservation.fiscalYear,
      directValue: directObservation.value,
      constructedValue: constructedObservation.value,
      difference,
      tolerance,
      status: Math.abs(difference) <= tolerance ? 'aligned' : 'mismatch',
      directReceipts: directObservation.receipts,
      componentReceipts: constructedObservation.receipts,
    });
  }
  return output;
}

function sameAnnualPeriod(left: FundamentalsObservation, right: FundamentalsObservation): boolean {
  const leftReceipt = left.receipts[0];
  const rightReceipt = right.receipts[0];
  return (
    left.periodEnd === right.periodEnd &&
    leftReceipt?.start !== undefined &&
    leftReceipt.start === rightReceipt?.start &&
    leftReceipt.accn === rightReceipt?.accn
  );
}

function indexByFiscalYear<T extends FundamentalsObservation>(observations: T[]): Map<number, T> {
  const map = new Map<number, T>();
  for (const obs of observations) map.set(obs.fiscalYear, obs);
  return map;
}

/** Official SEC filing-index URL for an accession number. */
export function secFilingIndexUrl(cikNumber: number, accn: string): string {
  const bare = accn.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${cikNumber}/${bare}/${accn}-index.htm`;
}

function durationDays(start: string, end: string): number {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / MS_PER_DAY;
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString().slice(0, 10) === value;
}
