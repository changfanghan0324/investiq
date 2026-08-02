create or replace function validate_valuation_snapshot_ownership()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
      from assumption_sets
     where id = new.assumption_set_id
       and user_id = new.user_id
       and company_id = new.company_id
  ) then
    raise exception 'valuation snapshot owner/company must match its assumption set'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
--> statement-breakpoint

create trigger valuation_snapshots_ownership_check
before insert on valuation_snapshots
for each row execute function validate_valuation_snapshot_ownership();
--> statement-breakpoint

create or replace function validate_analysis_snapshot_ownership()
returns trigger
language plpgsql
as $$
begin
  if new.portfolio_id is not null and not exists (
    select 1 from portfolios where id = new.portfolio_id and user_id = new.user_id
  ) then
    raise exception 'analysis snapshot owner must match its portfolio owner'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
--> statement-breakpoint

create trigger analysis_snapshots_ownership_check
before insert on analysis_snapshots
for each row execute function validate_analysis_snapshot_ownership();
--> statement-breakpoint

create or replace function validate_memo_snapshot_ownership()
returns trigger
language plpgsql
as $$
begin
  if new.valuation_snapshot_id is not null and not exists (
    select 1
      from valuation_snapshots
     where id = new.valuation_snapshot_id
       and user_id = new.user_id
       and company_id = new.company_id
  ) then
    raise exception 'memo owner/company must match its valuation snapshot'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
--> statement-breakpoint

create trigger memo_documents_snapshot_ownership_check
before insert or update of valuation_snapshot_id on memo_documents
for each row execute function validate_memo_snapshot_ownership();
--> statement-breakpoint

create or replace function validate_peer_set_snapshot_ownership()
returns trigger
language plpgsql
as $$
begin
  if new.valuation_snapshot_id is not null and not exists (
    select 1
      from valuation_snapshots
     where id = new.valuation_snapshot_id
       and user_id = new.created_by_user_id
       and company_id = new.company_id
  ) then
    raise exception 'peer-set owner/company must match its valuation snapshot'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
--> statement-breakpoint

create trigger peer_sets_snapshot_ownership_check
before insert or update of valuation_snapshot_id on peer_sets
for each row execute function validate_peer_set_snapshot_ownership();
--> statement-breakpoint

create or replace function validate_memo_claim_ownership()
returns trigger
language plpgsql
as $$
declare
  memo_user uuid;
  memo_company uuid;
begin
  select user_id, company_id into memo_user, memo_company
    from memo_documents where id = new.memo_id;

  if not exists (
    select 1
      from source_records source
      left join valuation_snapshots valuation on valuation.id = source.valuation_snapshot_id
      left join analysis_snapshots analysis on analysis.id = source.analysis_snapshot_id
     where source.id = new.source_record_id
       and coalesce(valuation.user_id, analysis.user_id) = memo_user
       and (valuation.id is null or valuation.company_id = memo_company)
       and (analysis.id is null or analysis.company_id is null or analysis.company_id = memo_company)
  ) then
    raise exception 'memo claims may cite only sources owned by the memo author'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
--> statement-breakpoint

create trigger memo_claim_sources_ownership_check
before insert or update on memo_claim_sources
for each row execute function validate_memo_claim_ownership();
--> statement-breakpoint

create or replace function guard_portfolio_identity()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'portfolio ownership cannot be reassigned' using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint

create trigger portfolios_identity_guard
before update of user_id on portfolios
for each row execute function guard_portfolio_identity();
--> statement-breakpoint

create or replace function guard_holding_identity()
returns trigger
language plpgsql
as $$
begin
  if new.portfolio_id is distinct from old.portfolio_id
     or new.company_id is distinct from old.company_id then
    raise exception 'holding identity cannot be reassigned; delete and insert instead'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint

create trigger holdings_identity_guard
before update of portfolio_id, company_id on holdings
for each row execute function guard_holding_identity();
--> statement-breakpoint

create or replace function guard_memo_identity()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id or new.company_id is distinct from old.company_id then
    raise exception 'memo owner/company cannot be reassigned' using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint

create trigger memo_documents_identity_guard
before update of user_id, company_id on memo_documents
for each row execute function guard_memo_identity();
--> statement-breakpoint

create or replace function guard_peer_set_identity()
returns trigger
language plpgsql
as $$
begin
  if new.created_by_user_id is distinct from old.created_by_user_id
     or new.company_id is distinct from old.company_id then
    raise exception 'peer-set owner/company cannot be reassigned' using errcode = '55000';
  end if;
  return new;
end;
$$;
--> statement-breakpoint

create trigger peer_sets_identity_guard
before update of created_by_user_id, company_id on peer_sets
for each row execute function guard_peer_set_identity();
--> statement-breakpoint

create or replace function validate_portfolio_holdings()
returns trigger
language plpgsql
as $$
declare
  selected_portfolio uuid;
  holding_count integer;
  weight_total numeric;
begin
  selected_portfolio := coalesce(new.portfolio_id, old.portfolio_id);

  -- Serialize concurrent edits to the same portfolio so two transactions cannot
  -- each validate a stale count/weight total and jointly violate the contract.
  perform 1 from portfolios where id = selected_portfolio for update;

  select count(*), coalesce(sum(target_weight), 0)
    into holding_count, weight_total
    from holdings
   where portfolio_id = selected_portfolio;

  if holding_count > 10 then
    raise exception 'a portfolio cannot contain more than 10 holdings' using errcode = '23514';
  end if;
  if holding_count > 0 and abs(weight_total - 1) > 0.000001 then
    raise exception 'portfolio target weights must sum to 1' using errcode = '23514';
  end if;
  return null;
end;
$$;
