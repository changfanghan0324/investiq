import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  READINESS_FAILURE_TTL_MS,
  READINESS_SUCCESS_TTL_MS,
  READINESS_TIMEOUT_MS,
  createReadinessLoader,
} from '@/services/readiness-loader';

const readyPayload = {
  status: 'ready',
  services: {
    priceAnalysis: 'ready',
    dca: 'ready',
    assistant: 'ready',
    database: 'configured',
  },
};

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('readiness loader', () => {
  it('parses an intentional JSON 503 and caches it as a valid readiness document', async () => {
    let now = 1_000;
    const fetchImpl = vi.fn().mockResolvedValue(response({
      status: 'unavailable',
      services: {
        priceAnalysis: 'unavailable',
        dca: 'unavailable',
        assistant: 'ready',
        database: 'configured',
      },
    }, 503));
    const loader = createReadinessLoader({ fetchImpl, now: () => now });

    await expect(loader.load()).resolves.toMatchObject({
      priceAnalysis: 'unavailable',
      dca: 'unavailable',
      assistant: 'ready',
    });
    now += READINESS_SUCCESS_TTL_MS - 1;
    await loader.load();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('deduplicates concurrent reads and reuses a successful cache entry', async () => {
    let resolveFetch!: (value: Response) => void;
    let now = 100;
    const fetchImpl = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    const loader = createReadinessLoader({ fetchImpl, now: () => now });

    const first = loader.load();
    const second = loader.load();
    expect(fetchImpl).toHaveBeenCalledOnce();
    resolveFetch(response(readyPayload));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    now += READINESS_SUCCESS_TTL_MS - 1;
    await loader.load();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('fails closed, applies the shorter failure TTL, and force-refreshes once', async () => {
    let now = 500;
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const loader = createReadinessLoader({ fetchImpl, now: () => now });

    await expect(loader.load()).resolves.toMatchObject({ overall: 'unavailable' });
    now += READINESS_FAILURE_TTL_MS - 1;
    await loader.load();
    expect(fetchImpl).toHaveBeenCalledOnce();

    await loader.load({ force: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('expires a failed read at the short TTL', async () => {
    let now = 500;
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const loader = createReadinessLoader({ fetchImpl, now: () => now });

    await loader.load();
    now += READINESS_FAILURE_TTL_MS;
    await loader.load();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps valid readiness past the failure TTL and expires it at the success TTL', async () => {
    let now = 0;
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(response(readyPayload)));
    const loader = createReadinessLoader({ fetchImpl, now: () => now });

    await loader.load();
    now += READINESS_FAILURE_TTL_MS;
    await loader.load();
    expect(fetchImpl).toHaveBeenCalledOnce();

    now = READINESS_SUCCESS_TTL_MS;
    await loader.load();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not let an obsolete in-flight request repopulate a reset cache', async () => {
    let resolveFirst!: (value: Response) => void;
    let now = 0;
    const fetchImpl = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockImplementation(() => Promise.resolve(response(readyPayload)));
    const loader = createReadinessLoader({ fetchImpl, now: () => now });

    const obsolete = loader.load();
    loader.reset();
    await loader.load();
    resolveFirst(response(readyPayload));
    await obsolete;
    now += READINESS_SUCCESS_TTL_MS;
    await loader.load();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('aborts a hanging fetch, clears the timer, and permits a later retry', async () => {
    vi.useFakeTimers();
    const clearTimeoutImpl = vi.fn(clearTimeout);
    const fetchImpl = vi.fn()
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => (
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        })
      ))
      .mockResolvedValueOnce(response(readyPayload));
    const loader = createReadinessLoader({ fetchImpl, clearTimeoutImpl });

    const pending = loader.load();
    await vi.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS);
    await expect(pending).resolves.toMatchObject({ overall: 'unavailable' });
    expect(clearTimeoutImpl).toHaveBeenCalledOnce();

    await expect(loader.load({ force: true })).resolves.toMatchObject({ overall: 'ready' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not access browser storage', async () => {
    const getItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem });
    const loader = createReadinessLoader({ fetchImpl: vi.fn().mockResolvedValue(response(readyPayload)) });
    await loader.load();
    expect(getItem).not.toHaveBeenCalled();
  });
});
