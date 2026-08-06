import type {
  FinancialFactOrigin,
  FundamentalsMetricKey,
  FundamentalsObservation,
  FundamentalsResult,
  FundamentalsSeries,
  SourceReceipt,
} from '@/domain/fundamentals';

export type ValuationAnchorKey =
  | 'baseRevenue'
  | 'dilutedShares'
  | 'netDebt'
  | 'operatingMarginReference'
  | 'revenueGrowthReference'
  | 'daRevenueReference'
  | 'capexRevenueReference'
  | 'cashTaxReference';

export type ValuationAnchorStatus =
  | 'sec-ready'
  | 'constructed-ready'
  | 'limited-history'
  | 'manual-required'
  | 'not-meaningful'
  | 'unavailable';

export type ValuationReadinessReason =
  | 'exact-fiscal-year-missing'
  | 'fewer-than-three-observations'
  | 'negative-or-zero-earnings'
  | 'negative-or-zero-ebitda'
  | 'manual-forecast-required'
  | 'missing-required-anchor';

export interface ValuationAnchorState {
  key: ValuationAnchorKey;
  status: ValuationAnchorStatus;
  value?: number;
  fiscalYear?: number;
  origin?: FinancialFactOrigin | 'historical-derived';
  receipts: SourceReceipt[];
  reasonCode?: ValuationReadinessReason;
  observationCount?: number;
  fiscalYears?: number[];
  formula?: string;
}

export type ValuationMethodKey = 'dcf' | 'pe' | 'ev-revenue' | 'ev-ebitda';

export interface ValuationMethodState {
  key: ValuationMethodKey;
  available: boolean;
  reasonCode?: ValuationReadinessReason;
  financialMetric?: number;
}

export interface ValuationReadiness {
  fiscalYear?: number;
  anchors: Record<ValuationAnchorKey, ValuationAnchorState>;
  methods: Record<ValuationMethodKey, ValuationMethodState>;
  defaultComparableMethod?: Exclude<ValuationMethodKey, 'dcf'>;
}

export function buildValuationReadiness(result: FundamentalsResult): ValuationReadiness {
  const revenueSeries = metric(result, 'revenue');
  const revenue = revenueSeries?.available ? revenueSeries.observations[0] : undefined;
  const fiscalYear = revenue?.fiscalYear;
  const shares = fiscalYear === undefined ? undefined : observationForYear(metric(result, 'dilutedShares'), fiscalYear);
  const margin = fiscalYear === undefined ? undefined : observationForYear(metric(result, 'operatingMargin'), fiscalYear);
  const netDebt = fiscalYear === undefined ? undefined : observationForYear(metric(result, 'netDebt'), fiscalYear);

  const anchors: Record<ValuationAnchorKey, ValuationAnchorState> = {
    baseRevenue: evidenceAnchor('baseRevenue', revenue),
    dilutedShares: evidenceAnchor('dilutedShares', shares, fiscalYear),
    netDebt: evidenceAnchor('netDebt', netDebt, fiscalYear),
    operatingMarginReference: evidenceAnchor('operatingMarginReference', margin, fiscalYear),
    revenueGrowthReference: historicalGrowthAnchor(revenueSeries),
    daRevenueReference: historicalRatioAnchor('daRevenueReference', metric(result, 'depreciationAndAmortization'), revenueSeries),
    capexRevenueReference: historicalRatioAnchor('capexRevenueReference', metric(result, 'capitalExpenditure'), revenueSeries),
    cashTaxReference: historicalTaxAnchor(metric(result, 'incomeTaxExpense'), metric(result, 'pretaxIncome')),
  };

  const eps = fiscalYear === undefined ? undefined : observationForYear(metric(result, 'dilutedEps'), fiscalYear)?.value;
  const ebitda = fiscalYear === undefined ? undefined : observationForYear(metric(result, 'ebitda'), fiscalYear)?.value;
  const pe: ValuationMethodState = eps !== undefined && eps > 0
    ? { key: 'pe', available: true, financialMetric: eps }
    : { key: 'pe', available: false, reasonCode: 'negative-or-zero-earnings' };
  const evRevenueReady = Boolean(revenue && revenue.value > 0 && shares && netDebt);
  const evRevenue: ValuationMethodState = evRevenueReady
    ? { key: 'ev-revenue', available: true, financialMetric: revenue?.value }
    : { key: 'ev-revenue', available: false, reasonCode: 'missing-required-anchor' };
  const evEbitda: ValuationMethodState = ebitda !== undefined && ebitda > 0 && Boolean(shares && netDebt)
    ? { key: 'ev-ebitda', available: true, financialMetric: ebitda }
    : { key: 'ev-ebitda', available: false, reasonCode: ebitda !== undefined && ebitda <= 0 ? 'negative-or-zero-ebitda' : 'missing-required-anchor' };
  const dcfReady = Boolean(revenue && shares);
  const dcf: ValuationMethodState = dcfReady
    ? { key: 'dcf', available: true }
    : { key: 'dcf', available: false, reasonCode: 'missing-required-anchor' };

  return {
    ...(fiscalYear === undefined ? {} : { fiscalYear }),
    anchors,
    methods: { dcf, pe, 'ev-revenue': evRevenue, 'ev-ebitda': evEbitda },
    defaultComparableMethod: pe.available ? 'pe' : evRevenue.available ? 'ev-revenue' : evEbitda.available ? 'ev-ebitda' : undefined,
  };
}

