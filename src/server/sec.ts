// Purpose: SEC EDGAR access layer for company fundamentals.
//
// Responsibilities: resolve a caller ticker to an official SEC CIK, fetch the
// `companyfacts` XBRL document and the company `submissions` metadata (for SIC),
// and hand them to the pure `buildFundamentals` selector. Callers may only supply a
// ticker; CIKs and URLs are derived from SEC's own data, never from the caller, so
// arbitrary-URL/CIK fetching is impossible by construction.
//
// SEC fair-access behavior:
//   - A truthful, configurable User-Agent/contact is sent on every request
//     (SEC_USER_AGENT). SEC access needs no key or secret, so none is stored or logged.
//   - Outbound SEC requests are serialized through a process-local gate with minimum
//     spacing. This bounds one runtime instance; the public API's distributed WAF rule
//     is still required to control deployment-wide abuse in serverless production.
//   - Every request has a bounded timeout, a hard response-size ceiling, a status check,
//     and a light content-type check. Upstream bodies are never surfaced to the client.
//   - Responses are cached with per-resource TTLs and revalidated on expiry.

import { publicError, readJsonFromResponse } from '@/server/errors';
import { buildFundamentals } from '@/domain/fundamentals';
import type { CompanyFacts, FundamentalsIdentityInput, FundamentalsResult } from '@/domain/fundamentals';

const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_DATA_ORIGIN = 'https://data.sec.gov';

/** Serialized minimum spacing between SEC requests. 150ms ⇒ ≤ ~6.7 req/s, safely < 10. */
export const SEC_MIN_REQUEST_INTERVAL_MS = 150;
/**
 * Corruption guard. The official SEC directory contained 10,412 valid, unique
 * rows when verified on 2026-08-03; 5,000 keeps wide headroom while rejecting a
 * response missing more than half of the observed issuer universe.
 */
export const MIN_SEC_TICKER_DIRECTORY_ENTRIES = 5_000;
export const MIN_SEC_TICKER_DIRECTORY_PARSE_RATIO = 0.9;
const SEC_TIMEOUT_MS = 20_000;

// Hard response-size ceilings. `companyfacts` for the largest issuers is tens of MB;
// the ceiling stops a hostile or broken response from exhausting memory while
// comfortably covering real documents. An oversized body is a neutral 502, never a
// silent truncation of financial data.
const MAX_TICKERS_BYTES = 12_000_000;
const MAX_COMPANYFACTS_BYTES = 50_000_000;
const MAX_SUBMISSIONS_BYTES = 15_000_000;

const TICKERS_TTL_MS = 24 * 60 * 60 * 1_000;
const COMPANYFACTS_TTL_MS = 6 * 60 * 60 * 1_000;
const SUBMISSIONS_TTL_MS = 6 * 60 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 200;

// Safe ticker semantics: US symbols are short, upper-case alphanumerics with an
// optional class separator. Stricter than an open string; SEC class shares use `-`.
const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

/** Injectable dependencies so the whole layer is testable without a live network. */
export interface SecClientOptions {
  fetchImpl?: typeof fetch;
  userAgent?: string;
  gate?: SerialRateGate;
  now?: () => number;
}

interface ResolvedSecDeps {
  fetchImpl: typeof fetch;
  userAgent: string;
  gate: SerialRateGate;
  now: () => number;
}

/**
 * Serializes tasks and enforces a minimum spacing between dispatches. Serializing
 * also pins concurrency at one inside this runtime instance, so its request rate is
 * bounded by `1000 / minIntervalMs` per second. It is not a cross-instance quota.
 * `now`/`sleep` are injectable for deterministic tests.
 */
export class SerialRateGate {
  private tail: Promise<unknown> = Promise.resolve();
  private lastDispatch: number | undefined;

  constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    const scheduled = this.tail.then(async () => {
      if (this.lastDispatch !== undefined) {
        const wait = this.lastDispatch + this.minIntervalMs - this.now();
        if (wait > 0) await this.sleep(wait);
      }
      this.lastDispatch = this.now();
      return task();
    });
    // The chain must advance whether the task resolved or rejected, so one failure
    // never stalls every later SEC request behind it.
    this.tail = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  }
}

const defaultGate = new SerialRateGate(SEC_MIN_REQUEST_INTERVAL_MS);

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}
const secCache = new Map<string, CacheEntry>();
const inFlightSecRequests = new Map<string, Promise<unknown>>();

/** Clears the module caches. Test-only; never called on the request path. */
export function resetSecCachesForTests(): void {
  secCache.clear();
  inFlightSecRequests.clear();
}

/**
 * Validates and normalizes a caller-supplied ticker with safe ticker semantics.
 * Throws a neutral 400 on anything malformed.
 */
export function validateFundamentalsTicker(value: unknown): string {
  const ticker = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!TICKER_PATTERN.test(ticker)) {
    throw publicError(400, 'Please provide a valid US stock ticker.');
  }
  return ticker;
}

