import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name'),
  email: text('email'),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  image: text('image'),
  ...timestamps,
});

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refreshToken: text('refresh_token'),
    accessToken: text('access_token'),
    expiresAt: integer('expires_at'),
    tokenType: text('token_type'),
    scope: text('scope'),
    idToken: text('id_token'),
    sessionState: text('session_state'),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
    index('accounts_user_id_idx').on(table.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    sessionToken: text('session_token').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId), index('sessions_expires_idx').on(table.expires)],
);

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.identifier, table.token] }),
    uniqueIndex('verification_tokens_token_idx').on(table.token),
    index('verification_tokens_expires_idx').on(table.expires),
  ],
);

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticker: text('ticker').notNull(),
    cik: text('cik').notNull(),
    canonicalName: text('canonical_name').notNull(),
    exchange: text('exchange'),
    securityType: text('security_type'),
    sicCode: integer('sic_code'),
    sicDescription: text('sic_description'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('companies_ticker_idx').on(table.ticker),
    uniqueIndex('companies_cik_idx').on(table.cik),
    check('companies_ticker_format_check', sql`${table.ticker} ~ '^[A-Z0-9.-]{1,12}$'`),
    check('companies_cik_format_check', sql`${table.cik} ~ '^[0-9]{10}$'`),
    check('companies_sic_range_check', sql`${table.sicCode} is null or ${table.sicCode} between 100 and 9999`),
  ],
);

export const portfolios = pgTable(
  'portfolios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    baseCurrency: text('base_currency').notNull().default('USD'),
    benchmarkTicker: text('benchmark_ticker').notNull().default('SPY'),
    ...timestamps,
  },
  (table) => [
    index('portfolios_user_id_idx').on(table.userId),
    check('portfolios_name_check', sql`char_length(trim(${table.name})) between 1 and 120`),
    check('portfolios_currency_check', sql`${table.baseCurrency} = 'USD'`),
    check('portfolios_benchmark_check', sql`${table.benchmarkTicker} ~ '^[A-Z0-9.-]{1,12}$'`),
  ],
);

export const holdings = pgTable(
  'holdings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    targetWeight: numeric('target_weight', { precision: 14, scale: 12 }).notNull(),
    quantity: numeric('quantity', { precision: 28, scale: 8 }),
    costBasis: numeric('cost_basis', { precision: 28, scale: 8 }),
    asOf: date('as_of'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('holdings_portfolio_company_idx').on(table.portfolioId, table.companyId),
    index('holdings_company_id_idx').on(table.companyId),
    check('holdings_weight_check', sql`${table.targetWeight} >= 0 and ${table.targetWeight} <= 1`),
    check('holdings_quantity_check', sql`${table.quantity} is null or ${table.quantity} >= 0`),
    check('holdings_cost_basis_check', sql`${table.costBasis} is null or ${table.costBasis} >= 0`),
  ],
);

