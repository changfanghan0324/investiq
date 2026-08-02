// Purpose: Auditable financial-ratio construction over the SEC fundamentals layer.
// Missing facts are never zero-filled. Flow facts must share an annual period,
// point-in-time facts must share a date, and return/turnover ratios require two
// consecutive year-end balances.

import type {
  FundamentalsMetricKey,
  FundamentalsObservation,
  FundamentalsResult,
  FundamentalsSeries,
  SourceReceipt,
} from '@/domain/fundamentals';

export type CompanyRatioKey =
  | 'grossMargin'
  | 'netMargin'
  | 'returnOnEquity'
  | 'returnOnAssets'
  | 'returnOnInvestedCapital'
  | 'debtToEquity'
  | 'currentRatio'
  | 'quickRatio'
  | 'interestCoverage'
  | 'netDebtToEbitda'
  | 'assetTurnover'
  | 'inventoryTurnover'
  | 'receivablesTurnover'
  | 'cashConversionCycle';

export type CompanyRatioUnit = 'ratio' | 'percent' | 'days';
export type CompanyRatioUnavailableReason =
  | 'financial-issuer'
  | 'unknown-industry'
  | 'missing-or-unaligned-inputs';

export interface CompanyRatioObservation {
  fiscalYear: number;
  periodEnd: string;
  value: number;
  receipts: SourceReceipt[];
}

export interface CompanyRatioSeries {
  metric: CompanyRatioKey;
  unit: CompanyRatioUnit;
  formula: string;
  basis?: string;
  available: boolean;
  observations: CompanyRatioObservation[];
  unavailableReason?: CompanyRatioUnavailableReason;
}

const ISSUER_GATED = new Set<CompanyRatioKey>([
  'grossMargin',
  'netMargin',
  'returnOnInvestedCapital',
  'currentRatio',
  'quickRatio',
  'interestCoverage',
  'netDebtToEbitda',
  'assetTurnover',
  'inventoryTurnover',
  'receivablesTurnover',
  'cashConversionCycle',
  'debtToEquity',
]);

