// Purpose: Resolves price-analysis workspaces to licensed live data or an
// explicitly synthetic browser demo without weakening the server-side license gate.

import { createDemoMarketData } from '@/data/demo-market-data';
import { loadServiceReadiness, resetReadinessCache } from '@/services/readiness-loader';
import { loadMarketData } from '@/services/market-data-api';
import type { DateString, MarketData } from '@/types/backtest';

export interface AnalysisMarketDataOptions {
  ticker: string;
  from: DateString;
  to: DateString;
  requiredStart: DateString;
  /** Pins every leg of a multi-security run to one evidence mode. */
  mode?: AnalysisDataMode;
}

export type AnalysisDataMode = 'licensed-live' | 'synthetic-demo';

export interface AnalysisMarketDataDependencies {
  liveCapability: () => Promise<boolean>;
  loadLive: typeof loadMarketData;
  createDemo: typeof createDemoMarketData;
}

const defaultDependencies: AnalysisMarketDataDependencies = {
  liveCapability: getLiveAnalysisCapability,
  loadLive: loadMarketData,
  createDemo: createDemoMarketData,
};

/**
 * Loads licensed live analysis data when production says it is ready. Otherwise
 * it returns a clearly-labelled synthetic series and never calls /api/market-data.
 */
export async function loadAnalysisMarketData(
  options: AnalysisMarketDataOptions,
  dependencies: AnalysisMarketDataDependencies = defaultDependencies,
): Promise<MarketData> {
  const mode = options.mode ?? await resolveAnalysisDataMode(dependencies.liveCapability);
  if (mode === 'licensed-live') {
    // Once a workspace is in licensed-live mode, a failed security stays unavailable.
    // Never mix a live series with a synthetic fallback in cross-security analytics.
    return dependencies.loadLive({ ...options, mode: 'analysis' });
  }

  return createRequestedWindowDemo(options, dependencies.createDemo);
}

/** Resolves capability once so a run and all of its retries cannot mix evidence modes. */
export async function resolveAnalysisDataMode(
  liveCapability: () => Promise<boolean> = getLiveAnalysisCapability,
): Promise<AnalysisDataMode> {
  return await liveCapability() ? 'licensed-live' : 'synthetic-demo';
}

function createRequestedWindowDemo(
  options: AnalysisMarketDataOptions,
  createDemo: typeof createDemoMarketData,
): MarketData {
  const demo = createDemo(options.ticker, stableDemoSeed(options.ticker));
  return {
    ...demo,
    prices: demo.prices.filter((bar) => bar.date >= options.from && bar.date <= options.to),
    dividends: [],
    splits: demo.splits.filter((event) => event.executionDate >= options.from && event.executionDate <= options.to),
  };
}

/** A stable small seed keeps symbols visually distinct while remaining reproducible. */
export function stableDemoSeed(ticker: string): number {
  const normalized = ticker.trim().toUpperCase();
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }
  return (hash % 23) + 1;
}

/**
 * A failed or malformed health request resolves to demo. Uncertainty must never
 * cause a public browser to attempt live data that production has not enabled.
 */
async function getLiveAnalysisCapability(): Promise<boolean> {
  const readiness = await loadServiceReadiness();
  return readiness.priceAnalysis === 'ready';
}

/** Test-only cache reset; production callers never need to mutate capability state. */
export function resetAnalysisCapabilityCache(): void {
  resetReadinessCache();
}
