import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  loadAnalysisMarketData,
  resolveAnalysisDataMode,
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

  it('honors a run-pinned mode without re-resolving capability', async () => {
    const demo = {
      ticker: 'AAPL', source: 'demo', prices: [], dividends: [], splits: [],
    } as unknown as MarketData;
    const dependencies: AnalysisMarketDataDependencies = {
      liveCapability: vi.fn().mockResolvedValue(true),
      loadLive: vi.fn(),
      createDemo: vi.fn().mockReturnValue(demo),
    };

    await expect(loadAnalysisMarketData({ ...options, mode: 'synthetic-demo' }, dependencies))
      .resolves.toMatchObject({ source: 'demo' });
    expect(dependencies.liveCapability).not.toHaveBeenCalled();
    expect(dependencies.loadLive).not.toHaveBeenCalled();
  });

  it('resolves one explicit mode value for a multi-security run', async () => {
    await expect(resolveAnalysisDataMode(vi.fn().mockResolvedValue(true))).resolves.toBe('licensed-live');
    await expect(resolveAnalysisDataMode(vi.fn().mockResolvedValue(false))).resolves.toBe('synthetic-demo');
  });

  it('keeps a failed security unavailable instead of mixing live and synthetic series', async () => {
    const error = new MarketDataError('busy', 429);
    const dependencies: AnalysisMarketDataDependencies = {
      liveCapability: vi.fn().mockResolvedValue(true),
      loadLive: vi.fn().mockRejectedValue(error),
      createDemo: vi.fn(),
    };

    await expect(loadAnalysisMarketData(options, dependencies)).rejects.toBe(error);
    expect(dependencies.createDemo).not.toHaveBeenCalled();
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
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadAnalysisMarketData(options);

    expect(result.source).toBe('demo');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.objectContaining({
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    }));
  });

  it('falls back to demo when health returns a malformed successful response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html>proxy error</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadAnalysisMarketData(options)).resolves.toMatchObject({ source: 'demo' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('derives a stable bounded seed from the ticker', () => {
    expect(stableDemoSeed('aapl')).toBe(stableDemoSeed(' AAPL '));
    expect(stableDemoSeed('AAPL')).toBeGreaterThanOrEqual(1);
    expect(stableDemoSeed('AAPL')).toBeLessThanOrEqual(23);
    expect(stableDemoSeed('AAPL')).not.toBe(stableDemoSeed('MSFT'));
  });
});
