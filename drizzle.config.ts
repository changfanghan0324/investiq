import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // `generate` is schema-only and does not connect. `migrate` must run through
    // Vercel/Neon with a real server-only URL; the unreachable fallback prevents
    // credentials from ever being committed merely to generate SQL.
    url: databaseUrl ?? 'postgresql://127.0.0.1:1/investiq',
  },
  strict: true,
  verbose: true,
});
