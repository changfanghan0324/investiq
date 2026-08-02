create or replace function reject_immutable_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;
--> statement-breakpoint

create trigger assumption_sets_immutable
before update or delete on assumption_sets
for each row execute function reject_immutable_mutation();
--> statement-breakpoint
create trigger valuation_snapshots_immutable
before update or delete on valuation_snapshots
for each row execute function reject_immutable_mutation();
--> statement-breakpoint
create trigger analysis_snapshots_immutable
before update or delete on analysis_snapshots
for each row execute function reject_immutable_mutation();
--> statement-breakpoint
create trigger source_records_immutable
before update or delete on source_records
for each row execute function reject_immutable_mutation();
--> statement-breakpoint
create trigger audit_log_immutable
before update or delete on audit_log
for each row execute function reject_immutable_mutation();
--> statement-breakpoint

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
--> statement-breakpoint

create trigger users_set_updated_at before update on users
for each row execute function set_updated_at();
--> statement-breakpoint
create trigger companies_set_updated_at before update on companies
for each row execute function set_updated_at();
--> statement-breakpoint
create trigger portfolios_set_updated_at before update on portfolios
for each row execute function set_updated_at();
--> statement-breakpoint
create trigger holdings_set_updated_at before update on holdings
for each row execute function set_updated_at();
--> statement-breakpoint
create trigger memo_documents_set_updated_at before update on memo_documents
for each row execute function set_updated_at();
--> statement-breakpoint

create or replace function guard_finalized_memo()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'final' then
    raise exception 'final memo documents are immutable' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
--> statement-breakpoint

create trigger memo_documents_final_guard
before update or delete on memo_documents
for each row execute function guard_finalized_memo();
--> statement-breakpoint

create or replace function guard_finalized_peer_set()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'final' then
    raise exception 'final peer sets are immutable' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
--> statement-breakpoint

create trigger peer_sets_final_guard
before update or delete on peer_sets
for each row execute function guard_finalized_peer_set();
--> statement-breakpoint

create or replace function guard_finalized_peer_member()
returns trigger
language plpgsql
as $$
declare
  selected_peer_set uuid;
begin
  selected_peer_set := case when tg_op = 'DELETE' then old.peer_set_id else new.peer_set_id end;
  if exists (select 1 from peer_sets where id = selected_peer_set and status = 'final') then
    raise exception 'members of a final peer set are immutable' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
--> statement-breakpoint

create trigger peer_members_final_guard
before insert or update or delete on peer_members
for each row execute function guard_finalized_peer_member();
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
--> statement-breakpoint

create constraint trigger holdings_portfolio_contract
after insert or update or delete on holdings
deferrable initially deferred
for each row execute function validate_portfolio_holdings();
--> statement-breakpoint

create unique index users_email_lower_idx on users (lower(email));
