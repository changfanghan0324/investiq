import type { CompanyFacts, FundamentalsIdentityInput, SecFact } from '@/domain/fundamentals';

type Taxonomies = NonNullable<CompanyFacts['facts']>;

interface AnnualFixtureRow {
  fy: number;
  revenue: number;
  grossProfit: number;
  cost: number;
  operatingIncome: number;
  netIncome: number;
  shares: number;
  eps: number;
  accn: string;
  filed: string;
}

const FSLY_VALUES: AnnualFixtureRow[] = [
  { fy: 2025, revenue: 624_018_000, grossProfit: 356_203_000, cost: 267_815_000, operatingIncome: -119_000_000, netIncome: -121_677_000, shares: 146_902_000, eps: -0.83, accn: '0001517413-26-000053', filed: '2026-02-25' },
  { fy: 2024, revenue: 543_676_000, grossProfit: 295_938_000, cost: 247_738_000, operatingIncome: -167_915_000, netIncome: -158_058_000, shares: 138_099_000, eps: -1.14, accn: '0001517413-26-000053', filed: '2026-02-25' },
  { fy: 2023, revenue: 505_988_000, grossProfit: 266_328_000, cost: 239_660_000, operatingIncome: -198_028_000, netIncome: -133_088_000, shares: 128_770_000, eps: -1.03, accn: '0001517413-26-000053', filed: '2026-02-25' },
  { fy: 2022, revenue: 432_725_000, grossProfit: 209_781_000, cost: 222_944_000, operatingIncome: -246_199_000, netIncome: -190_774_000, shares: 121_723_000, eps: -1.57, accn: '0001517413-25-000063', filed: '2025-02-26' },
  { fy: 2021, revenue: 354_330_000, grossProfit: 187_328_000, cost: 167_002_000, operatingIncome: -219_021_000, netIncome: -222_697_000, shares: 116_053_000, eps: -1.92, accn: '0001517413-24-000048', filed: '2024-02-22' },
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

function instant(row: AnnualFixtureRow, value: number): SecFact {
  return { end: `${row.fy}-12-31`, val: value, accn: row.accn, fy: row.fy, fp: 'FY', form: '10-K', filed: row.filed };
}

export const FSLY_IDENTITY: FundamentalsIdentityInput = {
  cik: '0001517413',
  cikNumber: 1517413,
  ticker: 'FSLY',
  name: 'Fastly, Inc.',
  sicCode: 7372,
  sicDescription: 'Services-Prepackaged Software',
};

/** Curated offline acceptance fixture; provenance and limitations are documented under docs/audit/fixtures. */
export function fslyCompanyFacts(includeDirectRevenue = true): CompanyFacts {
  const usGaap: Taxonomies[string] = {
    GrossProfit: { units: { USD: FSLY_VALUES.map((row) => annual(row, row.grossProfit)) } },
    CostOfRevenue: { units: { USD: FSLY_VALUES.map((row) => annual(row, row.cost)) } },
    OperatingIncomeLoss: { units: { USD: FSLY_VALUES.map((row) => annual(row, row.operatingIncome)) } },
    NetIncomeLoss: { units: { USD: FSLY_VALUES.map((row) => annual(row, row.netIncome)) } },
    WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: FSLY_VALUES.map((row) => annual(row, row.shares)) } },
    EarningsPerShareDiluted: { units: { 'USD/shares': FSLY_VALUES.map((row) => annual(row, row.eps)) } },
    DepreciationDepletionAndAmortization: { units: { USD: [annual(FSLY_VALUES[4], 28_799_000)] } },
    PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: [28_694_000, 10_330_000, 10_976_000, 19_975_000, 34_816_000].map((value, index) => annual(FSLY_VALUES[index], value)) } },
    NetCashProvidedByUsedInOperatingActivities: { units: { USD: [94_444_000, 16_406_000, 362_000, -69_632_000, -38_482_000].map((value, index) => annual(FSLY_VALUES[index], value)) } },
    LongTermDebtCurrent: { units: { USD: [instant(FSLY_VALUES[0], 38_557_000)] } },
    LongTermDebtNoncurrent: { units: { USD: [instant(FSLY_VALUES[0], 323_282_000)] } },
    CashAndCashEquivalentsAtCarryingValue: { units: { USD: [instant(FSLY_VALUES[0], 180_563_000)] } },
    Assets: { units: { USD: [1_499_477_000, 1_451_359_000, 1_525_191_000, 1_896_113_000, 2_159_020_000].map((value, index) => instant(FSLY_VALUES[index], value)) } },
  };
  if (includeDirectRevenue) {
    usGaap.RevenueFromContractWithCustomerIncludingAssessedTax = {
      units: { USD: FSLY_VALUES.map((row) => annual(row, row.revenue)) },
    };
  }
  return { cik: 1517413, entityName: 'Fastly, Inc.', facts: { 'us-gaap': usGaap } };
}

