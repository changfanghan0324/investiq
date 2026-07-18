const MAX_JSON_BODY_BYTES = 65_536;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_RATE_LIMIT_BUCKETS = 2_000;

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();

export class PublicServerError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicServerError';
    this.status = status;
  }
}

export function publicError(status: number, message: string): PublicServerError {
  return new PublicServerError(status, message);
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    throw publicError(413, 'Request is too large.');
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_JSON_BODY_BYTES) {
    throw publicError(413, 'Request is too large.');
  }

  try {
    return JSON.parse(body || '{}') as unknown;
  } catch {
    throw publicError(400, 'Invalid request.');
  }
}

export function getClientIdentifier(request: Request): string {
  const forwardedFor =
    request.headers.get('x-vercel-forwarded-for') ??
    request.headers.get('x-forwarded-for') ??
    request.headers.get('x-real-ip');
  return forwardedFor?.split(',')[0]?.trim().slice(0, 128) || 'unknown';
}

export function withinRateLimit(namespace: string, identifier: string, limit: number): boolean {
  const now = Date.now();
  const key = `${namespace}:${identifier}`;
  const existing = rateLimitBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    pruneRateLimitBuckets(now);
    return true;
  }

  existing.count += 1;
  return existing.count <= limit;
}

export function jsonResponse(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function routeErrorResponse(error: unknown, neutralMessage: string, context: string): Response {
  const status = error instanceof PublicServerError ? error.status : 500;
  if (status >= 500) {
    const detail = error instanceof Error ? error.message : 'Unknown server error';
    console.error(`${context}: ${detail}`);
  }

  const message =
    status >= 500
      ? neutralMessage
      : error instanceof PublicServerError
        ? error.message
        : 'Invalid request.';
  return jsonResponse({ message }, status);
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
