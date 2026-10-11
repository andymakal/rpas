-- =============================================================================
-- IPF overlay — capability assignment provenance (replay-safety reconciliation)
-- Migration: 20261024000001_capability_source_provenance.sql
--
-- Adds the producer_work_functions.source provenance marker to the ALREADY
-- MIGRATED development database and backfills it, so that:
--
--   * the corrective migration (20261022000001) can gate its title-inferred
--     cleanup on source = 'migration_seed' and therefore NEVER delete a
--     legitimate assignment (human- or evidence-created), and
--   * the development database converges to exactly the state a fresh replay of
--     the migration chain produces.
--
-- On a FRESH database the column is created by 20261021000001 (section 3), so
-- this ADD COLUMN IF NOT EXISTS is a harmless no-op there. On the development
-- database (migrated before the column existed) this adds it and backfills.
--
-- Backfill matches the fresh-replay end-state exactly:
--   * the single demonstration-seeded row, Bob -> determination created by the
--     20261021000001 seed, is marked 'migration_seed';
--   * every other existing assignment (the evidence-based rows from
--     20261023000001, and anything a human later created) is 'manual'.
-- 'manual' is the safe default: it protects a row from the corrective cleanup.
--
-- Idempotent and guarded; safe to replay. Depends on 20261021000001 (table),
-- 20261023000001 (evidence rows). No production changes.
-- =============================================================================

-- 1. Column (no-op on a fresh DB where 20261021000001 already added it).
alter table public.producer_work_functions
  add column if not exists source text not null default 'manual';

-- Ensure the allowed-values constraint exists (name-stable, idempotent).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'producer_work_functions_source_check'
      and conrelid = 'public.producer_work_functions'::regclass
  ) then
    alter table public.producer_work_functions
      add constraint producer_work_functions_source_check
      check (source in ('migration_seed', 'manual'));
  end if;
end
$$;

comment on column public.producer_work_functions.source is
  'Provenance: ''migration_seed'' = created by a migration demonstration seed '
  '(eligible for migration cleanup); ''manual'' (default) = created by a human '
  'or an evidence-based migration (never touched by cleanup).';

-- 2. Backfill to the fresh-replay end-state.
-- First, everything is legitimate/manual by default (protects all rows).
update public.producer_work_functions
  set source = 'manual'
  where source is distinct from 'manual';

-- Then re-tag ONLY the one demonstration-seeded row that a fresh replay would
-- mark 'migration_seed': Bob -> determination, agency-wide, created by the
-- 20261021000001 seed. Guarded on the producer + capability existing. This is
-- the row the corrective migration deliberately KEEPS (it is excluded from the
-- cleanup pair-list), so tagging it changes no behavior; it simply makes the
-- development provenance identical to a fresh replay.
do $$
declare
  p_bob uuid := '55c0e564-35d1-4bcc-888d-8edaa4e2fdf7';
begin
  update public.producer_work_functions pwf
    set source = 'migration_seed'
    from public.work_functions wf
    where pwf.work_function_id = wf.id
      and wf.canonical_key = 'determination'
      and pwf.producer_id = p_bob
      and pwf.project_id is null;
end
$$;

notify pgrst, 'reload schema';
