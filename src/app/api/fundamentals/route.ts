import { jsonResponse, publicError, routeErrorResponse } from '@/server/errors';
import { enforceRateLimit } from '@/server/rate-limit';
import { loadFundamentals } from '@/server/sec';

export const runtime = 'nodejs';

// The curated fundamentals payload is small; this ceiling only guards against an
// unexpected serialization blowup and never truncates a normal response.
const MAX_FUNDAMENTALS_RESPONSE_BYTES = 1_000_000;

// SEC filings post at most a few times per quarter, so the response is safely
// cacheable at the edge and revalidated in the background.
const FUNDAMENTALS_CACHE_CONTROL =
  'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400';

/**
 * GET /api/fundamentals?ticker=AAPL
 *
 * Returns the auditable, annual, "as most recently reported" five-year SEC fundamentals
 * view for a US-listed company. Success is the `FundamentalsResult` envelope; errors are
 * the shared `{ message }` envelope with a neutral message. No upstream body or internal
 * detail is leaked.
 */
export async function GET(request: Request): Promise<Response> {
  const limit = await enforceRateLimit('fundamentals', request);
  if (!limit.ok) {
    return jsonResponse({ message: limit.message }, limit.status);
  }

  try {
    const ticker = new URL(request.url).searchParams.get('ticker');
    const result = await loadFundamentals(ticker);

    const body = JSON.stringify(result);
    if (new TextEncoder().encode(body).byteLength > MAX_FUNDAMENTALS_RESPONSE_BYTES) {
      throw publicError(502, 'The company fundamentals response exceeded the safe size limit.');
    }
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': FUNDAMENTALS_CACHE_CONTROL,
      },
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      'Company fundamentals are temporarily unavailable.',
      'Fundamentals request failed',
    );
  }
}
