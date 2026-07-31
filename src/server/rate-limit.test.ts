// Purpose: Rate-limit decision tests — production fail-closed/WAF paths and the
// non-production in-process fallback, all exercised deterministically.

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  RATE_LIMIT_PER_MINUTE,
  evaluateRateLimit,
  fallbackWithinLimit,
  type RateLimitDependencies,
  type RateLimitEnvironment,
} from '@/server/rate-limit';

function request(forwardedFor = '198.51.100.7'): Request {
  return new Request('https://investiq.test/api', {
    method: 'POST',
    headers: { 'x-forwarded-for': forwardedFor },
  });
}

function deps(
  env: RateLimitEnvironment,
  overrides: Partial<RateLimitDependencies> = {},
): RateLimitDependencies {
  return {
    env,
    checkRateLimit: async () => ({ rateLimited: false }),
    fallbackWithinLimit: () => true,
    ...overrides,
  };
}

const developmentEnv: RateLimitEnvironment = {
  vercelEnv: undefined,
  nodeEnv: 'test',
  wafReady: undefined,
};

describe('evaluateRateLimit — development fallback', () => {
  it('allows a request within the non-production budget', async () => {
    const outcome = await evaluateRateLimit('assistant', request(), deps(developmentEnv));
    assert.deepEqual(outcome, { ok: true });
  });

  it('returns a neutral 429 once the fallback budget is exceeded', async () => {
    const outcome = await evaluateRateLimit(
      'market-data',
      request(),
      deps(developmentEnv, { fallbackWithinLimit: () => false }),
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 429);
    assert.equal(outcome.message, 'Too many requests.');
  });

  it('never calls the distributed WAF outside production', async () => {
    let called = false;
    await evaluateRateLimit(
      'assistant',
      request(),
      deps(developmentEnv, {
        checkRateLimit: async () => {
          called = true;
          return { rateLimited: true };
        },
      }),
    );
    assert.equal(called, false);
  });

  it('treats a Vercel preview deployment as non-production', async () => {
    const previewEnv: RateLimitEnvironment = {
      vercelEnv: 'preview',
      nodeEnv: 'production',
      wafReady: undefined,
    };
    let called = false;
    const outcome = await evaluateRateLimit(
      'assistant',
      request(),
      deps(previewEnv, {
        checkRateLimit: async () => {
          called = true;
          return { rateLimited: true };
        },
      }),
    );
    assert.deepEqual(outcome, { ok: true });
    assert.equal(called, false);
  });
});

describe('evaluateRateLimit — production', () => {
  const productionReady: RateLimitEnvironment = {
    vercelEnv: 'production',
    nodeEnv: 'production',
    wafReady: 'true',
  };

  it('fails closed with a neutral 503 when the WAF readiness flag is not set', async () => {
    let called = false;
    const outcome = await evaluateRateLimit(
      'market-data',
      request(),
      deps(
        { vercelEnv: 'production', nodeEnv: 'production', wafReady: undefined },
        {
          checkRateLimit: async () => {
            called = true;
            return { rateLimited: false };
          },
        },
      ),
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 503);
    assert.equal(outcome.message, 'Market data is temporarily unavailable.');
    // Provider work must never run behind an unproven limiter.
    assert.equal(called, false);
  });

  it('fails closed with a neutral 503 when the WAF check throws', async () => {
    const outcome = await evaluateRateLimit(
      'assistant',
      request(),
      deps(productionReady, {
        checkRateLimit: async () => {
          throw new Error('firewall unreachable');
        },
      }),
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 503);
    assert.equal(outcome.message, 'The AI assistant is temporarily unavailable.');
  });

  it('returns a neutral 429 when the distributed WAF reports the caller is limited', async () => {
    const outcome = await evaluateRateLimit(
      'assistant',
      request(),
      deps(productionReady, { checkRateLimit: async () => ({ rateLimited: true }) }),
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 429);
    assert.equal(outcome.message, 'The AI assistant is busy.');
  });

  it('fails closed with a neutral 503 when the WAF cannot find the rule ID', async () => {
    // A renamed or unpublished rule must never silently allow unmetered traffic.
    const outcome = await evaluateRateLimit(
      'assistant',
      request(),
      deps(productionReady, {
        checkRateLimit: async () => ({ rateLimited: false, error: 'not-found' }),
      }),
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 503);
    assert.equal(outcome.message, 'The AI assistant is temporarily unavailable.');
  });

  it('fails closed with a neutral 503 when the firewall blocks the check', async () => {
    const outcome = await evaluateRateLimit(
      'market-data',
      request(),
      deps(productionReady, {
        checkRateLimit: async () => ({ rateLimited: false, error: 'blocked' }),
      }),
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 503);
    assert.equal(outcome.message, 'Market data is temporarily unavailable.');
  });

  it('passes the matching stable rule ID to the WAF and allows a non-limited request', async () => {
    let seenRuleId: string | undefined;
    const outcome = await evaluateRateLimit(
      'market-data',
      request(),
      deps(productionReady, {
        checkRateLimit: async (ruleId) => {
          seenRuleId = ruleId;
          return { rateLimited: false };
        },
      }),
    );
    assert.deepEqual(outcome, { ok: true });
    assert.equal(seenRuleId, 'investiq-market-data');
  });
});

describe('fallbackWithinLimit — non-production in-process counter', () => {
  it('permits exactly the per-minute budget, then rejects', () => {
    // A unique identifier isolates this bucket from other tests.
    const identifier = `test-${Date.now()}-${Math.random()}`;
    const budget = RATE_LIMIT_PER_MINUTE.assistant;
    for (let i = 0; i < budget; i += 1) {
      assert.equal(fallbackWithinLimit('assistant', request(identifier)), true);
    }
    assert.equal(fallbackWithinLimit('assistant', request(identifier)), false);
  });
});