function evidenceAnchor(
  key: ValuationAnchorKey,
  observation: FundamentalsObservation | undefined,
  expectedFiscalYear?: number,
): ValuationAnchorState {
  if (!observation) {
    return {
      key,
      status: 'manual-required',
      receipts: [],
      reasonCode: expectedFiscalYear === undefined ? 'missing-required-anchor' : 'exact-fiscal-year-missing',
    };
  }
  return {
    key,
    status: observation.origin === 'constructed-standard' ? 'constructed-ready' : 'sec-ready',
    value: observation.value,
    fiscalYear: observation.fiscalYear,
    origin: observation.origin ?? 'direct-standard',
    receipts: observation.receipts,
    ...(observation.derivation ? { formula: observation.derivation.formula } : {}),
  };
}

function historicalGrowthAnchor(series: FundamentalsSeries | undefined): ValuationAnchorState {
  const rates: number[] = [];
  if (series?.available) {
    const chronological = [...series.observations].sort((left, right) => left.fiscalYear - right.fiscalYear);
    for (let index = 1; index < chronological.length; index += 1) {
      const prior = chronological[index - 1];
      const current = chronological[index];
      if (prior.value > 0 && current.value > 0 && current.fiscalYear === prior.fiscalYear + 1) rates.push(current.value / prior.value - 1);
    }
  }
  return historicalAnchor('revenueGrowthReference', rates, series?.observations ?? [], 'median annual revenue growth');
}

function historicalRatioAnchor(
  key: 'daRevenueReference' | 'capexRevenueReference' | 'cashTaxReference',
  numerator: FundamentalsSeries | undefined,
  denominator: FundamentalsSeries | undefined,
): ValuationAnchorState {
  const observations: FundamentalsObservation[] = [];
  const ratios: number[] = [];
  for (const item of numerator?.observations ?? []) {
    const match = denominator?.observations.find((candidate) => candidate.fiscalYear === item.fiscalYear && candidate.periodEnd === item.periodEnd);
    if (!match || !(match.value > 0)) continue;
    ratios.push(item.value / match.value);
    observations.push(item);
  }
  return historicalAnchor(key, ratios, observations, `${numerator?.metric ?? key} / revenue median`);
}

function historicalTaxAnchor(tax: FundamentalsSeries | undefined, pretax: FundamentalsSeries | undefined): ValuationAnchorState {
  return historicalRatioAnchor('cashTaxReference', tax, pretax);
}

function historicalAnchor(
  key: ValuationAnchorKey,
  values: number[],
  observations: FundamentalsObservation[],
  formula: string,
): ValuationAnchorState {
  const fiscalYears = observations.map((observation) => observation.fiscalYear);
  const receipts = observations.flatMap((observation) => observation.receipts);
  if (values.length < 3) {
    return {
      key,
      status: values.length > 0 ? 'limited-history' : 'manual-required',
      receipts,
      reasonCode: 'fewer-than-three-observations',
      observationCount: values.length,
      fiscalYears,
      formula,
    };
  }
  return {
    key,
    status: 'constructed-ready',
    value: median(values),
    origin: 'historical-derived',
    receipts,
    observationCount: values.length,
    fiscalYears,
    formula,
  };
}

function observationForYear(series: FundamentalsSeries | undefined, fiscalYear: number): FundamentalsObservation | undefined {
  return series?.available ? series.observations.find((observation) => observation.fiscalYear === fiscalYear) : undefined;
}

function metric(result: FundamentalsResult, key: FundamentalsMetricKey): FundamentalsSeries | undefined {
  return result.metrics.find((series) => series.metric === key);
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
