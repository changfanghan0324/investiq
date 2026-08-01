import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { buildCompanyFinancialAnalysis, type CompanyRatioKey } from '@/domain/company-financial-analysis';
import type {
  FundamentalsMetricKey,
  FundamentalsObservation,
  FundamentalsResult,
  FundamentalsSeries,
  SourceReceipt,
} from '@/domain/fundamentals';

function receipt(concept: string, end: string, start?: string): SourceReceipt {
  return {
    taxonomy: 'us-gaap', concept, unit: 'USD', accn: `${concept}-${end}`, form: '10-K', fp: 'FY', fy: Number(end.slice(0, 4)),
    filed: `${Number(end.slice(0, 4)) + 1}-02-01`, ...(start ? { start } : {}), end, sourceUrl: 'https://www.sec.gov/test',
  };
}

function observation(year: number, value: number, concept: string, duration = false): FundamentalsObservation {
  const end = `${year}-12-31`;
  return { fiscalYear: year, periodEnd: end, value, receipts: [receipt(concept, end, duration ? `${year}-01-01` : undefined)] };
}

function series(key: FundamentalsMetricKey, values: Array<[number, number]>, duration = false): FundamentalsSeries {
  return {
    metric: key, unit: key.includes('Margin') ? 'ratio' : 'USD', basis: key, available: true,
    observations: values.map(([year, value]) => observation(year, value, key, duration)),
  };
}

function result(metrics: FundamentalsSeries[], overrides: Partial<FundamentalsResult['identity']> = {}): FundamentalsResult {
  return {
    identity: {
      cik: '0000000001', ticker: 'TEST', name: 'Test', sicCode: 3571, sicDescription: 'Computers',
      isFinancialIssuer: false, sectorClassification: null, ...overrides,
    },
    period: 'annual', basis: 'as-most-recently-reported', displayOnly: true, disclaimer: 'test',
    fiscalYears: [2024, 2023], metrics, coverage: { unavailable: [] },
  };
}

function ratio(input: FundamentalsResult, key: CompanyRatioKey) {
  const found = buildCompanyFinancialAnalysis(input).find((item) => item.metric === key);
  assert.ok(found, `missing ${key}`);
  return found;
}

