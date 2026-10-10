-- =============================================================================
-- Projects lifecycle — ARCHIVE / RESTORE (plus the audit for complete/reopen)
-- Migration: 20261020000001_projects_lifecycle_archive.sql
--
-- Adds project maintenance to the existing active <-> completed lifecycle:
--
--   * Archive  — take a project out of the normal working lists without
--                deleting any records. Allowed from active OR completed.
--   * Restore  — return an archived project to the EXACT state it had before
--                archiving (active or completed), using previous_status.
--
-- Edit (rename / re-describe), Mark Complete, and Reopen are pure column
-- updates on the existing name / description / status / completed_* columns and
-- need no new schema; the only new audit this migration adds is for archiving.
--
-- NOTHING IS EVER DELETED. Archive/Restore is a soft status change on the
-- projects row. Every child FK (project_runs, project_customers,
-- project_matches via runs, policy_documents, project_customer_reviews) is
-- ON DELETE CASCADE and is left completely untouched by a status change, so all
-- runs, memberships, matches, documents, workflow history, and customer
-- relationships are preserved across archive and restore.
--
-- Two constraints must change together (verified against the live development
-- branch: setting status='archived' today fails 23514 on
-- projects_completed_consistency, because 'archived' matches neither existing
-- clause):
--   1. the status CHECK is widened to include 'archived';
--   2. projects_completed_consistency is rewritten so the lifecycle columns stay
--      honest for all three states.
--
-- Depends on: 20261008230000_projects_foundation.sql (the projects table, its
--             status CHECK, and projects_completed_consistency). Idempotent and
--             safe to re-run.
-- =============================================================================


-- =============================================================================
-- 1. NEW LIFECYCLE COLUMNS
-- archived_at / archived_by mirror the existing completed_at / completed_by
-- audit pair. previous_status records what the project was (active | completed)
-- immediately before archiving, so Restore returns it to that exact state
-- instead of guessing. All nullable: they are set only while archived.
-- =============================================================================
alter table public.projects
  add column if not exists archived_at     timestamptz,
  add column if not exists archived_by     uuid references auth.users (id) on delete set null,
  add column if not exists previous_status text
    check (previous_status in ('active', 'completed'));

comment on column public.projects.archived_at is
  'Set when the project is archived (removed from normal working lists without '
  'deleting any records); null otherwise. Cleared on restore.';

comment on column public.projects.previous_status is
  'The status the project held immediately before archiving (active | '
  'completed). Restore returns the project to exactly this state. Null unless '
  'archived.';


-- =============================================================================
-- 2. WIDEN THE STATUS CHECK — add 'archived'
-- The foundation migration declared the status check INLINE
-- (status text ... check (status in ('active','completed'))), so Postgres gave
-- it a generated name (typically projects_status_check). Rather than assume the
-- generated name, discover every CHECK constraint on public.projects whose
-- definition references the status column and whose allowed set does NOT yet
-- include 'archived', drop it, then add a single explicitly-named replacement.
-- This is name-agnostic and idempotent (re-running finds nothing to drop).
-- =============================================================================
do $$
declare
  c record;
begin
  for c in
    select con.conname, pg_get_constraintdef(con.oid) as def
    from   pg_constraint con
    join   pg_class     rel on rel.oid = con.conrelid
    join   pg_namespace nsp on nsp.oid = rel.relnamespace
    where  nsp.nspname = 'public'
      and  rel.relname = 'projects'
      and  con.contype = 'c'
      and  pg_get_constraintdef(con.oid) ilike '%status%'
      and  pg_get_constraintdef(con.oid) not ilike '%archived%'
  loop
    execute format('alter table public.projects drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.projects
  drop constraint if exists projects_status_check;

alter table public.projects
  add constraint projects_status_check
  check (status in ('active', 'completed', 'archived'));


-- =============================================================================
-- 3. REWRITE THE LIFECYCLE CONSISTENCY CONSTRAINT
-- Keep the lifecycle columns honest across all three states:
--   active    : not completed, not archived.
--   completed : carries completed_at, not archived.
--   archived  : carries archived_at and previous_status (what to restore to).
-- A completed-then-archived project keeps its completed_at (so Restore can put
-- it back to completed with its original completion intact) but is only valid
-- while previous_status = 'completed'.
-- =============================================================================
alter table public.projects
  drop constraint if exists projects_completed_consistency;

alter table public.projects
  add constraint projects_completed_consistency check (
    (status = 'active'    and completed_at is null     and archived_at is null and previous_status is null)
    or
    (status = 'completed' and completed_at is not null and archived_at is null and previous_status is null)
    or
    (status = 'archived'  and archived_at is not null  and previous_status is not null
      and (
        (previous_status = 'active'    and completed_at is null) or
        (previous_status = 'completed' and completed_at is not null)
      ))
  );


-- =============================================================================
-- 4. INDEX
-- projects_status_idx (from the foundation migration) already covers filtering
-- by status, including the new 'archived' value, so no new index is required.
-- =============================================================================


-- Refresh PostgREST's schema cache so the new columns are visible via the API
-- immediately.
notify pgrst, 'reload schema';
