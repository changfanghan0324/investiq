import { beforeEach, describe, expect, it, vi } from 'vitest';

const stubs = vi.hoisted(() => ({
  checkDatabaseHealth: vi.fn(),
  isAssistantConfigured: vi.fn(),
  isDatabaseConfigured: vi.fn(),
  marketDataCapabilities: vi.fn(),
}));

vi.mock('@/server/assistant', () => ({
  isAssistantConfigured: stubs.isAssistantConfigured,
}));
vi.mock('@/server/database-health', () => ({
  checkDatabaseHealth: stubs.checkDatabaseHealth,
}));
vi.mock('@/server/db', () => ({
  isDatabaseConfigured: stubs.isDatabaseConfigured,
}));
vi.mock('@/server/market-data', () => ({
  marketDataCapabilities: stubs.marketDataCapabilities,
}));

import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.isAssistantConfigured.mockReturnValue(true);
    stubs.isDatabaseConfigured.mockReturnValue(true);
    stubs.marketDataCapabilities.mockReturnValue({ priceAnalysis: true, dca: true });
    stubs.checkDatabaseHealth.mockResolvedValue('ready');
  });

  it('reports configured database capability without executing a live query', async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: 'ready',
      services: {
        database: 'configured',
      },
    });
    expect(stubs.isDatabaseConfigured).toHaveBeenCalledOnce();
    expect(stubs.checkDatabaseHealth).not.toHaveBeenCalled();
  });

  it('degrades honestly when database configuration is absent', async () => {
    stubs.isDatabaseConfigured.mockReturnValue(false);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: 'degraded',
      services: {
        database: 'not-configured',
      },
    });
    expect(stubs.checkDatabaseHealth).not.toHaveBeenCalled();
  });
});
