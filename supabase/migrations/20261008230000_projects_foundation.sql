-- =============================================================================
-- Projects foundation — durable schema for the Projects module
-- Migration: 20261008230000_projects_foundation.sql
--
-- A "project" is a durable book-of-business initiative (for example a 1035
-- exchange sweep, a term-conversion push, or a tobacco-reclass campaign). A
-- project is populated by one or more RUNS. Each run evaluates the book against
-- a set of criteria and adds the customers that qualify. The criteria used for
-- a run are preserved on the run itself so the population is reproducible and
-- auditable. A customer belongs to a project at most once; the run that first
-- added them is recorded. Each qualifying match records which run and customer
-- it is for, which policy (if any) caused the qualification, and the reason /
-- evidence behind it.
--
-- This migration is the DURABLE FOUNDATION ONLY. It intentionally does NOT model
-- population-criteria rules, 1035 logic, run execution, or any workflow state
-- beyond active / completed. The criteria column is a free-form jsonb snapshot
-- so later work can define the criteria shape without another schema change.
--
-- Tables:
--   projects           — the initiative. name, type, description, active/completed
--                        lifecycle with created/completed audit (user + time).
--   project_runs        — one population pass for a project. Preserves the exact
--                        criteria snapshot used, plus started/completed audit.
--   project_customers   — membership: a customer in a project, with the run that
--                        first added them. Unique per (project, customer).
--   project_matches     — why a customer qualified in a run: the run, the
--                        customer, the policy that triggered it (nullable), and
--                        the qualification reason / evidence.
--
-- Depends on: customers (20260516000001), service_policies (20260525000001),
--             set_updated_at() and jwt_is_admin() (earlier in the chain),
--             auth.users (Supabase Auth). Writes go through service_role;
--             internal staff (admin) get read access, consistent with the rest
--             of the internal modules. No agency portal access.
-- =============================================================================


-- =============================================================================
-- 1. PROJECTS
-- The durable initiative. Lifecycle is a simple active -> completed, with audit
-- columns for who created / completed it and when. project_type is a free-form
-- text label for now (no lookup table yet) so new initiative kinds can be added
-- without a migration; a constraint can be tightened later if the set settles.
-- =============================================================================
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),

  name          text not null,
  project_type  text not null,
  description   text,

  status        text not null default 'active'
    check (status in ('active', 'completed')),

  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id) on delete set null,

  -- set only when the project is marked completed
  completed_at  timestamptz,
  completed_by  uuid references auth.users (id) on delete set null,

  updated_at    timestamptz not null default now(),

  -- a completed project must carry its completion timestamp, and an active one
  -- must not; keeps the lifecycle columns honest.
  constraint projects_completed_consistency check (
    (status = 'completed' and completed_at is not null) or
    (status = 'active'    and completed_at is null)
  )
);

comment on table public.projects is
  'A durable book-of-business initiative (e.g. a 1035 sweep or term-conversion '
  'push). Populated by one or more project_runs. Lifecycle is active -> '
  'completed with created/completed audit. project_type is free-form text for '
  'now; no criteria, run, or 1035 logic is modeled here.';

comment on column public.projects.project_type is
  'Free-form initiative kind (no lookup table yet). Tighten to a constraint or '
  'FK once the set of project types settles.';

comment on column public.projects.status is
  'active while the initiative is being worked; completed when closed out. '
  'completed_at / completed_by are set together with the completed status.';

create index if not exists projects_status_idx
  on public.projects (status);

create index if not exists projects_created_at_idx
  on public.projects (created_at desc);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 2. PROJECT RUNS
