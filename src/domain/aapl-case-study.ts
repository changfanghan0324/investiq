// Purpose: Pure derivation layer for the frozen AAPL case-study evidence, scenarios,
// sensitivity, and source register. No I/O, clock, randomness, formatting, or UI prose.

import {
  AAPL_CASE_SOURCE,
  type AaplCaseMetricId,
  type AaplCaseSource,
  type AaplInstantFact,
  type AaplReportedSeries,
  type AaplScenarioId,
} from '@/data/aapl-case-study';
import { FUNDAMENTALS_DISCLAIMER, type SourceReceipt } from '@/domain/fundamentals';
import {
  buildScenarioRange,
  buildWaccTerminalGrowthSensitivity,
  type DcfAssumptions,
  type DcfValuation,
  type SensitivityTable,
} from '@/domain/valuation';

export interface AaplBalanceSheetBridge {
  periodEnd: string;
  commercialPaper: number;
  currentTermDebt: number;
  currentDebt: number;
  noncurrentDebt: number;
  cashAndEquivalents: number;
  dcfNetDebt: number;
  marketableSecuritiesCurrent: number;
  marketableSecuritiesNoncurrent: number;
  marketableSecurities: number;
  broaderLiquidityImpactPerShare: number;
  receipts: SourceReceipt[];
}

export interface AaplHistoricalObservations {
  revenueLatest: number;
  revenueCagr: number;
  medianAnnualRevenueGrowth: number;
  operatingMarginLatest: number;
  operatingMarginMedian: number;
  operatingMarginChange: number;
  freeCashFlowLatest: number;
  freeCashFlowCagr: number;
  dilutedEpsLatest: number;
  dilutedEpsCagr: number;
  daRevenueMedian: number;
  capexRevenueMedian: number;
  effectiveTaxLatest: number;
  effectiveTaxMedian: number;
}

export interface AaplScenarioView {
  id: AaplScenarioId;
  assumptions: DcfAssumptions;
  valuation: DcfValuation;
}

export interface AaplSensitivityView {
  table: SensitivityTable;
  minimum: number;
  maximum: number;
  increasesWithTerminalGrowth: boolean;
  decreasesWithWacc: boolean;
}

export interface AaplCaseStudyView {
  source: AaplCaseSource;
  fundamentalsDisclaimer: typeof FUNDAMENTALS_DISCLAIMER;
  historical: AaplHistoricalObservations;
  bridge: AaplBalanceSheetBridge;
  scenarios: AaplScenarioView[];
  sensitivity: AaplSensitivityView;
  sourceReceipts: SourceReceipt[];
}

