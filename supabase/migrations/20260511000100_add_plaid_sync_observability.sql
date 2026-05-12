do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'plaid_sync_run_source'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.plaid_sync_run_source as enum (
      'initial',
      'manual',
      'scheduled'
    );
  end if;

  if not exists (
    select 1
    from pg_type
    where typname = 'plaid_sync_run_status'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.plaid_sync_run_status as enum (
      'running',
      'succeeded',
      'partial',
      'failed'
    );
  end if;
end $$;

create table if not exists public.plaid_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source public.plaid_sync_run_source not null,
  status public.plaid_sync_run_status not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  total_items integer not null default 0,
  succeeded_items integer not null default 0,
  failed_items integer not null default 0,
  accounts_upserted integer not null default 0,
  balance_snapshots_upserted integer not null default 0,
  raw_transactions_upserted integer not null default 0,
  raw_transactions_skipped integer not null default 0,
  enriched_transactions_inserted integer not null default 0,
  enriched_transactions_updated integer not null default 0,
  transactions_removed integer not null default 0,
  safe_error_code text,
  safe_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plaid_sync_runs_id_user_id_unique unique (id, user_id),
  constraint plaid_sync_runs_item_counts_non_negative check (
    total_items >= 0 and succeeded_items >= 0 and failed_items >= 0
  ),
  constraint plaid_sync_runs_count_totals_match check (succeeded_items + failed_items <= total_items),
  constraint plaid_sync_runs_row_counts_non_negative check (
    accounts_upserted >= 0
    and balance_snapshots_upserted >= 0
    and raw_transactions_upserted >= 0
    and raw_transactions_skipped >= 0
    and enriched_transactions_inserted >= 0
    and enriched_transactions_updated >= 0
    and transactions_removed >= 0
  )
);

create table if not exists public.plaid_sync_run_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  sync_run_id uuid not null,
  plaid_item_id uuid not null,
  status public.plaid_sync_run_status not null,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  accounts_upserted integer not null default 0,
  balance_snapshots_upserted integer not null default 0,
  raw_transactions_upserted integer not null default 0,
  raw_transactions_skipped integer not null default 0,
  enriched_transactions_inserted integer not null default 0,
  enriched_transactions_updated integer not null default 0,
  transactions_removed integer not null default 0,
  safe_error_code text,
  safe_error_message text,
  last_successful_sync_at timestamptz,
  created_at timestamptz not null default now(),
  constraint plaid_sync_run_items_run_user_fk foreign key (sync_run_id, user_id)
    references public.plaid_sync_runs (id, user_id) on delete cascade,
  constraint plaid_sync_run_items_plaid_item_user_fk foreign key (plaid_item_id, user_id)
    references public.plaid_items (id, user_id) on delete cascade,
  constraint plaid_sync_run_items_one_per_item unique (sync_run_id, plaid_item_id),
  constraint plaid_sync_run_items_final_status check (status in ('succeeded', 'failed')),
  constraint plaid_sync_run_items_row_counts_non_negative check (
    accounts_upserted >= 0
    and balance_snapshots_upserted >= 0
    and raw_transactions_upserted >= 0
    and raw_transactions_skipped >= 0
    and enriched_transactions_inserted >= 0
    and enriched_transactions_updated >= 0
    and transactions_removed >= 0
  )
);

create index if not exists plaid_sync_runs_user_started_idx
  on public.plaid_sync_runs (user_id, started_at desc);

create index if not exists plaid_sync_run_items_user_run_idx
  on public.plaid_sync_run_items (user_id, sync_run_id);

create index if not exists plaid_sync_run_items_user_item_completed_idx
  on public.plaid_sync_run_items (user_id, plaid_item_id, completed_at desc);

alter table public.plaid_sync_runs enable row level security;
alter table public.plaid_sync_run_items enable row level security;

do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null
    and not exists (
      select 1
      from pg_trigger
      where tgname = 'plaid_sync_runs_set_updated_at'
        and tgrelid = 'public.plaid_sync_runs'::regclass
    )
  then
    create trigger plaid_sync_runs_set_updated_at
      before update on public.plaid_sync_runs
      for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'plaid_sync_runs'
      and policyname = 'plaid_sync_runs_select_own'
  ) then
    create policy plaid_sync_runs_select_own
      on public.plaid_sync_runs
      for select to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'plaid_sync_runs'
      and policyname = 'plaid_sync_runs_insert_own'
  ) then
    create policy plaid_sync_runs_insert_own
      on public.plaid_sync_runs
      for insert to authenticated
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'plaid_sync_runs'
      and policyname = 'plaid_sync_runs_update_own'
  ) then
    create policy plaid_sync_runs_update_own
      on public.plaid_sync_runs
      for update to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'plaid_sync_runs'
      and policyname = 'plaid_sync_runs_delete_own'
  ) then
    create policy plaid_sync_runs_delete_own
      on public.plaid_sync_runs
      for delete to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'plaid_sync_run_items'
      and policyname = 'plaid_sync_run_items_select_own'
  ) then
    create policy plaid_sync_run_items_select_own
      on public.plaid_sync_run_items
      for select to authenticated
      using (auth.uid() = user_id);
  end if;
end $$;

notify pgrst, 'reload schema';
