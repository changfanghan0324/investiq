import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  loadAnalysisMarketData,
  readsPriceAnalysisReady,
  resetAnalysisCapabilityCache,
  stableDemoSeed,
  type AnalysisMarketDataDependencies,
} from '@/services/analysis-market-data';
import { MarketDataError } from '@/services/market-data-api';
import type { MarketData } from '@/types/backtest';

const options = {
  ticker: 'AAPL',
  from: '2021-01-04',
  to: '2021-12-31',
  requiredStart: '2021-01-04',
} as const;

afterEach(() => {
  resetAnalysisCapabilityCache();
  vi.unstubAllGlobals();
});

describe('analysis market-data resolution', () => {
  it('reads the actual priceAnalysis health contract and fails closed on malformed payloads', () => {
    expect(readsPriceAnalysisReady({ services: { priceAnalysis: 'ready' } })).toBe(true);
    expect(readsPriceAnalysisReady({ services: { priceAnalysis: 'unavailable' } })).toBe(false);
    expect(readsPriceAnalysisReady({ services: { marketData: 'ready' } })).toBe(false);
    expect(readsPriceAnalysisReady(undefined)).toBe(false);
  });

  it('uses live analysis only when the capability is ready', async () => {
    const live = { ticker: 'AAPL', source: 'yahoo' } as MarketData;
    const dependencies: AnalysisMarketDataDependencies = {
      liveCapability: vi.fn().mockResolvedValue(true),
      loadLive: vi.fn().mockResolvedValue(live),
      createDemo: vi.fn(),
    };

    await expect(loadAnalysisMarketData(options, dependencies)).resolves.toBe(live);
    expect(dependencies.loadLive).toHaveBeenCalledWith({ ...options, mode: 'analysis' });
    expect(dependencies.createDemo).not.toHaveBeenCalled();
  });

  it('uses an explicitly labelled, requested-window demo without calling live data', async () => {
    const demo = {
      ticker: 'AAPL',
      source: 'demo',
      prices: [
        { date: '2020-12-31' },
        { date: '2021-06-01' },
        { date: '2022-01-03' },
      ],
      dividends: [{ exDate: '2021-05-01' }],
      splits: [
        { executionDate: '2020-08-31' },
        { executionDate: '2021-08-30' },
      ],
    } as unknown as MarketData;
    const dependencies: AnalysisMarketDataDependencies = {
      liveCapability: vi.fn().mockResolvedValue(false),
      loadLive: vi.fn(),
      createDemo: vi.fn().mockReturnValue(demo),
    };

    const result = await loadAnalysisMarketData(options, dependencies);

    expect(result.source).toBe('demo');
    expect(result.prices.map((bar) => bar.date)).toEqual(['2021-06-01']);
    expect(result.dividends).toEqual([]);
    expect(result.splits.map((event) => event.executionDate)).toEqual(['2021-08-30']);
    expect(dependencies.loadLive).not.toHaveBeenCalled();
  });

  it('falls back to labelled demo data when a previously-ready live provider fails transiently', async () => {
    const demo = {
      ticker: 'AAPL',
      source: 'demo',
      prices: [{ date: '2021-06-01' }],
      dividends: [],
      splits: [],
    } as unknown as MarketData;
    const dependencies: AnalysisMarketDataDependencies = {
      liveCapability: vi.fn().mockResolvedValue(true),
      loadLive: vi.fn().mockRejectedValue(new MarketDataError('busy', 429)),
      createDemo: vi.fn().mockReturnValue(demo),
    };

    await expect(loadAnalysisMarketData(options, dependencies)).resolves.toMatchObject({ source: 'demo' });
    expect(dependencies.createDemo).toHaveBeenCalledOnce();
  });

  it.each([400, 404, 422])('does not disguise a confirmed input error (%s) as demo data', async (status) => {
    const error = new MarketDataError('invalid request', status);
    const dependencies: AnalysisMarketDataDependencies = {
      liveCapability: vi.fn().mockResolvedValue(true),
      loadLive: vi.fn().mockRejectedValue(error),
      createDemo: vi.fn(),
    };

    await expect(loadAnalysisMarketData(options, dependencies)).rejects.toBe(error);
    expect(dependencies.createDemo).not.toHaveBeenCalled();
  });

  it('fails to demo through the default path when the health request is unreachable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network unavailable'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadAnalysisMarketData(options);

    expect(result.source).toBe('demo');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/health', { cache: 'no-store' });
  });

  it('derives a stable bounded seed from the ticker', () => {
    expect(stableDemoSeed('aapl')).toBe(stableDemoSeed(' AAPL '));
    expect(stableDemoSeed('AAPL')).toBeGreaterThanOrEqual(1);
    expect(stableDemoSeed('AAPL')).toBeLessThanOrEqual(23);
    expect(stableDemoSeed('AAPL')).not.toBe(stableDemoSeed('MSFT'));
  });
});