export function aaplDirectRevenueFixture(): CompanyFacts {
  const rows = [
    { fy: 2025, start: '2024-09-29', end: '2025-09-27', revenue: 416_161_000_000, operatingIncome: 133_050_000_000, shares: 15_004_697_000, eps: 7.46, da: 11_698_000_000, capex: 12_715_000_000, currentDebt: 20_329_000_000, longDebt: 78_328_000_000, cash: 35_934_000_000, accn: '0000320193-25-000079', filed: '2025-10-31' },
    { fy: 2024, start: '2023-10-01', end: '2024-09-28', revenue: 391_035_000_000, operatingIncome: 123_216_000_000, shares: 15_408_095_000, eps: 6.08, da: 11_445_000_000, capex: 9_447_000_000, currentDebt: 20_879_000_000, longDebt: 85_750_000_000, cash: 29_943_000_000, accn: '0000320193-25-000079', filed: '2025-10-31' },
    { fy: 2023, start: '2022-09-25', end: '2023-09-30', revenue: 383_285_000_000, operatingIncome: 114_301_000_000, shares: 15_812_547_000, eps: 6.13, da: 11_519_000_000, capex: 10_959_000_000, currentDebt: 15_807_000_000, longDebt: 95_281_000_000, cash: 29_965_000_000, accn: '0000320193-25-000079', filed: '2025-10-31' },
    { fy: 2022, start: '2021-09-26', end: '2022-09-24', revenue: 394_328_000_000, operatingIncome: 119_437_000_000, shares: 16_325_819_000, eps: 6.11, da: 11_104_000_000, capex: 10_708_000_000, currentDebt: 21_110_000_000, longDebt: 98_959_000_000, cash: 23_646_000_000, accn: '0000320193-24-000123', filed: '2024-11-01' },
    { fy: 2021, start: '2020-09-27', end: '2021-09-25', revenue: 365_817_000_000, operatingIncome: 108_949_000_000, shares: 16_864_919_000, eps: 5.61, da: 11_284_000_000, capex: 11_085_000_000, currentDebt: 15_613_000_000, longDebt: 109_106_000_000, cash: 34_940_000_000, accn: '0000320193-23-000106', filed: '2023-11-03' },
  ];
  const flow = (row: (typeof rows)[number], value: number): SecFact => ({ start: row.start, end: row.end, val: value, accn: row.accn, fy: row.fy, fp: 'FY', form: '10-K', filed: row.filed });
  const balance = (row: (typeof rows)[number], value: number): SecFact => ({ end: row.end, val: value, accn: row.accn, fy: row.fy, fp: 'FY', form: '10-K', filed: row.filed });
  return {
    cik: 320193,
    entityName: 'Apple Inc.',
    facts: {
      'us-gaap': {
        RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: rows.map((row) => flow(row, row.revenue)) } },
        OperatingIncomeLoss: { units: { USD: rows.map((row) => flow(row, row.operatingIncome)) } },
        WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: rows.map((row) => flow(row, row.shares)) } },
        EarningsPerShareDiluted: { units: { 'USD/shares': rows.map((row) => flow(row, row.eps)) } },
        DepreciationDepletionAndAmortization: { units: { USD: rows.map((row) => flow(row, row.da)) } },
        PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: rows.map((row) => flow(row, row.capex)) } },
        LongTermDebtCurrent: { units: { USD: rows.map((row) => balance(row, row.currentDebt)) } },
        LongTermDebtNoncurrent: { units: { USD: rows.map((row) => balance(row, row.longDebt)) } },
        CashAndCashEquivalentsAtCarryingValue: { units: { USD: rows.map((row) => balance(row, row.cash)) } },
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
