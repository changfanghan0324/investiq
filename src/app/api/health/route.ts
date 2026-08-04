import { deriveHealthOverall, healthReport } from '@/domain/evidence';
import { isAssistantConfigured } from '@/server/assistant';
import { isDatabaseConfigured } from '@/server/db';
import { jsonResponse } from '@/server/errors';
import { marketDataCapabilities } from '@/server/market-data';
import type { HealthReport } from '@/types/evidence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const { priceAnalysis, dca } = marketDataCapabilities();
  const assistantReady = isAssistantConfigured();
  // This endpoint is public and may be polled frequently. Report configuration
  // capability only; a live database round-trip belongs behind protected platform
  // monitoring so anonymous requests cannot fan out Neon work across instances.
  const databaseConfigured = isDatabaseConfigured();
  const services = {
    priceAnalysis: priceAnalysis ? 'ready' : 'unavailable',
    dca: dca ? 'ready' : 'unavailable',
    assistant: assistantReady ? 'ready' : 'unavailable',
    database: databaseConfigured ? 'configured' : 'not-configured',
  } satisfies HealthReport['services'];

  // Price-only analysis needs no Massive key, so a missing key degrades DCA alone
  // and must never force an overall 503. The platform is only "unavailable" when
  // even price analysis cannot be served (e.g. the production licensing gate).
  const status = deriveHealthOverall(services);

  return jsonResponse(
    healthReport({
      status,
      services,
    }),
    priceAnalysis ? 200 : 503,
  );
}
