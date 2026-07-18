import { isAssistantConfigured } from '@/server/assistant';
import { jsonResponse } from '@/server/errors';
import { isMarketDataConfigured } from '@/server/market-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  const marketDataReady = isMarketDataConfigured();
  const assistantReady = isAssistantConfigured();

  return jsonResponse(
    {
      status: marketDataReady ? (assistantReady ? 'ready' : 'degraded') : 'unavailable',
      services: {
        marketData: marketDataReady ? 'ready' : 'unavailable',
        assistant: assistantReady ? 'ready' : 'unavailable',
      },
    },
    marketDataReady ? 200 : 503,
  );
}
