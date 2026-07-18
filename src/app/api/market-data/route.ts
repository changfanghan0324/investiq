import {
  getClientIdentifier,
  jsonResponse,
  readJsonBody,
  routeErrorResponse,
  withinRateLimit,
} from '@/server/errors';
import {
  isMarketDataConfigured,
  loadMarketData,
  validateMarketDataOptions,
} from '@/server/market-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  if (!withinRateLimit('market-data', getClientIdentifier(request), 60)) {
    return jsonResponse({ message: 'Too many requests.' }, 429);
  }
  if (!isMarketDataConfigured()) {
    console.error('Market-data request rejected: MASSIVE_API_KEY is not configured.');
    return jsonResponse({ message: 'Market data is temporarily unavailable.' }, 503);
  }

  try {
    const options = validateMarketDataOptions(await readJsonBody(request));
    return jsonResponse(await loadMarketData(options));
  } catch (error) {
    return routeErrorResponse(
      error,
      'Market data is temporarily unavailable.',
      'Market-data request failed',
    );
  }
}
