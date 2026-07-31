// Purpose: HTTP-boundary safety helpers — bounded request/response byte reading,
// safe public/server error separation, and size-limited JSON responses.

const MAX_JSON_BODY_BYTES = 65_536;

/**
 * Ceiling for the serialized market-data route response. Vercel documents a
 * 4.5 MB function payload limit; we stay safely below it and fail with a
 * neutral error rather than ever silently truncating historical price data.
 * https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions
 */
export const MAX_MARKET_DATA_RESPONSE_BYTES = 4_000_000;

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

/**
 * Reads a request body with a hard byte ceiling enforced incrementally.
 *
 * Content-Length gives a fast rejection, but a hostile or buggy client can omit
 * it, so the stream is counted chunk-by-chunk and cancelled the moment it
 * crosses the limit — the full body is never buffered. Decoding and parsing only
 * happen after a bounded buffer has been collected. Empty bodies resolve to an
 * empty object and malformed JSON is a neutral 400, preserving prior semantics.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    throw publicError(413, 'Request is too large.');
  }

  const buffer = await readBoundedStream(request.body, MAX_JSON_BODY_BYTES, () =>
    publicError(413, 'Request is too large.'),
  );
  if (buffer.byteLength === 0) return {};

  const text = new TextDecoder().decode(buffer);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw publicError(400, 'Invalid request.');
  }
}

export interface BoundedJsonLimit {
  maxBytes: number;
  /** Human-readable provider label used only in server-side error detail. */
  context: string;
}

interface ReadableJsonSource {
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
}

export interface BoundedJsonResult<T> {
  value: T;
  /**
   * Number of body bytes actually read from the stream. Callers that follow a
   * paginated cursor use this to enforce a cumulative budget across pages
   * without re-serializing the untrusted payload.
   */
  byteLength: number;
}

/**
 * Reads and parses a provider response with a hard byte ceiling enforced
 * incrementally, and reports how many body bytes were consumed. Content-Length
 * is a fast rejection; the body stream is then counted chunk-by-chunk and
 * cancelled the moment it crosses the budget. An oversized, empty, or unreadable
 * payload becomes an explicit neutral error so financial data is never silently
 * truncated. `byteLength` is the exact decoded body size, so the same bytes yield
 * the same accounted size whether read fresh or replayed from a cache.
 */
export async function readJsonFromResponseWithSize<T>(
  response: ReadableJsonSource,
  limit: BoundedJsonLimit,
): Promise<BoundedJsonResult<T>> {
  const tooLarge = () =>
    publicError(502, `The ${limit.context} returned a response that is too large.`);

  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit.maxBytes) {
    throw tooLarge();
  }

  const buffer = await readBoundedStream(response.body, limit.maxBytes, tooLarge);
  if (buffer.byteLength === 0) {
    throw publicError(502, `The ${limit.context} returned an empty response.`);
  }

  try {
    const text = new TextDecoder('utf-8').decode(buffer);
    return { value: JSON.parse(text) as T, byteLength: buffer.byteLength };
  } catch {
    throw publicError(502, `The ${limit.context} returned an unreadable response.`);
  }
}

/** Convenience wrapper when only the parsed payload is needed, not its byte size. */
export async function readJsonFromResponse<T>(
  response: ReadableJsonSource,
  limit: BoundedJsonLimit,
): Promise<T> {
  return (await readJsonFromResponseWithSize<T>(response, limit)).value;
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  onExceed: () => PublicServerError,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array(0);

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw onExceed();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function jsonResponse(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * Serializes a payload once, rejects it with a neutral error if it exceeds the
 * byte ceiling, and otherwise returns a JSON response. This keeps the route
 * response bounded without buffering the payload twice or truncating it.
 */
export function boundedJsonResponse(payload: unknown, maxBytes: number, status = 200): Response {
  const body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    throw publicError(502, 'The market-data response exceeded the safe size limit.');
  }
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
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