export function buildCompanyFinancialAnalysis(result: FundamentalsResult): CompanyRatioSeries[] {
  const get = (key: FundamentalsMetricKey) => result.metrics.find((item) => item.metric === key);
  const industryReason: CompanyRatioUnavailableReason | undefined = result.identity.isFinancialIssuer
    ? 'financial-issuer'
    : result.identity.sicCode === undefined
      ? 'unknown-industry'
      : undefined;

  const grossProfit = preferReportedGrossProfit(get('grossProfit'), get('revenue'), get('costOfRevenue'));
  const investedCapital = constructInvestedCapital(
    get('totalDebt'),
    get('stockholdersEquity'),
    get('cashAndEquivalents'),
  );

  const definitions: Array<Omit<CompanyRatioSeries, 'available' | 'unavailableReason'> & { gated?: boolean }> = [
    {
      metric: 'grossMargin', unit: 'percent', formula: 'Gross profit ÷ revenue', gated: true,
      observations: divideAlignedFlows(grossProfit, get('revenue')),
    },
    {
      metric: 'netMargin', unit: 'percent', formula: 'Net income ÷ revenue', gated: true,
      observations: divideAlignedFlows(get('netIncome'), get('revenue')),
    },
    {
      metric: 'returnOnEquity', unit: 'percent', formula: 'Net income attributable to parent ÷ average stockholders’ equity',
      observations: divideFlowByAverageBalance(parentNetIncomeOnly(get('netIncome')), get('stockholdersEquity')),
    },
    {
      metric: 'returnOnAssets', unit: 'percent', formula: 'Net income ÷ average total assets', basis: 'Net-income attribution follows the selected SEC concept; noncontrolling interests can reduce comparability.',
      observations: divideFlowByAverageBalance(get('netIncome'), get('totalAssets')),
    },
    {
      metric: 'returnOnInvestedCapital', unit: 'percent', formula: 'Operating income × (1 − effective tax rate) ÷ average invested capital', gated: true,
      observations: constructRoic(get('operatingIncome'), get('incomeTaxExpense'), get('pretaxIncome'), investedCapital),
    },
    {
      metric: 'debtToEquity', unit: 'ratio', formula: 'Total interest-bearing debt ÷ stockholders’ equity', gated: true,
      observations: divideAlignedInstants(get('totalDebt'), get('stockholdersEquity')),
    },
    {
      metric: 'currentRatio', unit: 'ratio', formula: 'Current assets ÷ current liabilities', gated: true,
      observations: divideAlignedInstants(get('currentAssets'), get('currentLiabilities')),
    },
    {
      metric: 'quickRatio', unit: 'ratio', formula: '(Current assets − net inventory) ÷ current liabilities', gated: true,
      observations: constructQuickRatio(get('currentAssets'), get('inventoryNet'), get('currentLiabilities')),
    },
    {
      metric: 'interestCoverage', unit: 'ratio', formula: 'Operating income ÷ interest expense', basis: 'Operating income is used as an EBIT proxy.', gated: true,
      observations: divideAlignedFlows(get('operatingIncome'), get('interestExpense')),
    },
    {
      metric: 'netDebtToEbitda', unit: 'ratio', formula: 'Net debt ÷ operating-income-based EBITDA', gated: true,
      observations: divideInstantByFlow(get('netDebt'), get('ebitda')),
    },
    {
      metric: 'assetTurnover', unit: 'ratio', formula: 'Revenue ÷ average total assets', gated: true,
      observations: divideFlowByAverageBalance(get('revenue'), get('totalAssets')),
    },
    {
      metric: 'inventoryTurnover', unit: 'ratio', formula: 'Cost of revenue ÷ average net inventory', gated: true,
      observations: divideFlowByAverageBalance(get('costOfRevenue'), get('inventoryNet')),
    },
    {
      metric: 'receivablesTurnover', unit: 'ratio', formula: 'Revenue ÷ average current net receivables', basis: 'Total revenue is used as a proxy for credit sales.', gated: true,
      observations: divideFlowByAverageBalance(get('revenue'), get('accountsReceivableNetCurrent')),
    },
    {
      metric: 'cashConversionCycle', unit: 'days', formula: '365 × inventory ÷ cost + 365 × receivables ÷ revenue − 365 × payables ÷ cost', basis: 'Uses a 365-day convention.', gated: true,
      observations: constructCashConversionCycle(
        get('revenue'),
        get('costOfRevenue'),
        get('inventoryNet'),
        get('accountsReceivableNetCurrent'),
        get('accountsPayableCurrent'),
      ),
    },
  ];

  return definitions.map(({ gated, ...definition }) => {
    const gatedReason = (gated || ISSUER_GATED.has(definition.metric)) ? industryReason : undefined;
    const observations = gatedReason ? [] : definition.observations;
    return observations.length > 0
      ? { ...definition, available: true, observations }
      : {
          ...definition,
          available: false,
          observations: [],
          unavailableReason: gatedReason ?? 'missing-or-unaligned-inputs',
        };
  });
}

function preferReportedGrossProfit(
  grossProfit?: FundamentalsSeries,
  revenue?: FundamentalsSeries,
  cost?: FundamentalsSeries,
): FundamentalsSeries | undefined {
  const reported = availableObservations(grossProfit);
  const constructed = subtractAlignedFlows(revenue, cost);
  const byYear = new Map(constructed.map((item) => [item.fiscalYear, item]));
  for (const item of reported) byYear.set(item.fiscalYear, item);
  const observations = [...byYear.values()].sort((a, b) => b.fiscalYear - a.fiscalYear);
  if (!observations.length) return undefined;
  return { metric: 'grossProfit', unit: 'USD', basis: 'Reported gross profit, otherwise revenue minus cost of revenue', available: true, observations };
}

function parentNetIncomeOnly(series?: FundamentalsSeries): FundamentalsSeries | undefined {
  if (!series?.available) return undefined;
  const observations = series.observations.filter((item) =>
    item.receipts.some((receipt) => receipt.concept === 'NetIncomeLoss'),
  );
  return observations.length ? { ...series, observations } : undefined;
}

