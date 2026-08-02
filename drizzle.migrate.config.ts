import { defineConfig } from 'drizzle-kit';

const directDatabaseUrl = process.env.DATABASE_URL_UNPOOLED?.trim();

if (!directDatabaseUrl) {
  throw new Error('DATABASE_URL_UNPOOLED is required for database migrations.');
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: directDatabaseUrl },
  strict: true,
  verbose: true,
});
