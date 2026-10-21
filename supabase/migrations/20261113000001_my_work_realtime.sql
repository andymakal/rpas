-- My Work live updates: enable Supabase Realtime on the tables whose changes
-- alter an employee's My Work counts, so another employee watching My Work sees
-- the counts update within seconds when work is completed/claimed, without a
-- manual refresh.
--
-- Only tables the internal-admin SESSION can read under RLS are added. The
-- browser Realtime subscription runs under the signed-in session (anon key +
-- JWT), NOT the service-role client the server composition uses, so Realtime
-- row events are filtered by each table's SELECT policy. All three tables below
-- have a `*_admin_select` policy gated on jwt_is_admin(), so the internal-admin
-- operator receives their change events.
--
--   stewardship_outreach  — the shared board: claim/release
--                           (claimed_by_producer_id), queue transitions,
--                           refused_at, submitted_at, callback_date. This is the
--                           primary completion signal.
--   customer_prereviews   — decision set = customer advanced past onboarding
--                           (suppresses the outreach row from My Work).
--   project_customers     — project membership that scopes project-filtered
--                           counts.
--
-- service_policies is intentionally NOT added: it has RLS enabled with no
-- session-readable SELECT policy, so a browser subscription would receive no
-- events for it anyway. Its sa_status onboarding-complete gate is a secondary
-- signal, and the stewardship_outreach/customer_prereviews events already cover
-- the "work completed" cases this feature targets.
--
-- REPLICA IDENTITY FULL makes UPDATE/DELETE events carry the full old row, which
-- Realtime needs to evaluate RLS and to emit a complete change payload. These
-- tables are low-volume operator work tables, so the WAL cost is negligible.

alter table public.stewardship_outreach replica identity full;
alter table public.customer_prereviews  replica identity full;
alter table public.project_customers    replica identity full;

-- Add each table to the supabase_realtime publication only if not already a
-- member, so this migration is safe to re-run.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stewardship_outreach'
  ) then
    alter publication supabase_realtime add table public.stewardship_outreach;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'customer_prereviews'
  ) then
    alter publication supabase_realtime add table public.customer_prereviews;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'project_customers'
  ) then
    alter publication supabase_realtime add table public.project_customers;
  end if;
end $$;