function constructInvestedCapital(
  debt?: FundamentalsSeries,
  equity?: FundamentalsSeries,
  cash?: FundamentalsSeries,
): FundamentalsSeries | undefined {
  const out: FundamentalsObservation[] = [];
  for (const debtObservation of availableObservations(debt)) {
    const equityObservation = instantAt(equity, debtObservation.periodEnd);
    const cashObservation = instantAt(cash, debtObservation.periodEnd);
    if (!equityObservation || !cashObservation) continue;
    const value = debtObservation.value + equityObservation.value - cashObservation.value;
    if (!Number.isFinite(value)) continue;
    out.push({
      fiscalYear: debtObservation.fiscalYear,
      periodEnd: debtObservation.periodEnd,
      value,
      receipts: uniqueReceipts([...debtObservation.receipts, ...equityObservation.receipts, ...cashObservation.receipts]),
    });
  }
  return out.length
    ? { metric: 'totalDebt', unit: 'USD', basis: 'Total debt + stockholders equity − cash', available: true, observations: out }
    : undefined;
}

function divideAlignedFlows(numerator?: FundamentalsSeries, denominator?: FundamentalsSeries): CompanyRatioObservation[] {
  const out: CompanyRatioObservation[] = [];
  for (const top of availableObservations(numerator)) {
    const bottom = flowAt(denominator, top);
    if (!bottom || !(bottom.value > 0)) continue;
    out.push(ratioObservation(top, bottom, top.value / bottom.value));
  }
  return out;
}

function divideAlignedInstants(numerator?: FundamentalsSeries, denominator?: FundamentalsSeries): CompanyRatioObservation[] {
  const out: CompanyRatioObservation[] = [];
  for (const top of availableObservations(numerator)) {
    const bottom = instantAt(denominator, top.periodEnd);
    if (!bottom || !(bottom.value > 0)) continue;
    out.push(ratioObservation(top, bottom, top.value / bottom.value));
  }
  return out;
}

function divideInstantByFlow(instant?: FundamentalsSeries, flow?: FundamentalsSeries): CompanyRatioObservation[] {
  const out: CompanyRatioObservation[] = [];
  for (const top of availableObservations(instant)) {
    const bottom = availableObservations(flow).find((item) => item.periodEnd === top.periodEnd);
    if (!bottom || !(bottom.value > 0)) continue;
    out.push(ratioObservation(top, bottom, top.value / bottom.value));
  }
  return out;
}

function divideFlowByAverageBalance(flow?: FundamentalsSeries, balance?: FundamentalsSeries): CompanyRatioObservation[] {
  const out: CompanyRatioObservation[] = [];
  for (const numerator of availableObservations(flow)) {
    const average = averageBalance(balance, numerator);
    if (!average || !(average.value > 0)) continue;
    out.push({
      fiscalYear: numerator.fiscalYear,
      periodEnd: numerator.periodEnd,
      value: numerator.value / average.value,
      receipts: uniqueReceipts([...numerator.receipts, ...average.receipts]),
    });
  }
  return out;
}

function constructQuickRatio(
  currentAssets?: FundamentalsSeries,
  inventory?: FundamentalsSeries,
  currentLiabilities?: FundamentalsSeries,
): CompanyRatioObservation[] {
  const out: CompanyRatioObservation[] = [];
  for (const assets of availableObservations(currentAssets)) {
    const stock = instantAt(inventory, assets.periodEnd);
    const liabilities = instantAt(currentLiabilities, assets.periodEnd);
    if (!stock || !liabilities || !(liabilities.value > 0)) continue;
    const quickAssets = assets.value - stock.value;
    if (quickAssets < 0) continue;
    out.push({
      fiscalYear: assets.fiscalYear,
      periodEnd: assets.periodEnd,
      value: quickAssets / liabilities.value,
      receipts: uniqueReceipts([...assets.receipts, ...stock.receipts, ...liabilities.receipts]),
    });
  }
  return out;
}

function constructRoic(
  operatingIncome?: FundamentalsSeries,
  taxExpense?: FundamentalsSeries,
  pretaxIncome?: FundamentalsSeries,
  investedCapital?: FundamentalsSeries,
): CompanyRatioObservation[] {
  const out: CompanyRatioObservation[] = [];
  for (const operating of availableObservations(operatingIncome)) {
    const tax = flowAt(taxExpense, operating);
    const pretax = flowAt(pretaxIncome, operating);
    const capital = averageBalance(investedCapital, operating);
    if (!tax || !pretax || !capital || !(pretax.value > 0) || !(capital.value > 0)) continue;
    const taxRate = tax.value / pretax.value;
    if (taxRate < 0 || taxRate > 1) continue;
    const nopat = operating.value * (1 - taxRate);
    out.push({
      fiscalYear: operating.fiscalYear,
      periodEnd: operating.periodEnd,
      value: nopat / capital.value,
      receipts: uniqueReceipts([...operating.receipts, ...tax.receipts, ...pretax.receipts, ...capital.receipts]),
    });
  }
  return out;
}

