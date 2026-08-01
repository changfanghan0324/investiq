import { isAssistantConfigured } from '@/server/assistant';
import { checkDatabaseHealth } from '@/server/database-health';
import { jsonResponse } from '@/server/errors';
import { marketDataCapabilities } from '@/server/market-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const { priceAnalysis, dca } = marketDataCapabilities();
  const assistantReady = isAssistantConfigured();
  const database = await checkDatabaseHealth();
  const supportingServicesReady = dca && assistantReady && database === 'ready';

  // Price-only analysis needs no Massive key, so a missing key degrades DCA alone
  // and must never force an overall 503. The platform is only "unavailable" when
  // even price analysis cannot be served (e.g. the production licensing gate).
  const status = priceAnalysis
    ? supportingServicesReady
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
        database,
      },
    },
    priceAnalysis ? 200 : 503,
  );
}
