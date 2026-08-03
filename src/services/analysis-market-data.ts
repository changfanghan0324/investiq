// Purpose: Resolves price-analysis workspaces to licensed live data or an
// explicitly synthetic browser demo without weakening the server-side license gate.

import { createDemoMarketData } from '@/data/demo-market-data';
import { loadMarketData, MarketDataError } from '@/services/market-data-api';
import type { DateString, MarketData } from '@/types/backtest';

const CAPABILITY_TTL_MS = 60_000;

export interface AnalysisMarketDataOptions {
  ticker: string;
  from: DateString;
  to: DateString;
  requiredStart: DateString;
}

export interface AnalysisMarketDataDependencies {
  liveCapability: () => Promise<boolean>;
  loadLive: typeof loadMarketData;
  createDemo: typeof createDemoMarketData;
}

let capabilityCache: { expiresAt: number; live: boolean } | undefined;
let capabilityInFlight: Promise<boolean> | undefined;

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
  if (await dependencies.liveCapability()) {
    try {
      return await dependencies.loadLive({ ...options, mode: 'analysis' });
    } catch (error) {
      // Invalid input and a confirmed missing instrument remain user-visible.
      // Transient provider, quota, timeout, or network failures fall through to
      // the same explicitly-labelled demo used when live capability is disabled.
      if (error instanceof MarketDataError && [400, 404, 422].includes(error.status ?? 0)) {
        throw error;
      }
    }
  }

  return createRequestedWindowDemo(options, dependencies.createDemo);
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
  const now = Date.now();
  if (capabilityCache && capabilityCache.expiresAt > now) return capabilityCache.live;
  if (capabilityInFlight) return capabilityInFlight;

  capabilityInFlight = fetch('/api/health', { cache: 'no-store' })
    .then(async (response) => {
      const payload: unknown = await response.json().catch(() => undefined);
      return readsPriceAnalysisReady(payload);
    })
    .catch(() => false)
    .then((live) => {
      capabilityCache = { live, expiresAt: Date.now() + CAPABILITY_TTL_MS };
      return live;
    })
    .finally(() => {
      capabilityInFlight = undefined;
    });

  return capabilityInFlight;
}

export function readsPriceAnalysisReady(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const services = (payload as { services?: unknown }).services;
  if (!services || typeof services !== 'object') return false;
  return (services as { priceAnalysis?: unknown }).priceAnalysis === 'ready';
}

/** Test-only cache reset; production callers never need to mutate capability state. */
export function resetAnalysisCapabilityCache(): void {
  capabilityCache = undefined;
  capabilityInFlight = undefined;
}
