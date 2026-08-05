// Purpose: Language-neutral, immutable source inputs for the recruiter-facing AAPL case.
// Human-readable prose lives in the EN/ZH catalogs; calculations live in the pure case builder.

import type { SourceReceipt } from '@/domain/fundamentals';
import type { TranslationKey } from '@/i18n/language';

export type AaplCaseMetricId =
  | 'revenue'
  | 'operatingIncome'
  | 'netIncome'
  | 'dilutedEps'
  | 'operatingCashFlow'
  | 'capitalExpenditure'
  | 'depreciationAndAmortization'
  | 'incomeTaxExpense'
  | 'pretaxIncome';

export interface AaplReportedObservation {
  fiscalYear: number;
  periodEnd: string;
  value: number;
  receipt: SourceReceipt;
}

export interface AaplReportedSeries {
  id: AaplCaseMetricId;
  unit: 'USD' | 'USD/shares';
  observations: readonly AaplReportedObservation[];
}

export interface AaplInstantFact {
  id:
    | 'commercialPaper'
    | 'currentTermDebt'
    | 'noncurrentTermDebt'
    | 'cashAndEquivalents'
    | 'marketableSecuritiesCurrent'
    | 'marketableSecuritiesNoncurrent'
    | 'sharesOutstanding';
  value: number;
  periodEnd: string;
  receipt: SourceReceipt;
}

export type AaplScenarioId = 'bear' | 'base' | 'bull';

export interface AaplScenarioInputs {
  id: AaplScenarioId;
  revenueGrowth: number;
  operatingMargin: number;
  cashTaxRate: number;
  daPercentOfRevenue: number;
  capexPercentOfRevenue: number;
  nwcPercentOfIncrementalRevenue: number;
  wacc: number;
  terminalGrowth: number;
}

export interface AaplNarrativeCitation {
  id: 'fy2025-10k' | 'fy2026-q3-release';
  documentType: '10-K' | 'company-press-release';
  publishedOrFiled: string;
  periodEnd: string;
  sectionKey: TranslationKey;
  url: string;
  transcription: 'manual';
}

export interface AaplNarrativeItem {
  id: string;
  titleKey: TranslationKey;
  textKey: TranslationKey;
  monitorKey: TranslationKey;
  citationId: AaplNarrativeCitation['id'];
}

export interface AaplCaseSource {
  version: 1;
  ticker: 'AAPL';
  companyName: 'Apple Inc.';
  snapshotDate: string;
  caseAsOf: string;
  fiscalYear: 2025;
  filingAccession: '0000320193-25-000079';
  reportedSeries: readonly AaplReportedSeries[];
  balanceSheet: readonly AaplInstantFact[];
  dilutedWeightedAverageShares: AaplReportedObservation;
  forecastYears: 5;
  scenarios: readonly AaplScenarioInputs[];
  sensitivity: {
    wacc: readonly number[];
    terminalGrowth: readonly number[];
  };
  citations: readonly AaplNarrativeCitation[];
  catalysts: readonly AaplNarrativeItem[];
  risks: readonly AaplNarrativeItem[];
  thesisKeys: readonly TranslationKey[];
  invalidationKeys: readonly TranslationKey[];
  unresolvedKeys: readonly TranslationKey[];
}

interface FilingMeta {
  accession: string;
  filed: string;
  filingFiscalYear: number;
  start: string;
  end: string;
}

const annualMeta: Record<number, FilingMeta> = {
  2021: {
    accession: '0000320193-23-000106', filed: '2023-11-03', filingFiscalYear: 2023,
    start: '2020-09-27', end: '2021-09-25',
  },
  2022: {
    accession: '0000320193-24-000123', filed: '2024-11-01', filingFiscalYear: 2024,
    start: '2021-09-26', end: '2022-09-24',
  },
  2023: {
    accession: '0000320193-25-000079', filed: '2025-10-31', filingFiscalYear: 2025,
    start: '2022-09-25', end: '2023-09-30',
  },
  2024: {
    accession: '0000320193-25-000079', filed: '2025-10-31', filingFiscalYear: 2025,
    start: '2023-10-01', end: '2024-09-28',
  },
  2025: {
    accession: '0000320193-25-000079', filed: '2025-10-31', filingFiscalYear: 2025,
    start: '2024-09-29', end: '2025-09-27',
  },
};