-- One population pass against the book for a project. The criteria used are
-- preserved as a jsonb snapshot so the population is reproducible and auditable;
-- the criteria shape is deliberately open for now. Runs are ordered within a
-- project by run_number (1-based), which also gives a stable "first run"
-- reference for membership.
-- =============================================================================
create table if not exists public.project_runs (
  id            uuid primary key default gen_random_uuid(),

  project_id    uuid not null references public.projects (id) on delete cascade,

  -- 1-based ordinal within the project; unique per project (see index below).
  run_number    integer not null,

  -- the exact criteria used for this run, preserved verbatim. Shape is open for
  -- now; later work defines it without a schema change. '{}' = no criteria yet.
  criteria      jsonb not null default '{}'::jsonb,

  started_at    timestamptz not null default now(),
  started_by    uuid references auth.users (id) on delete set null,

  -- set when the run finishes populating; null while in progress.
  completed_at  timestamptz,
  completed_by  uuid references auth.users (id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.project_runs is
  'One population pass for a project. Preserves the exact criteria snapshot used '
  '(jsonb, shape open for now) so the population is reproducible and auditable, '
  'plus started/completed audit. run_number is a 1-based ordinal within the '
  'project.';

comment on column public.project_runs.criteria is
  'Verbatim snapshot of the criteria used for this run. Open jsonb shape for '
  'now; later work defines the structure without a schema change.';

-- run_number is unique within a project (ordinal, not global).
create unique index if not exists project_runs_project_run_number_key
  on public.project_runs (project_id, run_number);

create index if not exists project_runs_project_idx
  on public.project_runs (project_id);

create trigger project_runs_set_updated_at
  before update on public.project_runs
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 3. PROJECT CUSTOMERS
-- Membership of a customer in a project. Records the run that FIRST added the
-- customer (added_by_run_id). A customer can belong to a project at most once:
-- the (project_id, customer_id) unique constraint prevents duplicate adds even
-- if a later run re-qualifies them. Re-qualification is captured in
-- project_matches, not by a second membership row.
-- =============================================================================
create table if not exists public.project_customers (
  id              uuid primary key default gen_random_uuid(),

  project_id      uuid not null references public.projects (id)      on delete cascade,
  customer_id     uuid not null references public.customers (id)     on delete cascade,

  -- the run that first added this customer to the project. Nullable so a
  -- customer can be added manually (outside a run) in later work; set null if
  -- that run is ever deleted rather than losing the membership.
  added_by_run_id uuid references public.project_runs (id) on delete set null,

  added_at        timestamptz not null default now(),

  -- prevent the same customer from being added to the same project twice.
  constraint project_customers_unique unique (project_id, customer_id)
);

comment on table public.project_customers is
  'Membership: a customer belongs to a project at most once (enforced by the '
  'project_customers_unique constraint). added_by_run_id records the run that '
  'first added them. Re-qualification by a later run is captured in '
  'project_matches, not by a duplicate membership row.';

comment on column public.project_customers.added_by_run_id is
  'The project_run that first added this customer to the project. Null if added '
  'outside a run or if the originating run was later deleted.';

create index if not exists project_customers_customer_idx
  on public.project_customers (customer_id);

create index if not exists project_customers_run_idx
  on public.project_customers (added_by_run_id)
  where added_by_run_id is not null;


-- =============================================================================
-- 4. PROJECT MATCHES
-- Why a customer qualified in a run. Links a run + customer to the policy that
-- triggered qualification (nullable — some qualifications are not policy-driven)
-- and records the reason / evidence. Multiple matches per run+customer are
-- allowed (e.g. several qualifying policies), so there is no uniqueness across
-- the policy; a partial unique index guards against duplicate rows for the same
-- run + customer + policy.
-- =============================================================================
create table if not exists public.project_matches (
  id             uuid primary key default gen_random_uuid(),

  run_id         uuid not null references public.project_runs (id)      on delete cascade,
  customer_id    uuid not null references public.customers (id)         on delete cascade,

  -- the policy that caused this qualification, when policy-driven. Nullable
  -- because a match may qualify on non-policy criteria.
  policy_id      uuid references public.service_policies (id) on delete set null,

  -- why this customer/policy qualified in this run: human- or rule-generated
  -- reason text.
  reason         text,
  -- structured supporting evidence for the qualification (open jsonb shape).
  evidence       jsonb not null default '{}'::jsonb,

  created_at     timestamptz not null default now()
);

comment on table public.project_matches is
  'Why a customer qualified in a run: links a run + customer to the triggering '
  'policy (nullable) and records the qualification reason and structured '
  'evidence. Multiple matches per run+customer are allowed (e.g. several '
  'qualifying policies).';

comment on column public.project_matches.policy_id is
  'The service_policy that caused qualification, when policy-driven. Null for '
  'qualifications that are not tied to a specific policy.';

create index if not exists project_matches_run_idx
  on public.project_matches (run_id);

create index if not exists project_matches_customer_idx
  on public.project_matches (customer_id);

create index if not exists project_matches_policy_idx
  on public.project_matches (policy_id)
  where policy_id is not null;

-- Guard against duplicate match rows for the same run + customer + policy.
-- Two partial indexes because NULL policy_id would otherwise never collide.
create unique index if not exists project_matches_run_customer_policy_key
  on public.project_matches (run_id, customer_id, policy_id)
  where policy_id is not null;

create unique index if not exists project_matches_run_customer_nopolicy_key
  on public.project_matches (run_id, customer_id)
  where policy_id is null;


-- =============================================================================
-- 5. TABLE PRIVILEGES
-- Grant the standard Supabase API-role privileges, matching every existing
-- public table (e.g. customers). On this branch, default privileges do NOT
-- auto-grant DML to the API roles, so new tables must grant explicitly or
-- PostgREST returns 403 even for service_role. RLS below is what actually gates
-- row access (anon / authenticated are restricted by policy; service_role
-- bypasses RLS). These grants simply make the tables reachable through the API.
-- =============================================================================
grant all on public.projects          to anon, authenticated, service_role;
grant all on public.project_runs       to anon, authenticated, service_role;
grant all on public.project_customers  to anon, authenticated, service_role;
grant all on public.project_matches    to anon, authenticated, service_role;


-- =============================================================================
-- 6. ROW LEVEL SECURITY
-- Internal staff (admin) read; all writes via service_role. Matches the service
-- / stewardship module pattern. Internal-only; no agency portal access.
-- =============================================================================
alter table public.projects          enable row level security;
alter table public.project_runs      enable row level security;
alter table public.project_customers enable row level security;
alter table public.project_matches   enable row level security;

create policy projects_admin_select
  on public.projects for select to authenticated
  using (public.jwt_is_admin());

create policy projects_all
  on public.projects for all to service_role
  using (true) with check (true);

create policy project_runs_admin_select
  on public.project_runs for select to authenticated
  using (public.jwt_is_admin());

create policy project_runs_all
  on public.project_runs for all to service_role
  using (true) with check (true);

create policy project_customers_admin_select
  on public.project_customers for select to authenticated
  using (public.jwt_is_admin());

create policy project_customers_all
  on public.project_customers for all to service_role
  using (true) with check (true);

create policy project_matches_admin_select
  on public.project_matches for select to authenticated
  using (public.jwt_is_admin());

create policy project_matches_all
  on public.project_matches for all to service_role
  using (true) with check (true);
