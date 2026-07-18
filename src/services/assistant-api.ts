// Purpose: Sends a compact report summary to the same-origin AI route without exposing model credentials.

import type {
  BacktestResult,
  PortfolioAggregateResult,
  PortfolioReport,
  ProjectionScenarioId,
} from '@/types/backtest';

export interface AssistantMessage {
  role: 'user' | 'assistant';
  text: string;
}

export class AssistantApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantApiError';
  }
}

export async function askPortfolioAssistant(options: {
  report: PortfolioReport;
  scenario: ProjectionScenarioId | 'historical';
  question: string;
  history: AssistantMessage[];
}): Promise<string> {
  const summary = buildAssistantSummary(options.report, options.scenario);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);

  try {
    const response = await fetch('/api/assistant', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question: options.question.trim(),
        history: options.history.slice(-6),
        report: summary,
      }),
    });
    const payload: unknown = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = getApiMessage(payload);
      if (response.status === 429) {
        throw new AssistantApiError('The AI assistant is busy. Please wait briefly and try again.');
      }
      if (response.status === 400 || response.status === 422) {
        throw new AssistantApiError(message ?? 'Please shorten or rephrase the question.');
      }
      throw new AssistantApiError(message ?? 'The AI assistant is temporarily unavailable. Please try again later.');
    }

    const answer = getApiAnswer(payload);
    if (!answer) throw new AssistantApiError('The AI assistant returned an empty response. Please try again.');
    return answer;
  } catch (error) {
    if (error instanceof AssistantApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AssistantApiError('The AI assistant took too long to respond. Please try again.');
    }
    throw new AssistantApiError('Unable to connect to the AI assistant. Check your connection and try again.');
  } finally {
    clearTimeout(timeout);
  }
}

export function buildAssistantSummary(
  report: PortfolioReport,
  scenario: ProjectionScenarioId | 'historical',
) {
  const aggregate = scenario === 'historical'
    ? report.historical
    : report.projection?.scenarios.find((item) => item.id === scenario)?.result;
  if (!aggregate) throw new Error('The selected report scenario is unavailable.');

  const holdings = report.holdings.flatMap((holding) => {
    const result = scenario === 'historical'
      ? holding.report.historical
      : holding.report.projection?.scenarios.find((item) => item.id === scenario)?.result;
    return result ? [holdingSummary(holding.position.ticker, result)] : [];
  });

  return {
    mode: scenario === 'historical' ? 'historical backtest' : `${scenario} simulated estimate`,
    period: { start: aggregate.startDate, end: aggregate.endDate },
    portfolio: aggregateSummary(aggregate),
    holdings,
    assumptions: {
      reportingBasis: report.input.taxMode,
      dividendWithholdingRate: report.input.dividendTaxRate,
      liquidateAtEnd: report.input.liquidateAtEnd,
      capitalGainsTaxRate: report.input.capitalGainsTaxRate,
      broker: report.input.fees.brokerName,
      purchasePriceRule: 'split-adjusted daily high',
      fractionalSharePrecision: 3,
    },
    dataSource: report.source,
  };
}

function aggregateSummary(result: PortfolioAggregateResult) {
  return {
    holdingsCount: result.holdingsCount,
    endingValue: result.finalAmount,
    contributions: result.totalContributions,
    totalProfit: result.totalProfit,
    totalReturnPercent: result.totalReturnPercent,
    priceReturn: result.priceReturn,
    grossDividends: result.grossDividends,
    dividendTax: result.dividendTax,
    capitalGainsTax: result.capitalGainsTax,
    fees: result.totalFees,
    maxDrawdownPercent: result.maxDrawdown.percent,
    maxDrawdownPeakDate: result.maxDrawdown.peakDate,
    maxDrawdownTroughDate: result.maxDrawdown.troughDate,
    durationDays: result.durationDays,
  };
}

function holdingSummary(ticker: string, result: BacktestResult) {
  return {
    ticker,
    companyName: result.companyName,
    endingValue: result.finalAmount,
    contributions: result.totalContributions,
    totalProfit: result.totalProfit,
    totalReturnPercent: result.totalReturnPercent,
    finalShares: result.finalShares,
    priceReturn: result.priceReturn,
    grossDividends: result.grossDividends,
  };
}

function getApiMessage(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const message = (value as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message.trim() : undefined;
}

function getApiAnswer(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const answer = (value as { answer?: unknown }).answer;
  return typeof answer === 'string' && answer.trim() ? answer.trim() : undefined;
}
