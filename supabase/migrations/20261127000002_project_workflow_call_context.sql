-- =============================================================================
-- Call-context catalog — the per-(project type, workflow/phase) content that
-- feeds the outbound call panel's "why you're calling", talk path, and mentoring
-- Migration: 20261127000002_project_workflow_call_context.sql
--
-- The guided outbound call PANEL (OutreachCallPanel) is one reusable Lego panel:
-- it dials, asks "reached or not", and progressively reveals the next step. It
-- is situation-INDEPENDENT. What differs from one situation to the next is a
-- small bundle of CONTENT:
--
--   - the REASON for the call (the short "why this call, on this workflow"
--     mentoring the purple cap reveals),
--   - the TALK PATH (the opening script the worker reads before/while dialing),
--   - the MENTORING (coaching prose, kept distinct from the Assistant).
--
-- Today that content is hardcoded in OutreachCallPanel (callMentorBody and the
-- SERVICING_CALL_SCRIPTS opening script), which is correct for the one
-- situation shipped so far. The panel's own comments name this the CONTENT SEAM:
-- "later the same prop can be filled by a situation/ZEN-selected catalog entry
-- without any change to the Lego or the panel layout." This table IS that
-- catalog.
--
-- KEY: (project_type_id, workflow_id). A phase is a workflow row; a project
-- defines its ordered phases in project_workflows. The SAME phase
-- (e.g. servicing_agent_onboarding) can read differently in a Permanent Policy
-- Review than in an Inherited-Annuity project, so the content is keyed by the
-- PAIR, not by workflow alone. When a project type has no row for a phase, the
-- panel falls back to its built-in default (no regression for situations not
-- yet in the catalog).
--
-- This is CONTENT, not a decision. ZEN still owns judgment (eligibility to
-- advance, is-this-call-due); this table only supplies the words the panel
-- renders. It deliberately does NOT store interpolated text: the talk path
-- names an existing script KEY (interpolated at render exactly as today, so the
-- caller's and customer's names fill in live), and the reason/mentoring bodies
-- carry a {first_name} token the resolver fills, matching the current behavior.
--
-- Depends on: project_types (20261009000001), workflows (20261102000001),
--             set_updated_at(), jwt_is_admin().
-- =============================================================================

create table if not exists public.project_workflow_call_context (
  id               uuid primary key default gen_random_uuid(),

  -- The situation coordinate: project TYPE + the WORKFLOW (phase). Content is
  -- reused by every project OF that type, for that phase.
  project_type_id  uuid not null references public.project_types (id) on delete cascade,
  workflow_id      uuid not null references public.workflows (id)     on delete cascade,

  -- The purple-cap "why you're calling" reason. May contain a {first_name}
  -- token the resolver fills; falls back to "the customer" when unknown.
  reason_body      text not null,

  -- The opening talk path. Rather than duplicate interpolated script text, this
  -- names a stable script KEY the app already owns (SERVICING_CALL_SCRIPTS),
  -- interpolated at render with the caller/customer identity, exactly as today.
  talk_path_script_key text not null default 'opening',

  -- The coaching prose shown as Mentoring (distinct surface from the Assistant).
  -- May contain a {first_name} token. Optional: when null, the panel shows no
  -- extra mentoring block beyond the reason cap.
  mentoring_body   text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.project_workflow_call_context is
  'Per-(project type, workflow/phase) CONTENT for the reusable outbound call '
  'panel: the reason the cap reveals, the opening talk-path script key, and the '
  'mentoring prose. Keyed by (project_type_id, workflow_id) so the same phase '
  'can read differently across project types. Content only — ZEN still owns the '
  'advance/eligibility decisions. Missing row = the panel uses its built-in '
  'default, so uncatalogued situations never regress.';

comment on column public.project_workflow_call_context.talk_path_script_key is
  'Stable key into the app''s SERVICING_CALL_SCRIPTS (e.g. ''opening''), '
  'interpolated at render with the caller/customer identity. Never stores '
  'pre-interpolated text.';

-- One content row per (project type, phase).
create unique index if not exists project_workflow_call_context_key
  on public.project_workflow_call_context (project_type_id, workflow_id);

create index if not exists project_workflow_call_context_workflow_idx
  on public.project_workflow_call_context (workflow_id);

create trigger project_workflow_call_context_set_updated_at
  before update on public.project_workflow_call_context
  for each row execute function public.set_updated_at();


-- =============================================================================
-- SEED — the one situation shipped today: Permanent Policy Review ×
-- Servicing Agent Onboarding. The reason/mentoring bodies reproduce the wording
-- currently hardcoded in OutreachCallPanel.callMentorBody, with {first_name} as
-- the fill token. Scoped by the fixed workflow id and resolved project-type id;
-- idempotent via the unique key.
-- =============================================================================
do $$
declare
  v_ptype    uuid;
  v_onboard  uuid := 'c0f10000-0000-4000-8000-000000000001';  -- servicing_agent_onboarding
begin
  select id into v_ptype
    from public.project_types
   where name = 'Permanent Policy Review';

  if v_ptype is not null then
    insert into public.project_workflow_call_context
      (project_type_id, workflow_id, reason_body, talk_path_script_key, mentoring_body)
    values (
      v_ptype,
      v_onboard,
      'Our office lost access to {first_name}''s life insurance policy when Allstate''s life business '
      'moved to Everlake, because we are not listed as the servicing agent. The servicing-agent '
      'authorization simply restores our access to help with questions and servicing. It does not '
      'change the policy or coverage, and it needs a wet (ink) signature.',
      'opening',
      'You are calling to restore servicing-agent access, not to sell. Lead with the access reason, '
      'reassure that signing changes nothing about their policy or coverage, and ask for the wet '
      'signature. If they are not ready, offer to send the form so they can review it first.'
    )
    on conflict (project_type_id, workflow_id) do nothing;
  end if;
end
$$;


-- =============================================================================
-- PRIVILEGES + RLS — match project_workflows: internal staff (admin) read;
-- writes via service_role.
-- =============================================================================
grant all on public.project_workflow_call_context to anon, authenticated, service_role;

alter table public.project_workflow_call_context enable row level security;

create policy project_workflow_call_context_admin_select
  on public.project_workflow_call_context for select to authenticated
  using (public.jwt_is_admin());

create policy project_workflow_call_context_all
  on public.project_workflow_call_context for all to service_role
  using (true) with check (true);

notify pgrst, 'reload schema';