/** Raw shape of one entry in SEC's `company_tickers.json`. */
interface SecTickerRow {
  cik_str?: number;
  ticker?: string;
  title?: string;
}

interface CikMatch {
  cikNumber: number;
  paddedCik: string;
  title: string;
}

function parseTickerRow(row: SecTickerRow | null | undefined): [string, CikMatch] | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const ticker = typeof row.ticker === 'string' ? row.ticker.trim().toUpperCase() : '';
  const cikNumber = row.cik_str;
  if (!ticker || typeof cikNumber !== 'number' || !Number.isInteger(cikNumber) || cikNumber <= 0) {
    return undefined;
  }
  return [ticker, {
    cikNumber,
    paddedCik: String(cikNumber).padStart(10, '0'),
    title: typeof row.title === 'string' && row.title ? row.title : ticker,
  }];
}

/**
 * Builds a ticker→CIK lookup from SEC's `company_tickers.json` payload. Keys are
 * upper-cased; malformed rows are skipped. Exported for deterministic testing.
 */
export function buildCikMap(payload: unknown): Map<string, CikMatch> {
  const map = new Map<string, CikMatch>();
  if (!payload || typeof payload !== 'object') return map;
  for (const row of Object.values(payload as Record<string, SecTickerRow>)) {
    const parsed = parseTickerRow(row);
    if (parsed) map.set(parsed[0], parsed[1]);
  }
  return map;
}

/**
 * Resolves a normalized ticker against the CIK map. Tries the exact symbol first,
 * then a `.`→`-` class-share variant (SEC records e.g. `BRK-B`, callers may send `BRK.B`).
 */
export function resolveTickerCik(map: Map<string, CikMatch>, ticker: string): CikMatch | undefined {
  return map.get(ticker) ?? (ticker.includes('.') ? map.get(ticker.replace(/\./g, '-')) : undefined);
}

/** Raw shape of the fields we read from SEC `submissions`. */
interface SecSubmissions {
  name?: string;
  sic?: string;
  sicDescription?: string;
}

/**
 * Loads the auditable five-year fundamentals view for a caller ticker. The only
 * caller input is the ticker; everything else is derived from official SEC data.
 */
export async function loadFundamentals(
  rawTicker: unknown,
  options: SecClientOptions = {},
): Promise<FundamentalsResult> {
  const deps = resolveDeps(options);
  const ticker = validateFundamentalsTicker(rawTicker);

  const cikMap = buildCikMap(await cachedSecFetch(
    SEC_TICKERS_URL,
    TICKERS_TTL_MS,
    MAX_TICKERS_BYTES,
    'ticker directory',
    deps,
    false,
  ));
  const match = resolveTickerCik(cikMap, ticker);
  if (!match) {
    throw publicError(404, `We could not find a US-listed company with the ticker ${ticker}.`);
  }

  const factsUrl = `${SEC_DATA_ORIGIN}/api/xbrl/companyfacts/CIK${match.paddedCik}.json`;
  const facts = await cachedSecFetch<CompanyFacts>(
    factsUrl,
    COMPANYFACTS_TTL_MS,
    MAX_COMPANYFACTS_BYTES,
    'company facts',
    deps,
    false,
    () => publicError(404, `SEC EDGAR has no reported company facts for ${ticker}.`),
  );

  // Submissions supplies SIC (and an authoritative name). It is best-effort: a failure
  // degrades SIC to unavailable rather than failing the whole request.
  const submissions = await loadSubmissionsSafely(match.paddedCik, deps);
  const sicCode = parseSic(submissions?.sic);

  const identity: FundamentalsIdentityInput = {
    cik: match.paddedCik,
    cikNumber: match.cikNumber,
    ticker,
    name: submissions?.name?.trim() || facts.entityName?.trim() || match.title,
    ...(sicCode !== undefined ? { sicCode } : {}),
    ...(submissions?.sicDescription ? { sicDescription: submissions.sicDescription } : {}),
  };

  return buildFundamentals(facts, identity);
}

async function loadSubmissionsSafely(
  paddedCik: string,
  deps: ResolvedSecDeps,
): Promise<SecSubmissions | undefined> {
  const url = `${SEC_DATA_ORIGIN}/submissions/CIK${paddedCik}.json`;
  try {
    return await cachedSecFetch<SecSubmissions>(
      url,
      SUBMISSIONS_TTL_MS,
      MAX_SUBMISSIONS_BYTES,
      'company submissions',
      deps,
      true,
    );
  } catch {
    // SIC/industry is enrichment, not a hard requirement; proceed without it.
    return undefined;
  }
}

function parseSic(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{3,4}$/.test(value.trim())) return undefined;
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) ? parsed : undefined;
}

