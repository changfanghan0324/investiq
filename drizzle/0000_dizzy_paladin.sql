CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "analysis_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid,
	"portfolio_id" uuid,
	"analysis_type" text NOT NULL,
	"engine_version" text NOT NULL,
	"method_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"outputs" jsonb NOT NULL,
	"random_seed" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_snapshots_subject_check" CHECK (num_nonnulls("analysis_snapshots"."company_id", "analysis_snapshots"."portfolio_id") = 1),
	CONSTRAINT "analysis_snapshots_hash_check" CHECK ("analysis_snapshots"."input_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "assumption_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"method_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"assumptions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assumption_sets_version_check" CHECK ("assumption_sets"."version" > 0),
	CONSTRAINT "assumption_sets_hash_check" CHECK ("assumption_sets"."input_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"cik" text NOT NULL,
	"canonical_name" text NOT NULL,
	"exchange" text,
	"security_type" text,
	"sic_code" integer,
	"sic_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_ticker_format_check" CHECK ("companies"."ticker" ~ '^[A-Z0-9.-]{1,12}$'),
	CONSTRAINT "companies_cik_format_check" CHECK ("companies"."cik" ~ '^[0-9]{10}$'),
	CONSTRAINT "companies_sic_range_check" CHECK ("companies"."sic_code" is null or "companies"."sic_code" between 100 and 9999)
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"target_weight" numeric(14, 12) NOT NULL,
	"quantity" numeric(28, 8),
	"cost_basis" numeric(28, 8),
	"as_of" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holdings_weight_check" CHECK ("holdings"."target_weight" >= 0 and "holdings"."target_weight" <= 1),
	CONSTRAINT "holdings_quantity_check" CHECK ("holdings"."quantity" is null or "holdings"."quantity" >= 0),
	CONSTRAINT "holdings_cost_basis_check" CHECK ("holdings"."cost_basis" is null or "holdings"."cost_basis" >= 0)
);
--> statement-breakpoint
CREATE TABLE "memo_claim_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memo_id" uuid NOT NULL,
	"claim_ref" text NOT NULL,
	"source_record_id" uuid NOT NULL,
	CONSTRAINT "memo_claim_sources_claim_ref_check" CHECK (char_length(trim("memo_claim_sources"."claim_ref")) between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "memo_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"valuation_snapshot_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"model_name" text,
	"model_version" text,
	"prompt_hash" text,
	"context_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "memo_documents_status_check" CHECK ("memo_documents"."status" in ('draft', 'final')),
	CONSTRAINT "memo_documents_title_check" CHECK (char_length(trim("memo_documents"."title")) between 1 and 200),
	CONSTRAINT "memo_documents_finalized_check" CHECK (("memo_documents"."status" = 'draft' and "memo_documents"."finalized_at" is null) or ("memo_documents"."status" = 'final' and "memo_documents"."finalized_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "peer_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"peer_set_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"score" numeric(18, 10),
	"decision" text DEFAULT 'pending' NOT NULL,
	"score_components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"override_reason" text,
	CONSTRAINT "peer_members_decision_check" CHECK ("peer_members"."decision" in ('pending', 'include', 'exclude')),
	CONSTRAINT "peer_members_score_check" CHECK ("peer_members"."score" is null or "peer_members"."score" >= 0),
	CONSTRAINT "peer_members_override_check" CHECK ("peer_members"."decision" = 'pending' or char_length(trim(coalesce("peer_members"."override_reason", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "peer_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"valuation_snapshot_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"method_version" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "peer_sets_status_check" CHECK ("peer_sets"."status" in ('draft', 'final')),
	CONSTRAINT "peer_sets_finalized_check" CHECK (("peer_sets"."status" = 'draft' and "peer_sets"."finalized_at" is null) or ("peer_sets"."status" = 'final' and "peer_sets"."finalized_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base_currency" text DEFAULT 'USD' NOT NULL,
	"benchmark_ticker" text DEFAULT 'SPY' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolios_name_check" CHECK (char_length(trim("portfolios"."name")) between 1 and 120),
	CONSTRAINT "portfolios_currency_check" CHECK ("portfolios"."base_currency" = 'USD'),
	CONSTRAINT "portfolios_benchmark_check" CHECK ("portfolios"."benchmark_ticker" ~ '^[A-Z0-9.-]{1,12}$')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"valuation_snapshot_id" uuid,
	"analysis_snapshot_id" uuid,
	"source_type" text NOT NULL,
	"source_url" text NOT NULL,
	"accession" text,
	"reporting_period" date,
	"retrieved_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "source_records_parent_check" CHECK (num_nonnulls("source_records"."valuation_snapshot_id", "source_records"."analysis_snapshot_id") = 1),
	CONSTRAINT "source_records_hash_check" CHECK ("source_records"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "valuation_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assumption_set_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"engine_version" text NOT NULL,
	"method_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"outputs" jsonb NOT NULL,
	"random_seed" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valuation_snapshots_hash_check" CHECK ("valuation_snapshots"."input_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_snapshots" ADD CONSTRAINT "analysis_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_snapshots" ADD CONSTRAINT "analysis_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_snapshots" ADD CONSTRAINT "analysis_snapshots_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assumption_sets" ADD CONSTRAINT "assumption_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assumption_sets" ADD CONSTRAINT "assumption_sets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memo_claim_sources" ADD CONSTRAINT "memo_claim_sources_memo_id_memo_documents_id_fk" FOREIGN KEY ("memo_id") REFERENCES "public"."memo_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memo_claim_sources" ADD CONSTRAINT "memo_claim_sources_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memo_documents" ADD CONSTRAINT "memo_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memo_documents" ADD CONSTRAINT "memo_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memo_documents" ADD CONSTRAINT "memo_documents_valuation_snapshot_id_valuation_snapshots_id_fk" FOREIGN KEY ("valuation_snapshot_id") REFERENCES "public"."valuation_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_members" ADD CONSTRAINT "peer_members_peer_set_id_peer_sets_id_fk" FOREIGN KEY ("peer_set_id") REFERENCES "public"."peer_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_members" ADD CONSTRAINT "peer_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_sets" ADD CONSTRAINT "peer_sets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_sets" ADD CONSTRAINT "peer_sets_valuation_snapshot_id_valuation_snapshots_id_fk" FOREIGN KEY ("valuation_snapshot_id") REFERENCES "public"."valuation_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_sets" ADD CONSTRAINT "peer_sets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_valuation_snapshot_id_valuation_snapshots_id_fk" FOREIGN KEY ("valuation_snapshot_id") REFERENCES "public"."valuation_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_analysis_snapshot_id_analysis_snapshots_id_fk" FOREIGN KEY ("analysis_snapshot_id") REFERENCES "public"."analysis_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_snapshots" ADD CONSTRAINT "valuation_snapshots_assumption_set_id_assumption_sets_id_fk" FOREIGN KEY ("assumption_set_id") REFERENCES "public"."assumption_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_snapshots" ADD CONSTRAINT "valuation_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_snapshots" ADD CONSTRAINT "valuation_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "analysis_snapshots_user_id_idx" ON "analysis_snapshots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "analysis_snapshots_company_id_idx" ON "analysis_snapshots" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "analysis_snapshots_portfolio_id_idx" ON "analysis_snapshots" USING btree ("portfolio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_snapshots_user_type_hash_idx" ON "analysis_snapshots" USING btree ("user_id","analysis_type","input_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "assumption_sets_company_user_version_idx" ON "assumption_sets" USING btree ("company_id","user_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "assumption_sets_input_hash_idx" ON "assumption_sets" USING btree ("user_id","company_id","input_hash");--> statement-breakpoint
CREATE INDEX "assumption_sets_user_id_idx" ON "assumption_sets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "assumption_sets_company_id_idx" ON "assumption_sets" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_user_id_idx" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_ticker_idx" ON "companies" USING btree ("ticker");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_cik_idx" ON "companies" USING btree ("cik");--> statement-breakpoint
CREATE UNIQUE INDEX "holdings_portfolio_company_idx" ON "holdings" USING btree ("portfolio_id","company_id");--> statement-breakpoint
CREATE INDEX "holdings_company_id_idx" ON "holdings" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memo_claim_sources_claim_idx" ON "memo_claim_sources" USING btree ("memo_id","claim_ref","source_record_id");--> statement-breakpoint
CREATE INDEX "memo_claim_sources_source_record_id_idx" ON "memo_claim_sources" USING btree ("source_record_id");--> statement-breakpoint
CREATE INDEX "memo_documents_user_id_idx" ON "memo_documents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memo_documents_company_id_idx" ON "memo_documents" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "memo_documents_valuation_snapshot_id_idx" ON "memo_documents" USING btree ("valuation_snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "peer_members_peer_set_company_idx" ON "peer_members" USING btree ("peer_set_id","company_id");--> statement-breakpoint
CREATE INDEX "peer_members_company_id_idx" ON "peer_members" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "peer_sets_company_id_idx" ON "peer_sets" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "peer_sets_valuation_snapshot_id_idx" ON "peer_sets" USING btree ("valuation_snapshot_id");--> statement-breakpoint
CREATE INDEX "peer_sets_created_by_user_id_idx" ON "peer_sets" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "portfolios_user_id_idx" ON "portfolios" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires");--> statement-breakpoint
CREATE INDEX "source_records_valuation_snapshot_id_idx" ON "source_records" USING btree ("valuation_snapshot_id");--> statement-breakpoint
CREATE INDEX "source_records_analysis_snapshot_id_idx" ON "source_records" USING btree ("analysis_snapshot_id");--> statement-breakpoint
CREATE INDEX "source_records_accession_idx" ON "source_records" USING btree ("accession");--> statement-breakpoint
CREATE UNIQUE INDEX "valuation_snapshots_user_hash_idx" ON "valuation_snapshots" USING btree ("user_id","company_id","input_hash");--> statement-breakpoint
CREATE INDEX "valuation_snapshots_assumption_set_id_idx" ON "valuation_snapshots" USING btree ("assumption_set_id");--> statement-breakpoint
CREATE INDEX "valuation_snapshots_company_id_idx" ON "valuation_snapshots" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_tokens_token_idx" ON "verification_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "verification_tokens_expires_idx" ON "verification_tokens" USING btree ("expires");