function filingUrl(accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/320193/${accession.replaceAll('-', '')}/${accession}-index.htm`;
}

function annualObservation(
  concept: string,
  unit: 'USD' | 'USD/shares' | 'shares',
  fiscalYear: number,
  value: number,
): AaplReportedObservation {
  const meta = annualMeta[fiscalYear];
  return {
    fiscalYear,
    periodEnd: meta.end,
    value,
    receipt: {
      taxonomy: 'us-gaap', concept, unit, accn: meta.accession, form: '10-K', fp: 'FY',
      fy: meta.filingFiscalYear, filed: meta.filed, start: meta.start, end: meta.end,
      sourceUrl: filingUrl(meta.accession),
    },
  };
}

function annualSeries(
  id: AaplCaseMetricId,
  concept: string,
  unit: AaplReportedSeries['unit'],
  values: readonly [number, number][],
): AaplReportedSeries {
  return {
    id,
    unit,
    observations: values.map(([fiscalYear, value]) => annualObservation(concept, unit, fiscalYear, value)),
  };
}

function instantFact(
  id: AaplInstantFact['id'],
  concept: string,
  value: number,
  periodEnd = '2025-09-27',
  taxonomy = 'us-gaap',
): AaplInstantFact {
  return {
    id,
    value,
    periodEnd,
    receipt: {
      taxonomy, concept, unit: id === 'sharesOutstanding' ? 'shares' : 'USD',
      accn: '0000320193-25-000079', form: '10-K', fp: 'FY', fy: 2025,
      filed: '2025-10-31', end: periodEnd,
      sourceUrl: filingUrl('0000320193-25-000079'),
    },
  };
}

export const AAPL_CASE_SOURCE: AaplCaseSource = {
  version: 1,
  ticker: 'AAPL',
  companyName: 'Apple Inc.',
  snapshotDate: '2025-09-27',
  caseAsOf: '2026-08-04',
  fiscalYear: 2025,
  filingAccession: '0000320193-25-000079',
  reportedSeries: [
    annualSeries('revenue', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'USD', [
      [2021, 365_817_000_000], [2022, 394_328_000_000], [2023, 383_285_000_000],
      [2024, 391_035_000_000], [2025, 416_161_000_000],
    ]),
    annualSeries('operatingIncome', 'OperatingIncomeLoss', 'USD', [
      [2021, 108_949_000_000], [2022, 119_437_000_000], [2023, 114_301_000_000],
      [2024, 123_216_000_000], [2025, 133_050_000_000],
    ]),
    annualSeries('netIncome', 'NetIncomeLoss', 'USD', [
      [2021, 94_680_000_000], [2022, 99_803_000_000], [2023, 96_995_000_000],
      [2024, 93_736_000_000], [2025, 112_010_000_000],
    ]),
    annualSeries('dilutedEps', 'EarningsPerShareDiluted', 'USD/shares', [
      [2021, 5.61], [2022, 6.11], [2023, 6.13], [2024, 6.08], [2025, 7.46],
    ]),
    annualSeries('operatingCashFlow', 'NetCashProvidedByUsedInOperatingActivities', 'USD', [
      [2021, 104_038_000_000], [2022, 122_151_000_000], [2023, 110_543_000_000],
      [2024, 118_254_000_000], [2025, 111_482_000_000],
    ]),
    annualSeries('capitalExpenditure', 'PaymentsToAcquirePropertyPlantAndEquipment', 'USD', [
      [2021, 11_085_000_000], [2022, 10_708_000_000], [2023, 10_959_000_000],
      [2024, 9_447_000_000], [2025, 12_715_000_000],
    ]),
    annualSeries('depreciationAndAmortization', 'DepreciationDepletionAndAmortization', 'USD', [
      [2021, 11_284_000_000], [2022, 11_104_000_000], [2023, 11_519_000_000],
      [2024, 11_445_000_000], [2025, 11_698_000_000],
    ]),
    annualSeries('incomeTaxExpense', 'IncomeTaxExpenseBenefit', 'USD', [
      [2021, 14_527_000_000], [2022, 19_300_000_000], [2023, 16_741_000_000],
      [2024, 29_749_000_000], [2025, 20_719_000_000],
    ]),
    annualSeries('pretaxIncome', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'USD', [
      [2021, 109_207_000_000], [2022, 119_103_000_000], [2023, 113_736_000_000],
      [2024, 123_485_000_000], [2025, 132_729_000_000],
    ]),
  ],
  balanceSheet: [
    instantFact('commercialPaper', 'CommercialPaper', 7_979_000_000),
    instantFact('currentTermDebt', 'LongTermDebtCurrent', 12_350_000_000),
    instantFact('noncurrentTermDebt', 'LongTermDebtNoncurrent', 78_328_000_000),
    instantFact('cashAndEquivalents', 'CashAndCashEquivalentsAtCarryingValue', 35_934_000_000),
    instantFact('marketableSecuritiesCurrent', 'MarketableSecuritiesCurrent', 18_763_000_000),
    instantFact('marketableSecuritiesNoncurrent', 'MarketableSecuritiesNoncurrent', 77_723_000_000),
    instantFact('sharesOutstanding', 'EntityCommonStockSharesOutstanding', 14_776_353_000, '2025-10-17', 'dei'),
  ],
  dilutedWeightedAverageShares: annualObservation(
    'WeightedAverageNumberOfDilutedSharesOutstanding', 'shares', 2025, 15_004_697_000,
  ),
  forecastYears: 5,
  scenarios: [
    {
      id: 'bear', revenueGrowth: 0.01, operatingMargin: 0.285, cashTaxRate: 0.20,
      daPercentOfRevenue: 0.029, capexPercentOfRevenue: 0.033,
      nwcPercentOfIncrementalRevenue: 0.05, wacc: 0.10, terminalGrowth: 0.02,
    },
    {
      id: 'base', revenueGrowth: 0.04, operatingMargin: 0.303, cashTaxRate: 0.18,
      daPercentOfRevenue: 0.029, capexPercentOfRevenue: 0.029,
      nwcPercentOfIncrementalRevenue: 0.03, wacc: 0.09, terminalGrowth: 0.025,
    },
    {
      id: 'bull', revenueGrowth: 0.065, operatingMargin: 0.32, cashTaxRate: 0.16,
      daPercentOfRevenue: 0.029, capexPercentOfRevenue: 0.031,
      nwcPercentOfIncrementalRevenue: 0.02, wacc: 0.08, terminalGrowth: 0.03,
    },
  ],
  sensitivity: {
    wacc: [0.08, 0.085, 0.09, 0.095, 0.10],
    terminalGrowth: [0.015, 0.02, 0.025, 0.03, 0.035],
  },
  citations: [
    {
      id: 'fy2025-10k', documentType: '10-K', publishedOrFiled: '2025-10-31',
      periodEnd: '2025-09-27', sectionKey: 'caseStudy.source10kSection',
      url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm',
      transcription: 'manual',
    },
    {
      id: 'fy2026-q3-release', documentType: 'company-press-release', publishedOrFiled: '2026-07-30',
      periodEnd: '2026-06-27', sectionKey: 'caseStudy.sourceQ3Section',
      url: 'https://www.apple.com/newsroom/2026/07/apple-reports-third-quarter-results/',
      transcription: 'manual',
    },
  ],
  catalysts: [
    {
      id: 'services-and-product-demand', titleKey: 'caseStudy.catalystDemandTitle',
      textKey: 'caseStudy.catalystDemandText', monitorKey: 'caseStudy.catalystDemandMonitor',
      citationId: 'fy2026-q3-release',
    },
    {
      id: 'installed-base', titleKey: 'caseStudy.catalystBaseTitle',
      textKey: 'caseStudy.catalystBaseText', monitorKey: 'caseStudy.catalystBaseMonitor',
      citationId: 'fy2026-q3-release',
    },
  ],
  risks: [
    {
      id: 'competition-and-transitions', titleKey: 'caseStudy.riskCompetitionTitle',
      textKey: 'caseStudy.riskCompetitionText', monitorKey: 'caseStudy.riskCompetitionMonitor',
      citationId: 'fy2025-10k',
    },
    {
      id: 'supply-chain-and-trade', titleKey: 'caseStudy.riskSupplyTitle',
      textKey: 'caseStudy.riskSupplyText', monitorKey: 'caseStudy.riskSupplyMonitor',
      citationId: 'fy2025-10k',
    },
    {
      id: 'regulation-and-margin', titleKey: 'caseStudy.riskRegulationTitle',
      textKey: 'caseStudy.riskRegulationText', monitorKey: 'caseStudy.riskRegulationMonitor',
      citationId: 'fy2025-10k',
    },
  ],
  thesisKeys: ['caseStudy.thesis1', 'caseStudy.thesis2', 'caseStudy.thesis3'],
  invalidationKeys: ['caseStudy.invalidation1', 'caseStudy.invalidation2', 'caseStudy.invalidation3'],
  unresolvedKeys: ['caseStudy.unresolved1', 'caseStudy.unresolved2', 'caseStudy.unresolved3'],
};