export function buildAaplCaseStudy(source: AaplCaseSource = AAPL_CASE_SOURCE): AaplCaseStudyView {
  const revenue = caseSeries(source, 'revenue');
  const operatingIncome = caseSeries(source, 'operatingIncome');
  const operatingCashFlow = caseSeries(source, 'operatingCashFlow');
  const capex = caseSeries(source, 'capitalExpenditure');
  const da = caseSeries(source, 'depreciationAndAmortization');
  const dilutedEps = caseSeries(source, 'dilutedEps');
  const incomeTax = caseSeries(source, 'incomeTaxExpense');
  const pretaxIncome = caseSeries(source, 'pretaxIncome');
  const bridge = buildBalanceSheetBridge(source);

  const margins = alignedRatios(operatingIncome, revenue);
  const freeCashFlow = alignedDifferences(operatingCashFlow, capex);
  const daRevenue = alignedRatios(da, revenue);
  const capexRevenue = alignedRatios(capex, revenue);
  const effectiveTax = alignedRatios(incomeTax, pretaxIncome);
  const revenueValues = chronologicalValues(revenue);
  const epsValues = chronologicalValues(dilutedEps);
  const fcfValues = [...freeCashFlow].sort((a, b) => a.fiscalYear - b.fiscalYear).map((item) => item.value);
  const latestRevenue = latest(revenue);

  const historical: AaplHistoricalObservations = {
    revenueLatest: latestRevenue.value,
    revenueCagr: cagr(revenueValues),
    medianAnnualRevenueGrowth: median(annualGrowthRates(revenueValues)),
    operatingMarginLatest: latestValue(margins),
    operatingMarginMedian: median(margins.map((item) => item.value)),
    operatingMarginChange: latestValue(margins) - earliestValue(margins),
    freeCashFlowLatest: latestValue(freeCashFlow),
    freeCashFlowCagr: cagr(fcfValues),
    dilutedEpsLatest: latest(dilutedEps).value,
    dilutedEpsCagr: cagr(epsValues),
    daRevenueMedian: median(daRevenue.map((item) => item.value)),
    capexRevenueMedian: median(capexRevenue.map((item) => item.value)),
    effectiveTaxLatest: latestValue(effectiveTax),
    effectiveTaxMedian: median(effectiveTax.map((item) => item.value)),
  };

  const scenarios = source.scenarios.map((scenario) => {
    const assumptions: DcfAssumptions = {
      baseRevenue: latestRevenue.value,
      forecastYears: source.forecastYears,
      revenueGrowth: scenario.revenueGrowth,
      operatingMargin: scenario.operatingMargin,
      cashTaxRate: scenario.cashTaxRate,
      daPercentOfRevenue: scenario.daPercentOfRevenue,
      capexPercentOfRevenue: scenario.capexPercentOfRevenue,
      nwcPercentOfIncrementalRevenue: scenario.nwcPercentOfIncrementalRevenue,
      wacc: scenario.wacc,
      terminalGrowth: scenario.terminalGrowth,
      netDebt: bridge.dcfNetDebt,
      dilutedShares: source.dilutedWeightedAverageShares.value,
    };
    return { id: scenario.id, assumptions };
  });
  const scenarioRange = buildScenarioRange(scenarios);
  const scenarioViews = scenarioRange.scenarios.map((result) => ({
    id: result.id as AaplScenarioId,
    assumptions: result.valuation.assumptions,
    valuation: result.valuation,
  }));
  const base = scenarioViews.find((scenario) => scenario.id === 'base');
  if (!base) throw new Error('The AAPL case requires one base mid-assumption scenario.');

  const table = buildWaccTerminalGrowthSensitivity(
    base.assumptions,
    source.sensitivity.wacc,
    source.sensitivity.terminalGrowth,
  );
  const sensitivity = analyzeSensitivity(table);

  return {
    source,
    fundamentalsDisclaimer: FUNDAMENTALS_DISCLAIMER,
    historical,
    bridge,
    scenarios: scenarioViews,
    sensitivity,
    sourceReceipts: dedupeReceipts([
      ...source.reportedSeries.flatMap((series) => series.observations.map((item) => item.receipt)),
      ...source.balanceSheet.map((item) => item.receipt),
      source.dilutedWeightedAverageShares.receipt,
    ]),
  };
}

function buildBalanceSheetBridge(source: AaplCaseSource): AaplBalanceSheetBridge {
  const commercialPaper = instant(source, 'commercialPaper');
  const currentTermDebt = instant(source, 'currentTermDebt');
  const noncurrentTermDebt = instant(source, 'noncurrentTermDebt');
  const cash = instant(source, 'cashAndEquivalents');
  const marketableCurrent = instant(source, 'marketableSecuritiesCurrent');
  const marketableNoncurrent = instant(source, 'marketableSecuritiesNoncurrent');
  const aligned = [commercialPaper, currentTermDebt, noncurrentTermDebt, cash, marketableCurrent, marketableNoncurrent];
  if (!aligned.every((fact) => fact.periodEnd === source.snapshotDate)) {
    throw new Error('AAPL balance-sheet facts must align to the case snapshot date.');
  }
  const currentDebt = commercialPaper.value + currentTermDebt.value;
  const dcfNetDebt = currentDebt + noncurrentTermDebt.value - cash.value;
  const marketableSecurities = marketableCurrent.value + marketableNoncurrent.value;
  return {
    periodEnd: source.snapshotDate,
    commercialPaper: commercialPaper.value,
    currentTermDebt: currentTermDebt.value,
    currentDebt,
    noncurrentDebt: noncurrentTermDebt.value,
    cashAndEquivalents: cash.value,
    dcfNetDebt,
    marketableSecuritiesCurrent: marketableCurrent.value,
    marketableSecuritiesNoncurrent: marketableNoncurrent.value,
    marketableSecurities,
    broaderLiquidityImpactPerShare: marketableSecurities / source.dilutedWeightedAverageShares.value,
    receipts: [
      commercialPaper.receipt,
      currentTermDebt.receipt,
      noncurrentTermDebt.receipt,
      cash.receipt,
      marketableCurrent.receipt,
      marketableNoncurrent.receipt,
    ],
  };
}

