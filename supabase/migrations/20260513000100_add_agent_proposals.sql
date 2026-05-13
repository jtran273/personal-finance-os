do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'agent_proposal_status'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.agent_proposal_status as enum (
      'pending',
      'accepted',
      'dismissed',
      'expired',
      'answered'
    );
  end if;

  if not exists (
    select 1
    from pg_type
    where typname = 'agent_proposal_type'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.agent_proposal_type as enum (
      'review_suggestion',
      'merchant_rule',
      'possible_reimbursable_expense',
      'reimbursement_candidate',
      'reimbursement_match',
      'safe_to_spend_warning',
      'clarification_request'
    );
  end if;

  if not exists (
    select 1
    from pg_type
    where typname = 'agent_target_kind'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.agent_target_kind as enum (
      'review_item',
      'enriched_transaction',
      'reimbursement_record',
      'merchant_rule',
      'recurring_expense'
    );
  end if;
end $$;

create table if not exists public.agent_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  proposal_type public.agent_proposal_type not null,
  target_kind public.agent_target_kind not null,
  target_id uuid not null,
  evidence jsonb not null default '{}'::jsonb,
  confidence numeric(5, 4),
  proposed_patch jsonb not null default '{}'::jsonb,
  status public.agent_proposal_status not null default 'pending',
  clarification_question text,
  clarification_answer text,
  clarification_answer_kind text,
  question_fingerprint text,
  source_context_id text,
  source_candidate_id text,
  source_agent text not null,
  expires_at timestamptz,
  accepted_at timestamptz,
  dismissed_at timestamptz,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_proposals_id_user_id_unique unique (id, user_id),
  constraint agent_proposals_source_agent_not_blank check (length(btrim(source_agent)) > 0),
  constraint agent_proposals_confidence_range check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint agent_proposals_evidence_object check (jsonb_typeof(evidence) = 'object'),
  constraint agent_proposals_patch_object check (jsonb_typeof(proposed_patch) = 'object'),
  constraint agent_proposals_clarification_question_required check (
    proposal_type <> 'clarification_request'
    or clarification_question is not null
  )
);

create index if not exists agent_proposals_user_status_created_idx
  on public.agent_proposals (user_id, status, created_at desc);

create index if not exists agent_proposals_user_target_idx
  on public.agent_proposals (user_id, target_kind, target_id);

create index if not exists agent_proposals_user_question_fingerprint_idx
  on public.agent_proposals (user_id, question_fingerprint)
  where question_fingerprint is not null;

alter table public.agent_proposals enable row level security;

do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null
    and not exists (
      select 1
      from pg_trigger
      where tgname = 'agent_proposals_set_updated_at'
        and tgrelid = 'public.agent_proposals'::regclass
    )
  then
    create trigger agent_proposals_set_updated_at
      before update on public.agent_proposals
      for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_proposals'
      and policyname = 'agent_proposals_select_own'
  ) then
    create policy agent_proposals_select_own
      on public.agent_proposals
      for select to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_proposals'
      and policyname = 'agent_proposals_insert_own'
  ) then
    create policy agent_proposals_insert_own
      on public.agent_proposals
      for insert to authenticated
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_proposals'
      and policyname = 'agent_proposals_update_own'
  ) then
    create policy agent_proposals_update_own
      on public.agent_proposals
      for update to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_proposals'
      and policyname = 'agent_proposals_delete_own'
  ) then
    create policy agent_proposals_delete_own
      on public.agent_proposals
      for delete to authenticated
      using (auth.uid() = user_id);
  end if;
end $$;

notify pgrst, 'reload schema';
