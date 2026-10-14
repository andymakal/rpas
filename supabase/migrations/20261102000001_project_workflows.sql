-- =============================================================================
-- Reusable project workflows — the smallest workflow-as-data structure
-- Migration: 20261102000001_project_workflows.sql
--
-- Right Path's business model: a PROJECT defines a customer population and
-- GROUPS selected WORKFLOWS. A project's NAME and TYPE must not determine
-- behavior — the workflows it contains do. Each WORKFLOW is reusable and
-- defines its objectives, how its completion is determined, and (via the
-- project's wiring) whether it gates another workflow. Every project member is
-- evaluated independently against each contained workflow; completion is
-- per-customer and derived from authoritative business facts.
--
-- Before this migration there was NO workflow-as-data: "workflow" was a
-- hardcoded TypeScript stage enum derived inside one project-type-specific
-- module, and project TYPE NAME ("1035 Exchange") gated behavior across the
-- codebase. This migration introduces the two smallest tables needed:
--
--   workflows          — the reusable catalog of workflow DEFINITIONS. A row is
--                        a named, reusable workflow (e.g. Servicing Agent
--                        Onboarding, Review Preparation). `key` is a stable
--                        machine identifier that the application maps to a small
--                        named completion STRATEGY in code (facts -> complete?).
--                        This is deliberately NOT a generic rules designer: the
--                        catalog records WHICH reusable workflows exist and how
--                        each decides completion (automatic vs manual), while the
--                        fact evaluation lives in typed code keyed on `key`.
--
--   project_workflows  — which workflows a PROJECT contains, their order, and
--                        the explicit dependency between them (gated_by). This
--                        is where "Servicing Agent Onboarding gates Review
--                        Preparation" becomes DATA for a given project, instead
--                        of a hardcoded `if` keyed on the project type name.
--
-- No business truth is duplicated: a workflow's per-customer COMPLETION is still
-- derived live from the authoritative facts (service_policies.sa_status for
-- onboarding, the existing prep/determination records for review preparation).
-- These tables record only the reusable DEFINITIONS and each project's WIRING.
--
-- Seed: the two workflows this release needs, with fixed ids for stability, and
-- the wiring for the existing "1035 Reviews" development project (onboarding
-- gates review preparation). The seed is idempotent and scoped to that one
-- project by id; it creates nothing for any other project.
--
-- Depends on: projects (20261008230000), set_updated_at() and jwt_is_admin()
--             (earlier in the chain). Writes via service_role; internal staff
--             (admin) read. Internal-only; no agency portal access.
-- =============================================================================


-- =============================================================================
-- 1. WORKFLOWS — the reusable catalog of workflow definitions
-- =============================================================================
create table if not exists public.workflows (
  id              uuid primary key default gen_random_uuid(),

  -- stable machine identifier the app maps to a typed completion strategy.
  -- e.g. 'servicing_agent_onboarding', 'review_preparation'. Unique, immutable.
  key             text not null,

  -- human-facing name + description (presentation only; never drives behavior).
  name            text not null,
  description     text,

  -- how this workflow's completion is DETERMINED:
  --   'automatic' — completion is derived from authoritative business facts, no
  --                 human confirmation required (e.g. servicing access confirmed
  --                 on the applicable policies).
  --   'manual'    — completion requires a recorded human judgment/determination.
  -- The specific fact logic lives in code, keyed on `key`; this column states
  -- which KIND of completion the workflow uses.
  completion_mode text not null default 'automatic'
    check (completion_mode in ('automatic', 'manual')),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.workflows is
  'Reusable catalog of workflow DEFINITIONS. key is a stable identifier the '
  'application maps to a typed completion strategy (facts -> complete?). name/'
  'description are presentation only and never drive behavior. completion_mode '
  'records whether completion is derived automatically from business facts or '
  'requires a recorded human determination. This is not a generic rules '
  'designer: the fact logic lives in code keyed on key.';

comment on column public.workflows.key is
  'Stable machine identifier mapped to a typed completion strategy in code. '
  'Immutable; unique case-insensitively.';

create unique index if not exists workflows_key_key
  on public.workflows (lower(key));

create trigger workflows_set_updated_at
  before update on public.workflows
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 2. PROJECT WORKFLOWS — which workflows a project contains + their dependency
-- A project groups selected workflows. position orders them; gated_by_workflow_id
-- names an EXPLICIT dependency on another workflow contained by the SAME project
-- (the gating workflow must complete, per customer, before the gated workflow is
-- open for that customer). A null gated_by means the workflow has no upstream
-- gate.
-- =============================================================================
create table if not exists public.project_workflows (
  id                   uuid primary key default gen_random_uuid(),

  project_id           uuid not null references public.projects (id)  on delete cascade,
  workflow_id          uuid not null references public.workflows (id) on delete restrict,

  -- 0-based display/evaluation order within the project.
  position             integer not null default 0,

  -- EXPLICIT dependency: the project_workflows row (same project) whose workflow
  -- must complete, per customer, before THIS workflow is open for that customer.
  -- Null = no upstream gate. Self-referential so the dependency is between two
  -- workflows the project actually contains.
  gated_by_workflow_id uuid references public.project_workflows (id) on delete set null,

  created_at           timestamptz not null default now()
);

comment on table public.project_workflows is
  'Which reusable workflows a project contains, their order (position), and the '
  'explicit per-customer dependency between them (gated_by_workflow_id -> the '
  'project_workflows row whose workflow gates this one). A project''s behavior '
  'is defined by the workflows it contains and how they are wired here — never '
  'by the project name or type.';

comment on column public.project_workflows.gated_by_workflow_id is
  'The project_workflows row (same project) whose workflow must complete, per '
  'customer, before this workflow is open for that customer. Null = no gate.';

-- A project contains a given workflow at most once.
create unique index if not exists project_workflows_project_workflow_key
  on public.project_workflows (project_id, workflow_id);

create index if not exists project_workflows_project_idx
  on public.project_workflows (project_id);

create index if not exists project_workflows_workflow_idx
  on public.project_workflows (workflow_id);

create index if not exists project_workflows_gated_by_idx
  on public.project_workflows (gated_by_workflow_id)
  where gated_by_workflow_id is not null;


-- =============================================================================
-- 3. SEED — the two workflows this release needs (fixed ids for stability)
-- =============================================================================
insert into public.workflows (id, key, name, description, completion_mode)
values
  (
    'c0f10000-0000-4000-8000-000000000001'::uuid,
    'servicing_agent_onboarding',
    'Servicing Agent Onboarding',
    'Establish confirmed servicing-agent access for the applicable policies. '
    'Completion is derived automatically from policy servicing-access facts: '
    'when access is already confirmed, the workflow is already complete with no '
    'onboarding effort. Where access is missing, employees call, email, text, '
    'research, and follow up independently.',
    'automatic'
  ),
  (
    'c0f10000-0000-4000-8000-000000000002'::uuid,
    'review_preparation',
    'Review Preparation',
    'Prepare the customer for review once servicing access is established: '
    'collect the required documents per permanent policy and record the '
    'producer determination. Gated by Servicing Agent Onboarding.',
    'manual'
  )
on conflict (lower(key)) do nothing;


-- =============================================================================
-- 4. SEED — wire the existing "1035 Reviews" development project
-- Scoped to that one project by its fixed id. Idempotent: the unique
-- (project_id, workflow_id) index makes re-adds no-ops, and the gating update
-- only sets the dependency when it is still null. Creates nothing for any other
-- project; other projects define their own workflow set as needed.
-- =============================================================================
do $$
declare
  v_project   uuid := '60d8ca7d-56fa-44e2-9cae-29a542d4eb48';  -- 1035 Reviews
  v_onboard   uuid := 'c0f10000-0000-4000-8000-000000000001';  -- servicing_agent_onboarding
  v_review    uuid := 'c0f10000-0000-4000-8000-000000000002';  -- review_preparation
  v_onboard_pw uuid;
begin
  -- Only wire if the project actually exists on this environment.
  if exists (select 1 from public.projects where id = v_project) then
    -- Onboarding first (position 0), no upstream gate.
    insert into public.project_workflows (project_id, workflow_id, position)
    values (v_project, v_onboard, 0)
    on conflict (project_id, workflow_id) do nothing;

    -- Review preparation second (position 1).
    insert into public.project_workflows (project_id, workflow_id, position)
    values (v_project, v_review, 1)
    on conflict (project_id, workflow_id) do nothing;

    -- Resolve the onboarding project_workflows row and set it as the gate for
    -- review preparation (only when the gate is not already set).
    select id into v_onboard_pw
      from public.project_workflows
     where project_id = v_project and workflow_id = v_onboard;

    update public.project_workflows
       set gated_by_workflow_id = v_onboard_pw
     where project_id = v_project
       and workflow_id = v_review
       and gated_by_workflow_id is null;
  end if;
end
$$;


-- =============================================================================
-- 5. TABLE PRIVILEGES — match every existing public table.
-- =============================================================================
grant all on public.workflows         to anon, authenticated, service_role;
grant all on public.project_workflows to anon, authenticated, service_role;


-- =============================================================================
-- 6. ROW LEVEL SECURITY — internal staff (admin) read; writes via service_role.
-- =============================================================================
alter table public.workflows         enable row level security;
alter table public.project_workflows enable row level security;

create policy workflows_admin_select
  on public.workflows for select to authenticated
  using (public.jwt_is_admin());

create policy workflows_all
  on public.workflows for all to service_role
  using (true) with check (true);

create policy project_workflows_admin_select
  on public.project_workflows for select to authenticated
  using (public.jwt_is_admin());

create policy project_workflows_all
  on public.project_workflows for all to service_role
  using (true) with check (true);


-- Refresh PostgREST's schema cache so the new tables are visible immediately.
notify pgrst, 'reload schema';
