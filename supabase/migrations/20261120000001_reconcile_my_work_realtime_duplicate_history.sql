-- Reconcile a duplicated migration-history row in production.
--
-- Production's `supabase_migrations.schema_migrations` ledger recorded the
-- "my_work_realtime" feature TWICE:
--
--   20261021173902  my_work_realtime   <- stale, interleaved-timestamp copy,
--                                         no matching repository file
--   20261113000001  my_work_realtime   <- the canonical row, owned by the repo
--                                         file 20261113000001_my_work_realtime.sql
--
-- The stale 20261021173902 row predates the repository's clean, source-
-- controlled version of the feature. Its schema effect (adding
-- stewardship_outreach, customer_prereviews, and project_customers to the
-- supabase_realtime publication, plus REPLICA IDENTITY FULL on those tables) is
-- already present in production and is owned by the canonical 20261113000001
-- migration, which remains. The stale row has no repository counterpart, so
-- `supabase migration list` reports it as a remote-only version and a future
-- `db push` would treat the history as inconsistent.
--
-- This migration removes ONLY the redundant 20261021173902 ledger row. It does
-- NOT touch the publication, the tables, any data, permissions, or the
-- canonical 20261113000001 row. It is purely a history-ledger correction.
--
-- The delete is guarded so it only runs when the canonical row still exists,
-- which guarantees we never remove the sole record of the feature. It is
-- idempotent: re-running it is a no-op once the stale row is gone.

do $$
begin
  if exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20261113000001' and name = 'my_work_realtime'
  ) then
    delete from supabase_migrations.schema_migrations
    where version = '20261021173902' and name = 'my_work_realtime';
  end if;
end $$;
