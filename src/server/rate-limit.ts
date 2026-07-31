// Purpose: Per-client abuse rate limiting for public provider-backed API routes.
//
// Production enforcement runs through Vercel's official WAF rate-limiting SDK
// (`@vercel/firewall`), whose per-client (per-region/per-IP) decision is
// consistent across serverless instances. This is ABUSE PROTECTION, not a shared
// provider-call quota limiter: it bounds how fast any one client may call a route,
// but does NOT bound the total upstream provider calls made across all users.
// Licensed public live mode still requires a separate durable, deployment-wide
// provider-call quota limiter (see README "Production licensing gate").
// A module-local Map is NOT a security boundary once traffic is spread over many
// instances, so it is used only as a deterministic, non-production fallback for
// local development and tests. That fallback must never be relied on in
// production and does not, on its own, protect a real deployment.
//
// External setup required before production traffic is trusted (see README):
//   1. Publish one WAF rule whose Rate Limit API ID condition matches every
//      stable ID below: ^investiq-(assistant|market-data|fundamentals)$.
//      The production rule is one shared 60-request / 60-second per-IP bucket,
//      a free-plan-compatible edge abuse boundary rather than three independent
//      route quotas.
//   2. Set RATE_LIMIT_WAF_READY=true in the Production environment to confirm
//      the rule is live. Until then, production fails closed with a neutral 503
//      before any provider work runs.
//
// Docs:
//   https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk
//   https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting

import { checkRateLimit } from '@vercel/firewall';

export type RateLimitKind = 'assistant' | 'market-data' | 'fundamentals';

export interface RateLimitOutcome {
  ok: boolean;
  status?: number;
  message?: string;
}

/**
 * Stable WAF rate-limit rule IDs. These MUST match the rule IDs configured in
 * the Vercel dashboard. If a rule is renamed the SDK returns a `not-found`
 * error, and production fails closed with a neutral 503 rather than allowing
 * unmetered traffic.
 */
export const RATE_LIMIT_RULE_IDS: Record<RateLimitKind, string> = {
  assistant: 'investiq-assistant',
  'market-data': 'investiq-market-data',
  fundamentals: 'investiq-fundamentals',
};

/** Route-specific budgets for the non-production in-process fallback only. */
export const RATE_LIMIT_PER_MINUTE: Record<RateLimitKind, number> = {
  assistant: 10,
  'market-data': 60,
  fundamentals: 60,
};