function resolveDeps(options: SecClientOptions): ResolvedSecDeps {
  const userAgent = options.userAgent?.trim() || process.env.SEC_USER_AGENT?.trim();
  if (!userAgent) {
    throw publicError(503, 'The SEC contact configuration is unavailable.');
  }
  return {
    fetchImpl: options.fetchImpl ?? ((input, init) => fetch(input, init)),
    userAgent,
    gate: options.gate ?? defaultGate,
    now: options.now ?? (() => Date.now()),
  };
}

/** Cached, rate-gated, bounded SEC JSON fetch. `notFound` customizes the 404 error. */
async function cachedSecFetch<T = unknown>(
  url: string,
  ttlMs: number,
  maxBytes: number,
  context: string,
  deps: ResolvedSecDeps,
  persistInNextCache: boolean,
  notFound?: () => Error,
): Promise<T> {
  const cached = secCache.get(url);
  if (cached && cached.expiresAt > deps.now()) {
    return cached.value as T;
  }

  const existing = inFlightSecRequests.get(url);
  if (existing) return existing as Promise<T>;

  const request = deps.gate
    .run(() => fetchSecJson<T>(url, maxBytes, context, deps, ttlMs, persistInNextCache, notFound))
    .then((value) => {
      if (secCache.size >= MAX_CACHE_ENTRIES) {
        const oldest = secCache.keys().next().value as string | undefined;
        if (oldest) secCache.delete(oldest);
      }
      secCache.set(url, { expiresAt: deps.now() + ttlMs, value });
      return value;
    })
    .finally(() => {
      inFlightSecRequests.delete(url);
    });
  inFlightSecRequests.set(url, request);
  return request;
}

async function fetchSecJson<T>(
  url: string,
  maxBytes: number,
  context: string,
  deps: ResolvedSecDeps,
  ttlMs: number,
  persistInNextCache: boolean,
  notFound?: () => Error,
): Promise<T> {
  let response: Response;
  try {
    response = await deps.fetchImpl(url, {
      // Next's persistent data cache is capped at 2 MB. Directory/submission
      // resources fit and may be shared across warm instances; companyfacts often
      // exceed the cap, so those use the bounded module cache above without causing
      // noisy failed-cache writes.
      cache: persistInNextCache ? 'force-cache' : 'no-store',
      ...(persistInNextCache
        ? { next: { revalidate: Math.max(1, Math.floor(ttlMs / 1_000)) } }
        : {}),
      headers: { Accept: 'application/json', 'User-Agent': deps.userAgent },
      signal: AbortSignal.timeout(SEC_TIMEOUT_MS),
    } as RequestInit & { next?: { revalidate: number } });
  } catch {
    // Network failure or timeout — neutral, no upstream detail leaked.
    throw publicError(502, `The SEC ${context} service is temporarily unavailable.`);
  }

  if (response.status === 404) {
    throw notFound ? notFound() : publicError(404, `The SEC ${context} was not found.`);
  }
  if (response.status === 429 || response.status === 403) {
    // SEC throttling or a rejected User-Agent. Surface a neutral, retryable message.
    throw publicError(503, `The SEC ${context} service is busy. Please try again shortly.`);
  }
  if (!response.ok) {
    throw publicError(502, `The SEC ${context} service returned an unexpected response.`);
  }

  const contentType = response.headers.get('content-type');
  if (contentType && !contentType.toLowerCase().includes('json')) {
    throw publicError(502, `The SEC ${context} service returned an unexpected format.`);
  }

  const value = await readJsonFromResponse<T>(response, { maxBytes, context: `SEC ${context}` });
  if (url === SEC_TICKERS_URL) assertCredibleTickerDirectory(value);
  return value;
}

/**
 * Rejects syntactically valid but implausibly empty/partial SEC ticker directories.
 * The upstream fetch is deliberately no-store; this check therefore runs before
 * the validated value enters the process cache, preventing a transient proxy
 * truncation or schema change from fabricating a definitive ticker 404.
 */
export function assertCredibleTickerDirectory(payload: unknown): void {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw publicError(503, 'The SEC ticker directory failed its plausibility check.');
  }
  const rows = Object.values(payload as Record<string, SecTickerRow>);
  const uniqueTickers = new Set<string>();
  let parsedRows = 0;
  for (const row of rows) {
    const parsed = parseTickerRow(row);
    if (!parsed) continue;
    parsedRows += 1;
    uniqueTickers.add(parsed[0]);
  }
  const parseRatio = rows.length > 0 ? parsedRows / rows.length : 0;
  if (
    rows.length < MIN_SEC_TICKER_DIRECTORY_ENTRIES
    || uniqueTickers.size < MIN_SEC_TICKER_DIRECTORY_ENTRIES
    || parseRatio < MIN_SEC_TICKER_DIRECTORY_PARSE_RATIO
  ) {
    throw publicError(503, 'The SEC ticker directory failed its plausibility check.');
  }
}
