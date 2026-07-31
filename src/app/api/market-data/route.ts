import {
  MAX_MARKET_DATA_RESPONSE_BYTES,
  boundedJsonResponse,
  jsonResponse,
  readJsonBody,
  routeErrorResponse,
} from '@/server/errors';
import { enforceRateLimit } from '@/server/rate-limit';
import { loadMarketData, validateMarketDataOptions } from '@/server/market-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const limit = await enforceRateLimit('market-data', request);
  if (!limit.ok) {
    return jsonResponse({ message: limit.message }, limit.status);
  }

  // Provider configuration is enforced per purpose inside loadMarketData: DCA
  // requires Massive, price-only analysis does not. Validation of the request
  // (including its mode) therefore happens first.
  try {
    const options = validateMarketDataOptions(await readJsonBody(request));
    const data = await loadMarketData(options);
    return boundedJsonResponse(data, MAX_MARKET_DATA_RESPONSE_BYTES);
  } catch (error) {
    return routeErrorResponse(
      error,
      'Market data is temporarily unavailable.',
      'Market-data request failed',
    );
  }
}