function analyzeSensitivity(table: SensitivityTable): AaplSensitivityView {
  const values = table.cells.map((row) => row.map((cell) => {
    if (!cell.available) throw new Error(`AAPL case sensitivity cell is unavailable: ${cell.reason}`);
    return cell.impliedSharePrice;
  }));
  const flat = values.flat();
  const increasesWithTerminalGrowth = values.every((row) => isStrictlyIncreasing(row));
  const decreasesWithWacc = values[0].every((_, column) =>
    isStrictlyDecreasing(values.map((row) => row[column])),
  );
  if (!increasesWithTerminalGrowth || !decreasesWithWacc) {
    throw new Error('AAPL sensitivity interpretation is not monotonic for the configured positive-FCFF case.');
  }
  return {
    table,
    minimum: Math.min(...flat),
    maximum: Math.max(...flat),
    increasesWithTerminalGrowth,
    decreasesWithWacc,
  };
}

function caseSeries(source: AaplCaseSource, id: AaplCaseMetricId): AaplReportedSeries {
  const series = source.reportedSeries.find((item) => item.id === id);
  if (!series || series.observations.length < 2) throw new Error(`AAPL case series ${id} is incomplete.`);
  return series;
}

function instant(source: AaplCaseSource, id: AaplInstantFact['id']): AaplInstantFact {
  const fact = source.balanceSheet.find((item) => item.id === id);
  if (!fact) throw new Error(`AAPL case balance-sheet fact ${id} is missing.`);
  return fact;
}

function chronologicalValues(series: AaplReportedSeries): number[] {
  return [...series.observations].sort((a, b) => a.fiscalYear - b.fiscalYear).map((item) => item.value);
}

function annualGrowthRates(values: readonly number[]): number[] {
  return values.slice(1).map((value, index) => {
    const prior = values[index];
    if (!(prior > 0) || !(value > 0)) throw new Error('AAPL growth inputs must be positive.');
    return value / prior - 1;
  });
}

function cagr(values: readonly number[]): number {
  if (values.length < 2 || !(values[0] > 0) || !(values[values.length - 1] > 0)) {
    throw new Error('AAPL CAGR requires at least two positive observations.');
  }
  return Math.pow(values[values.length - 1] / values[0], 1 / (values.length - 1)) - 1;
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('AAPL median requires at least one observation.');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

interface DerivedObservation { fiscalYear: number; periodEnd: string; value: number }

function alignedRatios(numerator: AaplReportedSeries, denominator: AaplReportedSeries): DerivedObservation[] {
  return numerator.observations.map((item) => {
    const match = denominator.observations.find(
      (candidate) => candidate.fiscalYear === item.fiscalYear && candidate.periodEnd === item.periodEnd,
    );
    if (!match || !(match.value > 0)) throw new Error(`AAPL ratio ${numerator.id}/${denominator.id} is unaligned.`);
    return { fiscalYear: item.fiscalYear, periodEnd: item.periodEnd, value: item.value / match.value };
  });
}

function alignedDifferences(left: AaplReportedSeries, right: AaplReportedSeries): DerivedObservation[] {
  return left.observations.map((item) => {
    const match = right.observations.find(
      (candidate) => candidate.fiscalYear === item.fiscalYear && candidate.periodEnd === item.periodEnd,
    );
    if (!match) throw new Error(`AAPL difference ${left.id}-${right.id} is unaligned.`);
    return { fiscalYear: item.fiscalYear, periodEnd: item.periodEnd, value: item.value - match.value };
  });
}

function latest(series: AaplReportedSeries) {
  return [...series.observations].sort((a, b) => b.fiscalYear - a.fiscalYear)[0];
}

function latestValue(observations: readonly DerivedObservation[]): number {
  return [...observations].sort((a, b) => b.fiscalYear - a.fiscalYear)[0].value;
}

function earliestValue(observations: readonly DerivedObservation[]): number {
  return [...observations].sort((a, b) => a.fiscalYear - b.fiscalYear)[0].value;
}

function isStrictlyIncreasing(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || value > values[index - 1]);
}

function isStrictlyDecreasing(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || value < values[index - 1]);
}

function dedupeReceipts(receipts: readonly SourceReceipt[]): SourceReceipt[] {
  const seen = new Set<string>();
  return receipts.filter((receipt) => {
    const key = `${receipt.accn}|${receipt.concept}|${receipt.unit}|${receipt.start ?? ''}|${receipt.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
