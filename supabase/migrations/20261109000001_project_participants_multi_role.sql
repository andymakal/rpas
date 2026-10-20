-- =============================================================================
-- Project participants: MULTIPLE responsibilities per person
-- Migration: 20261109000001_project_participants_multi_role.sql
--
-- project_participants previously carried ONE responsibility per participant in
-- the text column `role`. A participant can genuinely hold several project
-- responsibilities at once (e.g. project owner AND operations manager AND
-- producer), so this adds a SET of responsibilities on the SAME participant row:
--
--   project_participants.roles text[]   -- the participant's project
--                                          responsibilities, e.g.
--                                          {project_owner, operations_manager}.
--
-- This REUSES the existing team structure: still one row per
-- (project_id, producer_id), the unique constraint and the escalation
-- relationship are untouched. It is not a second table and not a second source
-- of truth.
--
-- Separation of previously-combined responsibilities: the legacy value 'owner'
-- meant "project owner AND operations manager" in one token. Those are now
-- INDEPENDENT responsibilities, so the backfill expands 'owner' into both
-- 'project_owner' and 'operations_manager'.
--
-- Operations escalation is NOT a stored role. Who escalation goes to lives in
-- project_escalation_contacts (tier 1 = first destination) and remains the
-- single source of truth; the legacy 'operations_escalation' role token is
-- therefore dropped from the stored set on backfill (the person keeps their
-- escalation-path row, which is where that fact belongs). The UI derives the
-- "Operations escalation" responsibility from the escalation path.
--
-- The old `role` column is retained for now (back-compat for any unmigrated
-- reader) but is no longer authoritative; the app reads/writes `roles`.
-- Preserves every existing assignment across all projects. Idempotent.
--
-- Depends on 20261021000001_ipf_work_overlay (project_participants).
-- =============================================================================

alter table public.project_participants
  add column if not exists roles text[] not null default '{}';

comment on column public.project_participants.roles is
  'The participant''s SET of project responsibilities (e.g. {project_owner, '
  'operations_manager, producer}). A project responsibility, kept distinct from '
  'job title, licensing facts, and capability/work-routing. Operations '
  'escalation is NOT stored here — it lives in project_escalation_contacts. '
  'Supersedes the legacy single-value `role` column.';

-- Backfill from the legacy single `role`, only where roles has not been set yet
-- (so a replay after real multi-role data exists never clobbers it).
update public.project_participants
   set roles = case
     when role is null                     then '{}'::text[]
     when role = 'owner'                   then array['project_owner','operations_manager']
     when role = 'operations_escalation'   then '{}'::text[]  -- derived from escalation path
     else array[role]
   end
 where roles = '{}'::text[];

notify pgrst, 'reload schema';
