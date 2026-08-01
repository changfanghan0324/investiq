import 'server-only';

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

import * as schema from '@/db/schema';

export function databaseUrl(): string | undefined {
  const value = process.env.DATABASE_URL?.trim();
  return value || undefined;
}

export function isDatabaseConfigured(): boolean {
  return databaseUrl() !== undefined;
}

export function createDatabase(url = databaseUrl()) {
  if (!url) throw new Error('Database is not configured.');
  return drizzle({ client: neon(url), schema });
}

export type InvestIqDatabase = ReturnType<typeof createDatabase>;
