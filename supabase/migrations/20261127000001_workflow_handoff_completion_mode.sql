-- =============================================================================
-- Workflow completion_mode: add the explicit baton-release flavor ('handoff')
-- Migration: 20261127000001_workflow_handoff_completion_mode.sql
--
-- workflows.completion_mode records HOW a workflow (a phase) decides it is done
-- for a given customer. Two flavors existed:
--
--   'automatic' — completion is derived from authoritative business facts; the
--                 system advances the customer to the next phase with no human
--                 confirmation (e.g. servicing access already confirmed on the
--                 applicable policies).
--   'manual'    — completion requires a recorded human judgment/determination
--                 (e.g. the producer's Candidate / Not a Candidate decision).
--
-- Operating the relay surfaced a THIRD, distinct case that is neither: a phase
-- whose work is factually finished (derivable, like "all signatures collected")
-- but whose HANDOFF to the next phase should be a deliberate, visible act rather
-- than a silent auto-advance. The work is not re-litigated; the baton pass is an
-- explicit release so nothing disappears behind the operator's back.
--
--   'handoff'   — auto-ready, human-releases. The facts mark the phase READY to
--                 hand off; advancement waits for one explicit recorded release
--                 ("Ready to hand to the back office? Yes"). The specific
--                 readiness fact logic lives in code, keyed on workflows.key,
--                 exactly like the other two flavors; this column states only
--                 which KIND of completion the workflow uses.
--
-- This migration only widens the CHECK constraint. It changes no existing rows
-- (both seeded workflows keep their current mode) and adds no columns, so it is
-- a pure, backward-compatible constraint relaxation. Idempotent: it drops the
-- old constraint if present and recreates the widened one.
--
-- Depends on: workflows (20261102000001_project_workflows.sql).
-- =============================================================================

alter table public.workflows
  drop constraint if exists workflows_completion_mode_check;

alter table public.workflows
  add constraint workflows_completion_mode_check
  check (completion_mode in ('automatic', 'manual', 'handoff'));

comment on column public.workflows.completion_mode is
  'How this workflow (phase) decides per-customer completion and advancement: '
  '''automatic'' derives completion from business facts and advances with no '
  'human step; ''manual'' requires a recorded human determination; ''handoff'' '
  'is auto-ready + explicit human release (the facts mark it ready to hand off, '
  'advancement waits for one deliberate recorded release). The readiness/'
  'completion fact logic lives in code keyed on workflows.key; this column '
  'states only which kind of completion the workflow uses.';

-- Refresh PostgREST's schema cache so the widened constraint is visible.
notify pgrst, 'reload schema';