function constructCashConversionCycle(
  revenue?: FundamentalsSeries,
  cost?: FundamentalsSeries,
  inventory?: FundamentalsSeries,
  receivables?: FundamentalsSeries,
  payables?: FundamentalsSeries,
): CompanyRatioObservation[] {
  const out: CompanyRatioObservation[] = [];
  for (const sales of availableObservations(revenue)) {
    const cogs = flowAt(cost, sales);
    const avgInventory = averageBalance(inventory, sales);
    const avgReceivables = averageBalance(receivables, sales);
    const avgPayables = averageBalance(payables, sales);
    if (!cogs || !avgInventory || !avgReceivables || !avgPayables || !(sales.value > 0) || !(cogs.value > 0)) continue;
    if (!(avgInventory.value > 0) || !(avgReceivables.value > 0) || !(avgPayables.value > 0)) continue;
    const value = (365 * avgInventory.value / cogs.value)
      + (365 * avgReceivables.value / sales.value)
      - (365 * avgPayables.value / cogs.value);
    out.push({
      fiscalYear: sales.fiscalYear,
      periodEnd: sales.periodEnd,
      value,
      receipts: uniqueReceipts([
        ...sales.receipts,
        ...cogs.receipts,
        ...avgInventory.receipts,
        ...avgReceivables.receipts,
        ...avgPayables.receipts,
      ]),
    });
  }
  return out;
}

function subtractAlignedFlows(left?: FundamentalsSeries, right?: FundamentalsSeries): FundamentalsObservation[] {
  const out: FundamentalsObservation[] = [];
  for (const leftObservation of availableObservations(left)) {
    const rightObservation = flowAt(right, leftObservation);
    if (!rightObservation) continue;
    out.push({
      fiscalYear: leftObservation.fiscalYear,
      periodEnd: leftObservation.periodEnd,
      value: leftObservation.value - rightObservation.value,
      receipts: uniqueReceipts([...leftObservation.receipts, ...rightObservation.receipts]),
    });
  }
  return out;
}

function averageBalance(series: FundamentalsSeries | undefined, flow: FundamentalsObservation) {
  const current = instantAt(series, flow.periodEnd);
  if (!current) return undefined;
  const prior = availableObservations(series).find((item) => {
    if (item.periodEnd >= current.periodEnd) return false;
    const days = dateDistanceDays(item.periodEnd, current.periodEnd);
    return days >= 350 && days <= 380;
  });
  if (!prior) return undefined;
  return {
    value: (current.value + prior.value) / 2,
    receipts: uniqueReceipts([...current.receipts, ...prior.receipts]),
  };
}

function flowAt(series: FundamentalsSeries | undefined, target: FundamentalsObservation) {
  const targetStart = target.receipts[0]?.start;
  return availableObservations(series).find((item) =>
    item.periodEnd === target.periodEnd && item.receipts[0]?.start === targetStart,
  );
}

function instantAt(series: FundamentalsSeries | undefined, periodEnd: string) {
  return availableObservations(series).find((item) => item.periodEnd === periodEnd);
}

function availableObservations(series?: FundamentalsSeries): FundamentalsObservation[] {
  return series?.available ? series.observations : [];
}

function ratioObservation(
  numerator: FundamentalsObservation,
  denominator: FundamentalsObservation,
  value: number,
): CompanyRatioObservation {
  return {
    fiscalYear: numerator.fiscalYear,
    periodEnd: numerator.periodEnd,
    value,
    receipts: uniqueReceipts([...numerator.receipts, ...denominator.receipts]),
  };
}

function uniqueReceipts(receipts: SourceReceipt[]): SourceReceipt[] {
  const seen = new Set<string>();
  return receipts.filter((receipt) => {
    const key = `${receipt.taxonomy}:${receipt.concept}:${receipt.accn}:${receipt.start ?? ''}:${receipt.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dateDistanceDays(left: string, right: string): number {
  return Math.round((Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / 86_400_000);
}
