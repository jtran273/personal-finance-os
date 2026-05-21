alter table public.google_calendar_connections
  add column if not exists calendar_list jsonb not null default '[]'::jsonb,
  add column if not exists selected_calendar_ids text[] not null default array['primary']::text[];

update public.google_calendar_connections
set selected_calendar_ids = array[coalesce(nullif(google_calendar_id, ''), 'primary')]
where cardinality(selected_calendar_ids) = 0;

grant select (
  calendar_list,
  selected_calendar_ids
) on table public.google_calendar_connections to authenticated;

notify pgrst, 'reload schema';
