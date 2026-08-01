import 'server-only';

import { sql } from 'drizzle-orm';

import { createDatabase, isDatabaseConfigured } from '@/server/db';
import { evaluateDatabaseHealth, type DatabaseHealth } from '@/server/database-health-core';

const HEALTH_READY_CACHE_MS = 30_000;
const HEALTH_FAILURE_CACHE_MS = 5_000;
const HEALTH_TIMEOUT_MS = 2_500;

let cached: { checkedAt: number; value: DatabaseHealth } | undefined;
let inFlight: Promise<DatabaseHealth> | undefined;

export async function checkDatabaseHealth(now = Date.now()): Promise<DatabaseHealth> {
  const configured = isDatabaseConfigured();
  if (!configured) return 'not-configured';
  if (cached) {
    const cacheMs = cached.value === 'ready' ? HEALTH_READY_CACHE_MS : HEALTH_FAILURE_CACHE_MS;
    if (now - cached.checkedAt < cacheMs) return cached.value;
  }
  if (inFlight) return inFlight;

  inFlight = evaluateDatabaseHealth(
    configured,
    async () => {
      const db = createDatabase();
      await db.execute(sql`select 1 as ok`);
    },
    HEALTH_TIMEOUT_MS,
  );
  try {
    const value = await inFlight;
    cached = { checkedAt: now, value };
    return value;
  } finally {
    inFlight = undefined;
  }
}

export function resetDatabaseHealthCache(): void {
  cached = undefined;
  inFlight = undefined;
}