const NEUTRAL_MESSAGES: Record<RateLimitKind, { busy: string; unavailable: string }> = {
  assistant: {
    busy: 'The AI assistant is busy.',
    unavailable: 'The AI assistant is temporarily unavailable.',
  },
  'market-data': {
    busy: 'Too many requests.',
    unavailable: 'Market data is temporarily unavailable.',
  },
  fundamentals: {
    busy: 'Too many requests.',
    unavailable: 'Company fundamentals are temporarily unavailable.',
  },
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_RATE_LIMIT_BUCKETS = 2_000;

export interface RateLimitEnvironment {
  vercelEnv: string | undefined;
  nodeEnv: string | undefined;
  wafReady: string | undefined;
}

/**
 * Distributed WAF decision, matching the `@vercel/firewall` SDK return shape.
 * `error` is set when the rule was not found or the firewall blocked the call;
 * either case is treated as a fail-closed failure.
 */
export interface WafRateLimitResult {
  rateLimited: boolean;
  error?: 'not-found' | 'blocked';
}

export interface RateLimitDependencies {
  env: RateLimitEnvironment;
  /** Distributed WAF check. Any `error` result (including a missing rule) fails closed. */
  checkRateLimit: (ruleId: string, request: Request) => Promise<WafRateLimitResult>;
  /** Returns true when the request is still within the non-production fallback budget. */
  fallbackWithinLimit: (kind: RateLimitKind, request: Request) => boolean;
}

function isProductionRuntime(env: RateLimitEnvironment): boolean {
  // On Vercel, VERCEL_ENV is always 'production' | 'preview' | 'development'.
  // Preview and development deployments intentionally use the fallback so a
  // missing WAF rule there does not block iteration.
  if (env.vercelEnv) return env.vercelEnv === 'production';
  return env.nodeEnv === 'production';
}

/**
 * Pure rate-limit decision. Dependencies are injected so the production
 * fail-closed and WAF paths can be exercised deterministically in tests without
 * a network call.
 */
export async function evaluateRateLimit(
  kind: RateLimitKind,
  request: Request,
  deps: RateLimitDependencies,
): Promise<RateLimitOutcome> {
  const messages = NEUTRAL_MESSAGES[kind];

  if (isProductionRuntime(deps.env)) {
    // Fail closed until the deployment explicitly confirms the WAF rules are
    // published. This runs before any provider work.
    if (deps.env.wafReady !== 'true') {
      return { ok: false, status: 503, message: messages.unavailable };
    }
    try {
      const result = await deps.checkRateLimit(RATE_LIMIT_RULE_IDS[kind], request);
      if (result.error) {
        // A missing rule or a firewall block is a limiter failure, not a signal
        // to allow traffic. Fail closed so a renamed rule ID can never silently
        // disable enforcement.
        return { ok: false, status: 503, message: messages.unavailable };
      }
      if (result.rateLimited) return { ok: false, status: 429, message: messages.busy };
      return { ok: true };
    } catch {
      // A WAF error must also fail closed, never open.
      return { ok: false, status: 503, message: messages.unavailable };
    }
  }

  // Non-production only: in-process budget. This is NOT a security boundary.
  if (!deps.fallbackWithinLimit(kind, request)) {
    return { ok: false, status: 429, message: messages.busy };
  }
  return { ok: true };
}

export function enforceRateLimit(kind: RateLimitKind, request: Request): Promise<RateLimitOutcome> {
  return evaluateRateLimit(kind, request, {
    env: {
      vercelEnv: process.env.VERCEL_ENV,
      nodeEnv: process.env.NODE_ENV,
      wafReady: process.env.RATE_LIMIT_WAF_READY,
    },
    checkRateLimit: vercelCheckRateLimit,
    fallbackWithinLimit,
  });
}

async function vercelCheckRateLimit(ruleId: string, request: Request): Promise<WafRateLimitResult> {
  // `@vercel/firewall` is a regular production dependency (see package.json), so
  // it is imported statically. Next/Vercel output tracing then reliably includes
  // the package, and its own types flow through without an ambient shim. The SDK
  // reports `{ rateLimited, error? }`; the caller fails closed on any `error`.
  return checkRateLimit(ruleId, { request });
}

type RateLimitBucket = { count: number; resetAt: number };
const rateLimitBuckets = new Map<string, RateLimitBucket>();

/**
 * Deterministic in-process token bucket. NON-PRODUCTION ONLY. It is per-instance
 * and therefore cannot be trusted across a real, multi-instance deployment.
 */
export function fallbackWithinLimit(kind: RateLimitKind, request: Request): boolean {
  const now = Date.now();
  const key = `${kind}:${localFallbackIdentifier(request)}`;
  const existing = rateLimitBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    pruneRateLimitBuckets(now);
    return true;
  }

  existing.count += 1;
  return existing.count <= RATE_LIMIT_PER_MINUTE[kind];
}

// Non-production convenience only. x-forwarded-for is deliberately NOT used as a
// production security identity; the WAF derives the trusted client above.
function localFallbackIdentifier(request: Request): string {
  const forwarded =
    request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? '';
  return forwarded.split(',')[0]?.trim().slice(0, 128) || 'local';
}

function pruneRateLimitBuckets(now: number) {
  if (rateLimitBuckets.size <= MAX_RATE_LIMIT_BUCKETS) return;

  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }

  while (rateLimitBuckets.size > MAX_RATE_LIMIT_BUCKETS) {
    const oldestKey = rateLimitBuckets.keys().next().value as string | undefined;
    if (!oldestKey) break;
    rateLimitBuckets.delete(oldestKey);
  }
}
