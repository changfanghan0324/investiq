// Purpose: Loads and calculates every holding, then produces portfolio-level historical and simulation results.

import { aggregateBacktestResults } from '@/domain/portfolio-aggregate';
import { createReport } from '@/services/create-report';
import type {
  BacktestInput,
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
  const holdings: PortfolioHoldingReport[] = [];

  // Live market-data plans are quota constrained. Loading sequentially lets a
  // portfolio contain any number of holdings without creating a request burst.
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
    };
    holdings.push({
      position,
      report: await createReport({ input, demo: options.demo, demoSeed: index + 1 }),
    });
  }

  const historical = aggregateBacktestResults(
    holdings.flatMap((holding) => (holding.report.historical ? [holding.report.historical] : [])),
  );
  const projectionScenarios: PortfolioProjectionScenario[] = scenarioIds.flatMap((id) => {
    const results = holdings.flatMap((holding) => {
      const scenario = holding.report.projection?.scenarios.find((item) => item.id === id);
      return scenario ? [scenario.result] : [];
    });
    const result = results.length === holdings.length ? aggregateBacktestResults(results) : undefined;
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
  };
}

function labelForScenario(id: ProjectionScenarioId): string {
  if (id === 'conservative') return 'Conservative';
  if (id === 'optimistic') return 'Optimistic';
  return 'Baseline';
}
