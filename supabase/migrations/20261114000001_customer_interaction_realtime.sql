-- Customer Interaction: make case_touches changes drive My Work's live refresh.
--
-- The Customer Interaction step (the stage between routine calling/outreach and
-- Servicing Access) counts customers who have genuinely engaged but have not yet
-- returned the signed authorization. A genuine incoming response is recorded in
-- case_touches and also stamps the engagement marker on
-- stewardship_outreach.action_context; the engagement change on
-- stewardship_outreach already refreshes My Work. Recording interactions
-- (responses, replies, notes, follow-ups) lands in case_touches, so adding that
-- table to the realtime publication keeps the step's count and the customer's
-- live history current as conversations are worked, without a manual reload.
--
-- REPLICA IDENTITY FULL makes UPDATE/DELETE events carry the full old row, which
-- Realtime needs to evaluate RLS and to emit a complete change payload. This is
-- a low-volume operator work table, so the WAL cost is negligible. Matches the
-- My Work realtime migration (20261113000001) for the other work tables.

alter table public.case_touches replica identity full;

-- Add case_touches to the supabase_realtime publication only if not already a
-- member, so this migration is safe to re-run.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'case_touches'
  ) then
    alter publication supabase_realtime add table public.case_touches;
  end if;
end $$;
