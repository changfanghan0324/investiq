// Purpose: HTTP-boundary tests — incremental request-body byte limiting, bounded
// provider-response reading, and size-limited route responses.

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  PublicServerError,
  boundedJsonResponse,
  readJsonBody,
  readJsonFromResponse,
  readJsonFromResponseWithSize,
} from '@/server/errors';

const encoder = new TextEncoder();

interface StreamState {
  pulled: number;
  cancelled: boolean;
}

/** A ReadableStream that emits one supplied chunk per pull and records activity. */
function trackedStream(chunks: Uint8Array[]): { stream: ReadableStream<Uint8Array>; state: StreamState } {
  const state: StreamState = { pulled: 0, cancelled: false };
  const queue = [...chunks];
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulled += 1;
      const next = queue.shift();
      if (next === undefined) controller.close();
      else controller.enqueue(next);
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

function requestFromStream(stream: ReadableStream<Uint8Array> | null, headers: HeadersInit = {}): Request {
  // readJsonBody only reads `headers.get('content-length')` and `body`, so a
  // duck-typed object exercises the incremental reader without undici buffering.
  return { headers: new Headers(headers), body: stream } as unknown as Request;
}

interface BodyProbe {
  accessed: number;
}

/**
 * A duck-typed request/response whose `body` is a getter, so `accessed` counts
 * exactly the number of times the reader was reached. Unlike a ReadableStream's
 * `pull` — which the runtime may invoke eagerly on construction — this increments
 * only when the code under test actually touches the body, making it a
 * deterministic probe for the "fast reject never reads the body" guarantee.
 */
function probedBody(
  stream: ReadableStream<Uint8Array> | null,
  headers: HeadersInit = {},
): { source: { headers: Headers; readonly body: ReadableStream<Uint8Array> | null }; probe: BodyProbe } {
  const probe: BodyProbe = { accessed: 0 };
  const source = {
    headers: new Headers(headers),
    get body() {
      probe.accessed += 1;
      return stream;
    },
  };
  return { source, probe };
}

async function expectStatus(run: () => Promise<unknown>, status: number): Promise<void> {
  let caught: unknown;
  let threw = false;
  try {
    await run();
  } catch (error) {
    threw = true;
    caught = error;
  }
  assert.ok(threw, 'expected a PublicServerError to be thrown');
  if (!(caught instanceof PublicServerError)) {
    assert.fail(`expected PublicServerError, got ${String(caught)}`);
  }
  assert.equal(caught.status, status);
}

describe('readJsonBody', () => {
  it('resolves an empty body to an empty object', async () => {
    assert.deepEqual(await readJsonBody(requestFromStream(null)), {});
  });

  it('parses a valid JSON body', async () => {
    const { stream } = trackedStream([encoder.encode('{"a":1,"b":"x"}')]);
    assert.deepEqual(await readJsonBody(requestFromStream(stream)), { a: 1, b: 'x' });
  });

  it('rejects malformed JSON with a neutral 400', async () => {
    const { stream } = trackedStream([encoder.encode('not json')]);
    await expectStatus(() => readJsonBody(requestFromStream(stream)), 400);
  });

  it('stops an over-limit body with no Content-Length before consuming the whole stream', async () => {
    // Ten 10 KB chunks (100 KB) with no Content-Length header exceed the 64 KB limit.
    const chunks = Array.from({ length: 10 }, () => new Uint8Array(10_000));
    const { stream, state } = trackedStream(chunks);

    await expectStatus(() => readJsonBody(requestFromStream(stream)), 413);
    assert.equal(state.cancelled, true, 'stream should be cancelled');
    assert.ok(state.pulled < chunks.length, `stream fully consumed (${state.pulled}/${chunks.length})`);
  });

  it('measures the body by bytes, not characters, for a multibyte payload', async () => {
    // 30,000 three-byte characters = 90 KB of UTF-8 but only 30,000 chars, so a
    // char-based check would wrongly accept it. The byte counter must reject it.
    const oversizedMultibyte = `{"q":"${'中'.repeat(30_000)}"}`;
    assert.ok(oversizedMultibyte.length < 65_536, 'char length is under the limit');
    assert.ok(encoder.encode(oversizedMultibyte).byteLength > 65_536, 'byte length is over the limit');
    const { stream } = trackedStream([encoder.encode(oversizedMultibyte)]);
    await expectStatus(() => readJsonBody(requestFromStream(stream)), 413);
  });

  it('accepts a legitimate multibyte JSON body under the byte limit', async () => {
    const body = `{"q":"${'中'.repeat(100)}"}`;
    const { stream } = trackedStream([encoder.encode(body)]);
    const parsed = (await readJsonBody(requestFromStream(stream))) as { q: string };
    assert.equal(parsed.q, '中'.repeat(100));
  });

  it('fast-rejects on an over-limit Content-Length header without reading the body', async () => {
    const { stream } = trackedStream([new Uint8Array(10)]);
    const { source, probe } = probedBody(stream, { 'content-length': String(70_000) });
    await expectStatus(() => readJsonBody(source as unknown as Request), 413);
    assert.equal(probe.accessed, 0, 'body must not be accessed when Content-Length already exceeds the limit');
  });
});

describe('readJsonFromResponse', () => {
  const limit = { maxBytes: 100, context: 'test provider' } as const;

  function source(stream: ReadableStream<Uint8Array> | null, headers: HeadersInit = {}) {
    return { headers: new Headers(headers), body: stream };
  }

  it('parses a valid provider payload', async () => {
    const { stream } = trackedStream([encoder.encode('{"status":"OK","results":[1,2]}')]);
    assert.deepEqual(await readJsonFromResponse(source(stream), limit), {
      status: 'OK',
      results: [1, 2],
    });
  });

  it('stops an over-budget stream before consuming it and fails with a neutral 502', async () => {
    const chunks = Array.from({ length: 5 }, () => new Uint8Array(40)); // 200 bytes > 100 budget
    const { stream, state } = trackedStream(chunks);
    await expectStatus(() => readJsonFromResponse(source(stream), limit), 502);
    assert.equal(state.cancelled, true);
    assert.ok(state.pulled < chunks.length);
  });

  it('fast-rejects on an over-budget Content-Length without reading the body', async () => {
    const { stream } = trackedStream([new Uint8Array(10)]);
    const { source: probedSource, probe } = probedBody(stream, { 'content-length': '9999' });
    await expectStatus(() => readJsonFromResponse(probedSource, limit), 502);
    assert.equal(probe.accessed, 0, 'body must not be accessed when Content-Length already exceeds the budget');
  });

  it('rejects an empty response with a neutral 502', async () => {
    await expectStatus(() => readJsonFromResponse(source(null), limit), 502);
  });

  it('rejects an unreadable response with a neutral 502', async () => {
    const { stream } = trackedStream([encoder.encode('{ broken')]);
    await expectStatus(() => readJsonFromResponse(source(stream), limit), 502);
  });
});

describe('readJsonFromResponseWithSize', () => {
  const limit = { maxBytes: 1_000, context: 'test provider' } as const;

  function source(stream: ReadableStream<Uint8Array> | null, headers: HeadersInit = {}) {
    return { headers: new Headers(headers), body: stream };
  }

  it('returns the parsed value alongside the exact decoded body byte length', async () => {
    const body = '{"status":"OK","results":[1,2,3]}';
    const bytes = encoder.encode(body);
    const { stream } = trackedStream([bytes]);
    const result = await readJsonFromResponseWithSize(source(stream), limit);
    assert.deepEqual(result.value, { status: 'OK', results: [1, 2, 3] });
    // The reported size is exactly the bytes read, so a paginated caller can hold a
    // cumulative budget and a cache replay accounts the same size.
    assert.equal(result.byteLength, bytes.byteLength);
  });

  it('counts by bytes, not characters, for a multibyte payload', async () => {
    const body = `{"q":"${'中'.repeat(50)}"}`;
    const bytes = encoder.encode(body);
    const { stream } = trackedStream([bytes]);
    const result = await readJsonFromResponseWithSize<{ q: string }>(source(stream), limit);
    assert.equal(result.value.q, '中'.repeat(50));
    assert.equal(result.byteLength, bytes.byteLength);
    assert.ok(result.byteLength > body.length, 'multibyte body is larger in bytes than in characters');
  });
});

describe('boundedJsonResponse', () => {
  it('returns a JSON response with no-store headers for a payload within budget', async () => {
    const response = boundedJsonResponse({ ticker: 'SPY', prices: [1, 2, 3] }, 1_000_000);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { ticker: 'SPY', prices: [1, 2, 3] });
  });

  it('rejects an oversized payload with a neutral error instead of truncating', () => {
    assert.throws(
      () => boundedJsonResponse({ blob: 'x'.repeat(1_000) }, 10),
      (error: unknown) => error instanceof PublicServerError && error.status === 502,
    );
  });
});
