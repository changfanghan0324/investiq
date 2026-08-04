// Purpose: Loads and calculates every holding, then produces portfolio-level historical and simulation results.

import { demoProvenance } from '@/data/demo-market-data';
import { assertValidDcaHoldingSet } from '@/domain/dca-limits';
import { aggregateBacktestResults, type PortfolioTaxContext } from '@/domain/portfolio-aggregate';
import { createReport } from '@/services/create-report';
import type {
  BacktestInput,
  DataProvenance,
  PortfolioHoldingReport,
  PortfolioInput,
  PortfolioProjectionScenario,
  PortfolioReport,
  ProjectionScenarioId,
} from '@/types/backtest';

const scenarioIds: ProjectionScenarioId[] = ['conservative', 'baseline', 'optimistic'];

export async function createPortfolioReport(options: {
  input: PortfolioInput;
  demo: boolean;
}): Promise<PortfolioReport> {
  assertValidDcaHoldingSet(options.input.positions);
  const holdings: PortfolioHoldingReport[] = [];

  // Live market-data plans are quota constrained. Loading sequentially lets a
  // portfolio use up to the documented limit without creating a request burst.
  for (const [index, position] of options.input.positions.entries()) {
    const input: BacktestInput = {
      ticker: position.ticker,
      investment: position.investment,
      startDate: options.input.startDate,
      endDate: options.input.endDate,
      taxMode: options.input.taxMode,
      dividendTaxRate: options.input.dividendTaxRate,
      liquidateAtEnd: options.input.liquidateAtEnd,
      capitalGainsTaxRate: options.input.capitalGainsTaxRate,
      fees: options.input.fees,
      // Defer holding-level capital-gain tax so gains and losses net once at the
      // portfolio level rather than each holding being taxed in isolation.
      deferCapitalGainsTax: true,
    };
    holdings.push({
      position,
      report: await createReport({ input, demo: options.demo, demoSeed: index + 1 }),
    });
  }

  // Historical and every future scenario aggregate with the identical netting rule.
  const taxContext: PortfolioTaxContext = {
    mode: options.input.taxMode,
    capitalGainsTaxRate: options.input.capitalGainsTaxRate,
  };
  const historical = aggregateBacktestResults(
    holdings.flatMap((holding) => (holding.report.historical ? [holding.report.historical] : [])),
    taxContext,
  );
  const projectionScenarios: PortfolioProjectionScenario[] = scenarioIds.flatMap((id) => {
    const results = holdings.flatMap((holding) => {
      const scenario = holding.report.projection?.scenarios.find((item) => item.id === id);
      return scenario ? [scenario.result] : [];
    });
    const result =
      results.length === holdings.length ? aggregateBacktestResults(results, taxContext) : undefined;
    return result ? [{ id, label: labelForScenario(id), result }] : [];
  });
  const projectionWarnings = holdings
    .map((holding) => holding.report.projection?.warning)
    .filter((warning): warning is string => Boolean(warning));

  return {
    input: options.input,
    holdings,
    historical,
    projection: projectionScenarios.length > 0
      ? { scenarios: projectionScenarios, warning: projectionWarnings[0] }
      : undefined,
    source: options.demo ? 'demo' : 'hybrid',
    provenance: options.demo ? demoProvenance() : aggregateProvenance(holdings),
  };
}

/**
 * Portfolio-level provenance is only as strong as its weakest holding: dividends
 * are cross-checked when every holding was, split coverage is cross-checked when
 * any holding actually reported a provider split, and the last completed session
 * / fetch time are the latest observed across holdings.
 */
function aggregateProvenance(holdings: PortfolioHoldingReport[]): DataProvenance {
  const items = holdings.map((holding) => holding.report.marketData.provenance);
  const lastCompletedSession = items
    .map((item) => item.lastCompletedSession)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const fetchedAt = items.map((item) => item.fetchedAt).sort().at(-1) ?? new Date().toISOString();
  return {
    priceProvider: 'yahoo',
    priceBasis: 'split-adjusted',
    lastCompletedSession,
    fetchedAt,
    dividendCoverage: items.every((item) => item.dividendCoverage === 'cross-checked')
      ? 'cross-checked'
      : 'not-requested',
    totalReturnCoverage: items.every((item) => item.totalReturnCoverage === 'yahoo-adjusted-close')
      ? 'yahoo-adjusted-close'
      : 'unavailable',
    splitCoverage: items.some((item) => item.splitCoverage === 'cross-checked')
      ? 'cross-checked'
      : 'none-reported',
    reorganizationCoverage: 'provider-reported-only',
    mode: 'dca',
  };
}

function labelForScenario(id: ProjectionScenarioId): string {
  if (id === 'conservative') return 'Conservative';
  if (id === 'optimistic') return 'Optimistic';
  return 'Baseline';
}