export const assumptionSets = pgTable(
  'assumption_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    methodVersion: text('method_version').notNull(),
    inputHash: text('input_hash').notNull(),
    assumptions: jsonb('assumptions').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('assumption_sets_company_user_version_idx').on(table.companyId, table.userId, table.version),
    uniqueIndex('assumption_sets_input_hash_idx').on(table.userId, table.companyId, table.inputHash),
    index('assumption_sets_user_id_idx').on(table.userId),
    index('assumption_sets_company_id_idx').on(table.companyId),
    check('assumption_sets_version_check', sql`${table.version} > 0`),
    check('assumption_sets_hash_check', sql`${table.inputHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const valuationSnapshots = pgTable(
  'valuation_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assumptionSetId: uuid('assumption_set_id')
      .notNull()
      .references(() => assumptionSets.id, { onDelete: 'restrict' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    engineVersion: text('engine_version').notNull(),
    methodVersion: text('method_version').notNull(),
    inputHash: text('input_hash').notNull(),
    outputs: jsonb('outputs').notNull(),
    randomSeed: bigint('random_seed', { mode: 'bigint' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('valuation_snapshots_user_hash_idx').on(table.userId, table.companyId, table.inputHash),
    index('valuation_snapshots_assumption_set_id_idx').on(table.assumptionSetId),
    index('valuation_snapshots_company_id_idx').on(table.companyId),
    check('valuation_snapshots_hash_check', sql`${table.inputHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const analysisSnapshots = pgTable(
  'analysis_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'restrict' }),
    portfolioId: uuid('portfolio_id').references(() => portfolios.id, { onDelete: 'restrict' }),
    analysisType: text('analysis_type').notNull(),
    engineVersion: text('engine_version').notNull(),
    methodVersion: text('method_version').notNull(),
    inputHash: text('input_hash').notNull(),
    outputs: jsonb('outputs').notNull(),
    randomSeed: bigint('random_seed', { mode: 'bigint' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('analysis_snapshots_user_id_idx').on(table.userId),
    index('analysis_snapshots_company_id_idx').on(table.companyId),
    index('analysis_snapshots_portfolio_id_idx').on(table.portfolioId),
    uniqueIndex('analysis_snapshots_user_type_hash_idx').on(table.userId, table.analysisType, table.inputHash),
    check('analysis_snapshots_subject_check', sql`num_nonnulls(${table.companyId}, ${table.portfolioId}) = 1`),
    check('analysis_snapshots_hash_check', sql`${table.inputHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const sourceRecords = pgTable(
  'source_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    valuationSnapshotId: uuid('valuation_snapshot_id').references(() => valuationSnapshots.id, { onDelete: 'restrict' }),
    analysisSnapshotId: uuid('analysis_snapshot_id').references(() => analysisSnapshots.id, { onDelete: 'restrict' }),
    sourceType: text('source_type').notNull(),
    sourceUrl: text('source_url').notNull(),
    accession: text('accession'),
    reportingPeriod: date('reporting_period'),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull(),
    contentHash: text('content_hash').notNull(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [
    index('source_records_valuation_snapshot_id_idx').on(table.valuationSnapshotId),
    index('source_records_analysis_snapshot_id_idx').on(table.analysisSnapshotId),
    index('source_records_accession_idx').on(table.accession),
    check('source_records_parent_check', sql`num_nonnulls(${table.valuationSnapshotId}, ${table.analysisSnapshotId}) = 1`),
    check('source_records_hash_check', sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const peerSets = pgTable(
  'peer_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    valuationSnapshotId: uuid('valuation_snapshot_id').references(() => valuationSnapshots.id, { onDelete: 'restrict' }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    methodVersion: text('method_version').notNull(),
    status: text('status').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  },
  (table) => [
    index('peer_sets_company_id_idx').on(table.companyId),
    index('peer_sets_valuation_snapshot_id_idx').on(table.valuationSnapshotId),
    index('peer_sets_created_by_user_id_idx').on(table.createdByUserId),
    check('peer_sets_status_check', sql`${table.status} in ('draft', 'final')`),
    check('peer_sets_finalized_check', sql`(${table.status} = 'draft' and ${table.finalizedAt} is null) or (${table.status} = 'final' and ${table.finalizedAt} is not null)`),
  ],
);

export const peerMembers = pgTable(
  'peer_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    peerSetId: uuid('peer_set_id')
      .notNull()
      .references(() => peerSets.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    score: numeric('score', { precision: 18, scale: 10 }),
    decision: text('decision').notNull().default('pending'),
    scoreComponents: jsonb('score_components').notNull().default(sql`'{}'::jsonb`),
    overrideReason: text('override_reason'),
  },
  (table) => [
    uniqueIndex('peer_members_peer_set_company_idx').on(table.peerSetId, table.companyId),
    index('peer_members_company_id_idx').on(table.companyId),
    check('peer_members_decision_check', sql`${table.decision} in ('pending', 'include', 'exclude')`),
    check('peer_members_score_check', sql`${table.score} is null or ${table.score} >= 0`),
    check('peer_members_override_check', sql`${table.decision} = 'pending' or char_length(trim(coalesce(${table.overrideReason}, ''))) > 0`),
  ],
);

export const memoDocuments = pgTable(
  'memo_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    valuationSnapshotId: uuid('valuation_snapshot_id').references(() => valuationSnapshots.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('draft'),
    title: text('title').notNull(),
    content: jsonb('content').notNull(),
    modelName: text('model_name'),
    modelVersion: text('model_version'),
    promptHash: text('prompt_hash'),
    contextHash: text('context_hash'),
    ...timestamps,
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  },
  (table) => [
    index('memo_documents_user_id_idx').on(table.userId),
    index('memo_documents_company_id_idx').on(table.companyId),
    index('memo_documents_valuation_snapshot_id_idx').on(table.valuationSnapshotId),
    check('memo_documents_status_check', sql`${table.status} in ('draft', 'final')`),
    check('memo_documents_title_check', sql`char_length(trim(${table.title})) between 1 and 200`),
    check('memo_documents_finalized_check', sql`(${table.status} = 'draft' and ${table.finalizedAt} is null) or (${table.status} = 'final' and ${table.finalizedAt} is not null)`),
  ],
);

export const memoClaimSources = pgTable(
  'memo_claim_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memoId: uuid('memo_id')
      .notNull()
      .references(() => memoDocuments.id, { onDelete: 'cascade' }),
    claimRef: text('claim_ref').notNull(),
    sourceRecordId: uuid('source_record_id')
      .notNull()
      .references(() => sourceRecords.id, { onDelete: 'restrict' }),
  },
  (table) => [
    uniqueIndex('memo_claim_sources_claim_idx').on(table.memoId, table.claimRef, table.sourceRecordId),
    index('memo_claim_sources_source_record_id_idx').on(table.sourceRecordId),
    check('memo_claim_sources_claim_ref_check', sql`char_length(trim(${table.claimRef})) between 1 and 160`),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_actor_user_id_idx').on(table.actorUserId),
    index('audit_log_entity_idx').on(table.entityType, table.entityId),
    index('audit_log_occurred_at_idx').on(table.occurredAt),
  ],
);
