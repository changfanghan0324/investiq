// Browser-only health loader. The server derives capabilities directly and never fetches itself.

import { tryParseHealthReport, unavailableServiceReadiness } from '@/domain/evidence';
import type { ServiceReadiness } from '@/types/evidence';

export const READINESS_SUCCESS_TTL_MS = 60_000;
export const READINESS_FAILURE_TTL_MS = 10_000;
export const READINESS_TIMEOUT_MS = 5_000;

interface CachedReadiness {
  expiresAt: number;
  value: ServiceReadiness;
}

export interface ReadinessLoaderDependencies {
  fetchImpl: typeof fetch;
  now: () => number;
  setTimeoutImpl: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutImpl: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface ReadinessLoader {
  load: (options?: { force?: boolean }) => Promise<ServiceReadiness>;
  reset: () => void;
}

export function createReadinessLoader(
  overrides: Partial<ReadinessLoaderDependencies> = {},
): ReadinessLoader {
  const dependencies: ReadinessLoaderDependencies = {
    fetchImpl: (input, init) => fetch(input, init),
    now: () => Date.now(),
    setTimeoutImpl: (handler, ms) => setTimeout(handler, ms),
    clearTimeoutImpl: (handle) => clearTimeout(handle),
    ...overrides,
  };
  let cached: CachedReadiness | undefined;
  let inFlight: Promise<ServiceReadiness> | undefined;
  let generation = 0;

  async function requestReadiness(): Promise<{ value: ServiceReadiness; valid: boolean }> {
    const controller = new AbortController();
    const timeout = dependencies.setTimeoutImpl(() => controller.abort(), READINESS_TIMEOUT_MS);
    try {
      const response = await dependencies.fetchImpl('/api/health', {
        cache: 'no-store',
        signal: controller.signal,
      });
      // A 503 may be an intentional, complete readiness response. Parse the body
      // before considering transport status and do not report it as an exception.
      const payload: unknown = await response.json().catch(() => undefined);
      const parsed = tryParseHealthReport(payload);
      return parsed
        ? { value: parsed, valid: true }
        : { value: unavailableServiceReadiness, valid: false };
    } catch {
      return { value: unavailableServiceReadiness, valid: false };
    } finally {
      dependencies.clearTimeoutImpl(timeout);
    }
  }

  function load(options: { force?: boolean } = {}): Promise<ServiceReadiness> {
    const now = dependencies.now();
    if (!options.force && cached && cached.expiresAt > now) return Promise.resolve(cached.value);
    if (inFlight) return inFlight;

    const requestGeneration = generation;
    const request = requestReadiness()
      .then(({ value, valid }) => {
        if (requestGeneration === generation) {
          cached = {
            value,
            expiresAt: dependencies.now() + (valid ? READINESS_SUCCESS_TTL_MS : READINESS_FAILURE_TTL_MS),
          };
        }
        return value;
      })
      .finally(() => {
        if (requestGeneration === generation && inFlight === request) inFlight = undefined;
      });
    inFlight = request;
    return request;
  }

  return {
    load,
    reset() {
      generation += 1;
      cached = undefined;
      inFlight = undefined;
    },
  };
}

const browserReadinessLoader = createReadinessLoader();

export function loadServiceReadiness(options?: { force?: boolean }): Promise<ServiceReadiness> {
  if (typeof window === 'undefined') return Promise.resolve(unavailableServiceReadiness);
  return browserReadinessLoader.load(options);
}

export function resetReadinessCache(): void {
  browserReadinessLoader.reset();
}
