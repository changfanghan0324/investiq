import { isAssistantConfigured } from '@/server/assistant';
import { jsonResponse } from '@/server/errors';
import { marketDataCapabilities } from '@/server/market-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  const { priceAnalysis, dca } = marketDataCapabilities();
  const assistantReady = isAssistantConfigured();

  // Price-only analysis needs no Massive key, so a missing key degrades DCA alone
  // and must never force an overall 503. The platform is only "unavailable" when
  // even price analysis cannot be served (e.g. the production licensing gate).
  const status = priceAnalysis
    ? dca && assistantReady
      ? 'ready'
      : 'degraded'
    : 'unavailable';

  return jsonResponse(
    {
      status,
      services: {
        priceAnalysis: priceAnalysis ? 'ready' : 'unavailable',
        dca: dca ? 'ready' : 'unavailable',
        assistant: assistantReady ? 'ready' : 'unavailable',
      },
    },
    priceAnalysis ? 200 : 503,
  );
}
