import type { CompanyFacts, FundamentalsIdentityInput, SecFact } from '@/domain/fundamentals';

type Taxonomies = NonNullable<CompanyFacts['facts']>;

interface AnnualFixtureRow {
  fy: number;
  revenue: number;
  grossProfit: number;
  cost: number;
  operatingIncome: number;
  shares: number;
  eps: number;
  accn: string;
  filed: string;
}

const FSLY_VALUES: AnnualFixtureRow[] = [
  { fy: 2025, revenue: 624_018_000, grossProfit: 356_203_000, cost: 267_815_000, operatingIncome: -119_000_000, shares: 146_902_000, eps: -0.83, accn: '0001517413-26-000053', filed: '2026-02-25' },
  { fy: 2024, revenue: 543_676_000, grossProfit: 295_938_000, cost: 247_738_000, operatingIncome: -167_915_000, shares: 138_099_000, eps: -1.14, accn: '0001517413-26-000053', filed: '2026-02-25' },
  { fy: 2023, revenue: 505_988_000, grossProfit: 266_328_000, cost: 239_660_000, operatingIncome: -198_028_000, shares: 128_770_000, eps: -1.03, accn: '0001517413-26-000053', filed: '2026-02-25' },
  { fy: 2022, revenue: 432_725_000, grossProfit: 209_781_000, cost: 222_944_000, operatingIncome: -246_199_000, shares: 121_723_000, eps: -1.57, accn: '0001517413-25-000063', filed: '2025-02-26' },
  { fy: 2021, revenue: 354_330_000, grossProfit: 187_328_000, cost: 167_002_000, operatingIncome: -219_021_000, shares: 116_053_000, eps: -1.92, accn: '0001517413-24-000048', filed: '2024-02-22' },
] as const;

function annual(row: AnnualFixtureRow, value: number): SecFact {
  return {
    start: `${row.fy}-01-01`,
    end: `${row.fy}-12-31`,
    val: value,
    accn: row.accn,
    fy: row.fy,
    fp: 'FY',
    form: '10-K',
    filed: row.filed,
  };
}

export const FSLY_IDENTITY: FundamentalsIdentityInput = {
  cik: '0001517413',
  cikNumber: 1517413,
  ticker: 'FSLY',
  name: 'Fastly, Inc.',
  sicCode: 7372,
  sicDescription: 'Services-Prepackaged Software',
};

/** Filing-derived offline fixture; the direct standard revenue concept can be removed to exercise the fallback. */
export function fslyCompanyFacts(includeDirectRevenue = true): CompanyFacts {
  const usGaap: Taxonomies[string] = {
    GrossProfit: { units: { USD: FSLY_VALUES.map((row) => annual(row, row.grossProfit)) } },
    CostOfRevenue: { units: { USD: FSLY_VALUES.map((row) => annual(row, row.cost)) } },
    OperatingIncomeLoss: { units: { USD: FSLY_VALUES.map((row) => annual(row, row.operatingIncome)) } },
    WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: FSLY_VALUES.map((row) => annual(row, row.shares)) } },
    EarningsPerShareDiluted: { units: { 'USD/shares': FSLY_VALUES.map((row) => annual(row, row.eps)) } },
    DepreciationDepletionAndAmortization: { units: { USD: [annual(FSLY_VALUES[4], 28_799_000)] } },
  };
  if (includeDirectRevenue) {
    usGaap.RevenueFromContractWithCustomerIncludingAssessedTax = {
      units: { USD: FSLY_VALUES.map((row) => annual(row, row.revenue)) },
    };
  }
  return { cik: 1517413, entityName: 'Fastly, Inc.', facts: { 'us-gaap': usGaap } };
}

export function aaplDirectRevenueFixture(): CompanyFacts {
  const row = { ...FSLY_VALUES[0], revenue: 416_161_000_000, grossProfit: 195_201_000_000, cost: 220_960_000_000, accn: '0000320193-25-000079', filed: '2025-10-31' };
  return {
    cik: 320193,
    entityName: 'Apple Inc.',
    facts: {
      'us-gaap': {
        RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [annual(row, row.revenue)] } },
        GrossProfit: { units: { USD: [annual(row, row.grossProfit)] } },
        CostOfGoodsAndServicesSold: { units: { USD: [annual(row, row.cost)] } },
      },
    },
  };
}

export const AAPL_IDENTITY: FundamentalsIdentityInput = {
  cik: '0000320193', cikNumber: 320193, ticker: 'AAPL', name: 'Apple Inc.', sicCode: 3571,
};

export const JPM_IDENTITY: FundamentalsIdentityInput = {
  cik: '0000019617', cikNumber: 19617, ticker: 'JPM', name: 'JPMorgan Chase & Co.', sicCode: 6021,
};
