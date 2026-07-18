// Purpose: Loads and calculates every holding, then produces portfolio-level historical and simulation results.

import { aggregateBacktestResults } from '@/domain/portfolio-aggregate';
import { createReport } from '@/services/create-report';
import type {
  BacktestInput,
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
  const holdings = await Promise.all(
    options.input.positions.map(async (position, index) => {
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
      return {
        position,
        report: await createReport({ input, demo: options.demo, demoSeed: index + 1 }),
      };
    }),
  );

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