describe('company financial analysis', () => {
  it('uses reported gross profit before the constructed revenue-minus-cost fallback', () => {
    const input = result([
      series('grossProfit', [[2024, 45]], true),
      series('revenue', [[2024, 100]], true),
      series('costOfRevenue', [[2024, 60]], true),
    ]);
    const metric = ratio(input, 'grossMargin');
    assert.equal(metric.available, true);
    assert.equal(metric.observations[0].value, 0.45);
    assert.ok(metric.observations[0].receipts.some((item) => item.concept === 'grossProfit'));
    assert.ok(!metric.observations[0].receipts.some((item) => item.concept === 'costOfRevenue'));
  });

  it('constructs gross margin only when revenue and cost share the exact annual period', () => {
    const input = result([
      series('revenue', [[2024, 100]], true),
      series('costOfRevenue', [[2024, 60]], true),
    ]);
    assert.equal(ratio(input, 'grossMargin').observations[0].value, 0.4);
  });

  it('requires two consecutive year-end balances for ROE and asset turnover', () => {
    const incomplete = result([
      series('netIncome', [[2024, 20]], true),
      series('revenue', [[2024, 200]], true),
      series('stockholdersEquity', [[2024, 100]]),
      series('totalAssets', [[2024, 300]]),
    ]);
    assert.equal(ratio(incomplete, 'returnOnEquity').available, false);
    assert.equal(ratio(incomplete, 'assetTurnover').available, false);

    const parentIncome = series('netIncome', [[2024, 20]], true);
    parentIncome.observations[0].receipts[0].concept = 'NetIncomeLoss';
    const complete = result([
      parentIncome,
      series('revenue', [[2024, 200]], true),
      series('stockholdersEquity', [[2024, 100], [2023, 60]]),
      series('totalAssets', [[2024, 300], [2023, 200]]),
    ]);
    assert.equal(ratio(complete, 'returnOnEquity').observations[0].value, 0.25);
    assert.equal(ratio(complete, 'assetTurnover').observations[0].value, 0.8);
  });

  it('does not pair consolidated ProfitLoss with parent-only stockholders equity for ROE', () => {
    const consolidatedIncome = series('netIncome', [[2024, 20]], true);
    consolidatedIncome.observations[0].receipts[0].concept = 'ProfitLoss';
    const input = result([
      consolidatedIncome,
      series('revenue', [[2024, 100]], true),
      series('stockholdersEquity', [[2024, 100], [2023, 80]]),
    ]);
    assert.equal(ratio(input, 'netMargin').observations[0].value, 0.2);
    assert.equal(ratio(input, 'returnOnEquity').available, false);
  });

  it('withholds quick ratio when inventory is missing instead of assuming zero', () => {
    const input = result([
      series('currentAssets', [[2024, 120]]),
      series('currentLiabilities', [[2024, 60]]),
    ]);
    assert.equal(ratio(input, 'currentRatio').observations[0].value, 2);
    assert.equal(ratio(input, 'quickRatio').available, false);
  });

  it('withholds ratios with zero or negative denominators', () => {
    const input = result([
      series('totalDebt', [[2024, 50]]),
      series('stockholdersEquity', [[2024, -10]]),
      series('operatingIncome', [[2024, 10]], true),
      series('interestExpense', [[2024, 0]], true),
      series('netDebt', [[2024, 20]]),
      series('ebitda', [[2024, -5]], true),
    ]);
    assert.equal(ratio(input, 'debtToEquity').available, false);
    assert.equal(ratio(input, 'interestCoverage').available, false);
    assert.equal(ratio(input, 'netDebtToEbitda').available, false);
  });

  it('calculates ROIC only with a valid effective tax rate and positive average invested capital', () => {
    const metrics = [
      series('operatingIncome', [[2024, 30]], true),
      series('incomeTaxExpense', [[2024, 5]], true),
      series('pretaxIncome', [[2024, 25]], true),
      series('totalDebt', [[2024, 50], [2023, 40]]),
      series('stockholdersEquity', [[2024, 100], [2023, 80]]),
      series('cashAndEquivalents', [[2024, 20], [2023, 10]]),
    ];
    const metric = ratio(result(metrics), 'returnOnInvestedCapital');
    assert.equal(metric.available, true);
    assert.ok(Math.abs(metric.observations[0].value - 24 / 120) < 1e-12);
  });

  it('requires every balance leg for the cash conversion cycle', () => {
    const base = [
      series('revenue', [[2024, 200]], true),
      series('costOfRevenue', [[2024, 100]], true),
      series('inventoryNet', [[2024, 20], [2023, 10]]),
      series('accountsReceivableNetCurrent', [[2024, 30], [2023, 20]]),
    ];
    assert.equal(ratio(result(base), 'cashConversionCycle').available, false);
    const metric = ratio(result([...base, series('accountsPayableCurrent', [[2024, 12], [2023, 8]])]), 'cashConversionCycle');
    assert.equal(metric.available, true);
    assert.ok(Math.abs(metric.observations[0].value - 63.875) < 1e-9);
  });

  it('withholds industry-inappropriate ratios for finance SICs and unknown SICs', () => {
    const metrics = [series('grossProfit', [[2024, 40]], true), series('revenue', [[2024, 100]], true)];
    const finance = result(metrics, { sicCode: 6021, isFinancialIssuer: true });
    assert.equal(ratio(finance, 'grossMargin').unavailableReason, 'financial-issuer');
    const unknown = result(metrics, { sicCode: undefined, isFinancialIssuer: false });
    assert.equal(ratio(unknown, 'grossMargin').unavailableReason, 'unknown-industry');
    assert.equal(ratio(unknown, 'netMargin').unavailableReason, 'unknown-industry');
  });
});
