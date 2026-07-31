// Purpose: Sends a compact report summary to the same-origin AI route without exposing model credentials.

import type {
  BacktestResult,
  MoneyWeightedReturn,
  PortfolioAggregateResult,
  PortfolioReport,
  ProjectionScenarioId,
  TimeWeightedReturn,
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
      brokerFeeModel:
        report.input.fees.kind === 'custom'
          ? 'custom user-entered fees; no hidden regulatory charges'
          : 'dated, source-backed fee scenario applying the current schedule to every modeled order (not reconstructed history); one order treated as one execution',
      brokerFeeEffectiveDate: report.input.fees.effectiveDate,
      brokerFeeCheckedDate: report.input.fees.checkedDate,
      purchasePriceRule: 'split-adjusted daily high',
      dividendReinvestmentRule: 'payment-date reinvestment at that day\'s split-adjusted high',
      fractionalSharePrecision: 3,
    },
    dataSource: report.source,
    dataQuality: {
      priceProvider: report.provenance.priceProvider,
      priceBasis: 'split-adjusted OHLC; dividends excluded from prices',
      lastCompletedSession: report.provenance.lastCompletedSession,
      fetchedAt: report.provenance.fetchedAt,
      dividendCoverage: report.provenance.dividendCoverage,
      splitCoverage: report.provenance.splitCoverage,
      reorganizationCoverage: report.provenance.reorganizationCoverage,
      limitation:
        'An action absent from both data providers cannot be detected; not official, real-time, or licensed institutional data.',
    },
  };
}

function twrPayload(twr: TimeWeightedReturn) {
  return {
    cumulativePercent: twr.cumulative * 100,
    annualizedPercent: twr.annualizationEligible && twr.annualized !== undefined ? twr.annualized * 100 : null,
    annualizationEligible: twr.annualizationEligible,
    durationDays: twr.durationDays,
    note: 'Cash-flow-neutral time-weighted return; dividends, dividend tax, and fees are inside it. Annualized only after one calendar year.',
  };
}

function mwrrPayload(mwrr: MoneyWeightedReturn) {
  return {
    status: mwrr.status,
    annualizedPercent:
      mwrr.status === 'available' && mwrr.annualizedRate !== undefined ? mwrr.annualizedRate * 100 : null,
    note: 'Investor-experience money-weighted return (annualized XIRR) from dated contributions and the after-fee/after-tax terminal value.',
  };
}

function aggregateSummary(result: PortfolioAggregateResult) {
  return {
    holdingsCount: result.holdingsCount,
    endingValue: result.finalAmount,
    contributions: result.totalContributions,
    totalProfit: result.totalProfit,
    netGainOnContributionsPercent: result.netGainRatioPercent,
    netGainOnContributionsNote:
      'A simple dollar-efficiency ratio (net gain ÷ contributions), not a performance return and not annualized. Use TWR and MWRR for performance.',
    timeWeightedReturn: twrPayload(result.twr),
    moneyWeightedReturn: mwrrPayload(result.mwrr),
    priceReturn: result.priceReturn,
    grossDividends: result.grossDividends,
    dividendTax: result.dividendTax,
    capitalGainsTax: result.capitalGainsTax,
    capitalGainsTaxNote:
      'Capital-gain tax nets gains and losses across holdings (IRS Topic 409) and is applied once at the portfolio level; per-holding figures defer it.',
    acquisitionFees: result.acquisitionFees,
    liquidationEstimate: result.liquidation
      ? {
          adjustedTaxBasis: result.liquidation.adjustedTaxBasis,
          netAmountRealized: result.liquidation.netAmountRealized,
          realizedGainLoss: result.liquidation.realizedGainLoss,
          taxableGain: result.liquidation.taxableGain,
          note: 'Simplified flat-rate estimate; portfolio gains and losses are netted before the single tax. Not lot-level tax accounting.',
        }
      : undefined,
    fees: result.totalFees,
    feeComponents: result.feeComponents,
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
    netGainOnContributionsPercent: result.netGainRatioPercent,
    timeWeightedReturn: twrPayload(result.twr),
    moneyWeightedReturn: mwrrPayload(result.mwrr),
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
