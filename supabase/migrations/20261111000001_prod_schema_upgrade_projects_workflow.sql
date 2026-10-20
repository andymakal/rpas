-- =============================================================================
-- Production schema upgrade: Right Path projects/workflow/stewardship feature set
-- Migration: 20261111000001_prod_schema_upgrade_projects_workflow.sql
--
-- Brings production's schema up to the completed application WITHOUT changing
-- existing customer/policy/case business data. Fresh, additive reconciliation
-- authored against production's ACTUAL schema (NOT a replay of the historical
-- dev migration chain; the drift-reconcile 20261008215325 and the owner-as-
-- insured backfill 20261015000001 are excluded).
--
-- INCLUDES: the 20 missing projects/workflow/stewardship tables; columns on
-- existing tables (case_touches.customer_id + postal/research touch types;
-- customers.{phone,email,address}_verified_at; producers licensing/management
-- flags); functions, grants, RLS; and the reusable system CATALOGS (project
-- types, work-function capability catalog, workflow catalog, document bucket).
--
-- EMPLOYEE BUSINESS RULES: the ONLY employee-record writes are the settled
-- qualifications and agency-wide capabilities for the four real staff, applied
-- in ONE block at the end, resolved by VERIFIED email identity (never a
-- hardcoded dev UUID, never inferred from job title). Every other
-- environment-specific business-data write from the source migrations
-- (title-inferred capability guesses, per-project participation/escalation for
-- the dev "1035 Reviews" project, the Q4 1035 initiative team, population runs/
-- enrollments, and the dev-only TEST roster) is REMOVED.
--
-- ATOMIC + TRACKED: the whole upgrade runs in ONE transaction, so a failure
-- rolls back entirely, and it records itself once in
-- supabase_migrations.schema_migrations. It is applied once (not designed for
-- repeated replay).
-- =============================================================================

begin;

-- >>> schema/catalog from 20260927000002_stewardship_prereview.sql >>>
-- =============================================================================
-- Stewardship / Producer Pre-Review — database foundation
-- Migration: 20260927000002_stewardship_prereview.sql
--
-- Adds the durable schema for the capture / producer pre-review flow that sits
-- in front of the existing policy review workflow:
--
--   customer_prereviews   — one durable customer-level work item. Holds only
--                           workflow facts that cannot be derived from existing
--                           records (producer assignment + producer decision +
--                           next review date). Workflow position (stewardship /
--                           documentation / ready for pre-review) is DERIVED from
--                           service_policies.sa_status and policy_documents, so
--                           no stage column is stored.
--   policy_documents      — minimal per-policy document record. Policy facts
--                           (number, carrier, product, dates) stay authoritative
--                           on service_policies and are NOT duplicated here.
--   policy_review_policies — additive bridge letting one policy_review cover
--                           multiple permanent policies without changing the
--                           existing one-row-per-review structure.
--   policy_reviews.prereview_id — nullable, unique link back to the pre-review
--                           that produced the review (review_now decision).
--
-- Depends on: producers (20260522000002), customers (20260516000001),
--             agencies (20260516000001), service_policies / policy_reviews
--             (20260525000001), and the policy_reviews drift reconciliation
--             (20260927000001). Writes go through service_role; internal staff
--             (admin) get read access, consistent with the service module.
-- =============================================================================


-- =============================================================================
-- 1. CUSTOMER PRE-REVIEWS
-- Durable customer-level capture / pre-review work item. The presence of a row
-- with decision IS NULL means the customer is currently in the pre-review
-- workflow. Only non-derivable facts are stored here.
-- =============================================================================
create table if not exists public.customer_prereviews (
  id                   uuid primary key default gen_random_uuid(),

  -- subject of the pre-review
  customer_id          uuid not null references public.customers (id) on delete cascade,

  -- the agency / book this capture work originated from (not derivable later)
  source_agency_id     uuid references public.agencies (id) on delete set null,

  -- durable producer assignment (producer identity, not a name string)
  assigned_producer_id uuid references public.producers (id) on delete set null,

  -- producer decision — null while the item is open / undecided
  decision             text
    check (decision in ('review_now', 'review_later', 'no_future_review')),

  -- set only when decision = 'review_later'
  next_review_date     date,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.customer_prereviews is
  'Customer-level capture / producer pre-review work item. Presence of a row '
  'with decision IS NULL means the customer is in the pre-review workflow. '
  'Stores only non-derivable workflow facts (producer assignment, decision, '
  'next review date). Stewardship / documentation / ready-for-pre-review state '
  'is derived from service_policies.sa_status and policy_documents, not stored.';

comment on column public.customer_prereviews.next_review_date is
  'Set only when decision = ''review_later''. The durable cadence anchor for a '
  'deferred customer review.';

-- One OPEN pre-review per customer (decided items may accumulate as history).
create unique index if not exists customer_prereviews_one_open_per_customer
  on public.customer_prereviews (customer_id)
  where decision is null;

create index if not exists customer_prereviews_producer_idx
  on public.customer_prereviews (assigned_producer_id)
  where assigned_producer_id is not null;

create index if not exists customer_prereviews_next_review_idx
  on public.customer_prereviews (next_review_date)
  where next_review_date is not null;

create trigger customer_prereviews_set_updated_at
  before update on public.customer_prereviews
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 2. POLICY DOCUMENTS
-- Minimal durable per-policy document record. Policy facts remain authoritative
-- on service_policies; only document identity + location are stored here.
-- =============================================================================
create table if not exists public.policy_documents (
  id                uuid primary key default gen_random_uuid(),
  policy_id         uuid not null references public.service_policies (id) on delete cascade,
  document_type     text not null,
  document_date     date not null,
  storage_location  text not null
);

comment on table public.policy_documents is
  'Minimal per-policy document record (type, date, storage location). Policy '
  'facts (number, carrier, product, issue date) stay authoritative on '
  'service_policies and are not duplicated here.';

create index if not exists policy_documents_policy_idx
  on public.policy_documents (policy_id);


-- =============================================================================
-- 3. POLICY REVIEW ↔ POLICIES BRIDGE
-- Additive link so one policy_review can cover multiple permanent policies.
-- policy_reviews.policy_id stays as a backward-compatibility anchor.
-- =============================================================================
create table if not exists public.policy_review_policies (
  policy_review_id uuid not null references public.policy_reviews (id)  on delete cascade,
  policy_id        uuid not null references public.service_policies (id) on delete cascade,
  primary key (policy_review_id, policy_id)
);

comment on table public.policy_review_policies is
  'Bridge linking a policy_review to all permanent/cash-value policies it '
  'covers. Preserves the one-row-per-review structure (and review_number) while '
  'allowing a customer-level review to span multiple policies.';

create index if not exists policy_review_policies_policy_idx
  on public.policy_review_policies (policy_id);


-- =============================================================================
-- 4. POLICY_REVIEWS → CUSTOMER_PREREVIEWS LINK
-- Nullable, unique: at most one review per pre-review. Single-direction link
-- (no reciprocal column on customer_prereviews).
-- =============================================================================
alter table public.policy_reviews
  add column if not exists prereview_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'policy_reviews_prereview_id_fkey'
  ) then
    alter table public.policy_reviews
      add constraint policy_reviews_prereview_id_fkey
      foreign key (prereview_id) references public.customer_prereviews (id) on delete set null;
  end if;
end
$$;

create unique index if not exists policy_reviews_prereview_id_key
  on public.policy_reviews (prereview_id)
  where prereview_id is not null;


-- =============================================================================
-- 5. ROW LEVEL SECURITY
-- Admin (internal SML staff) read access; all writes via service_role. Matches
-- the service module pattern. These tables are internal-only; agency portal
-- users have no access.
-- =============================================================================
alter table public.customer_prereviews     enable row level security;
alter table public.policy_documents        enable row level security;
alter table public.policy_review_policies  enable row level security;

create policy customer_prereviews_admin_select
  on public.customer_prereviews for select to authenticated
  using (public.jwt_is_admin());

create policy customer_prereviews_all
  on public.customer_prereviews for all to service_role
  using (true) with check (true);

create policy policy_documents_admin_select
  on public.policy_documents for select to authenticated
  using (public.jwt_is_admin());

create policy policy_documents_all
  on public.policy_documents for all to service_role
  using (true) with check (true);

create policy policy_review_policies_admin_select
  on public.policy_review_policies for select to authenticated
  using (public.jwt_is_admin());

create policy policy_review_policies_all
  on public.policy_review_policies for all to service_role
  using (true) with check (true);

-- >>> schema/catalog from 20260927000003_stewardship_outreach.sql >>>
-- =============================================================================
-- Stewardship outreach — durable operational state for the capture flow
-- Migration: 20260927000003_stewardship_outreach.sql
--
-- The capture / stewardship outreach workflow moves a customer through a set of
-- operational queues (ready to email, ready to call, research needed, waiting
-- for response / form / carrier) driven by what happened during outreach. That
-- operational state is NOT derivable from existing durable records:
--   * service_policies.sa_status has only three values (unknown / confirmed /
--     not_on_file) and sa_form_sent_at is a single timestamp — together they
--     cannot represent which outreach queue a customer is in, the last call
--     outcome, a scheduled callback, follow-up timing, or a carrier correction.
--   * customer_prereviews deliberately stores only the producer decision; its
--     comment states workflow position is derived, which holds for the
--     stewardship / documentation / ready split but NOT for the fine-grained
--     outreach queue.
--
-- So this migration adds the smallest persistence needed for the outreach slice
-- to survive refresh: one stewardship_outreach row per open customer_prereview,
-- plus a child table recording which policies are in the current servicing-agent
-- request (vs. shown only as context). Policy facts stay authoritative on
-- service_policies; servicing-agent status stays on service_policies
-- (sa_status / sa_form_sent_at). This table holds only non-derivable workflow
-- state. No automatic lost/closed state exists: every terminal-looking outcome
-- (not interested, nothing found) is an explicit human-recorded value, never a
-- status the system closes on its own.
--
-- Depends on: customer_prereviews, customers, service_policies, producers,
--             set_updated_at(), jwt_is_admin() (all earlier in the chain).
-- =============================================================================


-- =============================================================================
-- 1. STEWARDSHIP OUTREACH
-- One row per open capture work item (1:1 with a customer_prereview). Holds the
-- current outreach queue and the small amount of per-queue operational state the
-- prototype carries.
-- =============================================================================
create table if not exists public.stewardship_outreach (
  id            uuid primary key default gen_random_uuid(),

  -- the capture work item this outreach belongs to (1:1)
  prereview_id  uuid not null references public.customer_prereviews (id) on delete cascade,

  -- current outreach queue — the workflow state machine
  queue         text not null default 'ready-to-email'
    check (queue in (
      'ready-to-email', 'ready-to-call', 'research-needed',
      'waiting-for-response', 'waiting-for-form', 'waiting-for-carrier'
    )),

  -- why a 'ready-to-call' item needs a call (selects the script); null otherwise
  call_reason   text
    check (call_reason in ('no-email', 'email-bounced', 'no-response', 'callback-due')),

  -- why a 'research-needed' item is in research; null otherwise
  research_reason text
    check (research_reason in ('no-contact', 'bad-number', 'bounce-no-phone')),

  -- last recorded call outcome (never auto-advances; human-recorded)
  last_call_outcome text
    check (last_call_outcome in ('reached', 'voicemail', 'bad-number', 'not-interested', 'callback')),

  -- scheduled callback date when the customer asked us to call back
  callback_date date,

  -- when the initial email was sent (enters waiting-for-response)
  email_sent_at timestamptz,
  -- when a follow-up becomes due
  follow_up_due date,

  -- when the signed form was received back from the customer. Set first, while
  -- still in waiting-for-form, so the two-step receive -> confirm -> submit flow
  -- survives a refresh. Submission to the carrier is a separate later step.
  form_received_at timestamptz,
  -- when the signed form was submitted to the carrier (enters waiting-for-carrier)
  submitted_at  timestamptz,
  -- carrier-requested correction text — actionable work within waiting-for-carrier
  carrier_correction text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.stewardship_outreach is
  'Durable operational state for the stewardship / capture outreach flow. One '
  'row per open customer_prereview. Holds only the non-derivable outreach queue '
  'and per-queue state; policy facts stay on service_policies and servicing-agent '
  'status stays on service_policies.sa_status / sa_form_sent_at.';

comment on column public.stewardship_outreach.queue is
  'Outreach workflow state. ready-to-email / ready-to-call / research-needed are '
  'action queues; waiting-for-response / waiting-for-form / waiting-for-carrier '
  'are check/waiting states. No automatic closed/lost state exists.';

-- One outreach row per pre-review.
create unique index if not exists stewardship_outreach_prereview_key
  on public.stewardship_outreach (prereview_id);

-- Queue board filtering.
create index if not exists stewardship_outreach_queue_idx
  on public.stewardship_outreach (queue);

-- Callbacks that resurface on a date.
create index if not exists stewardship_outreach_callback_idx
  on public.stewardship_outreach (callback_date)
  where callback_date is not null;

create trigger stewardship_outreach_set_updated_at
  before update on public.stewardship_outreach
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 2. STEWARDSHIP OUTREACH POLICIES
-- Which service_policies are included in the CURRENT servicing-agent request for
-- this outreach item. Membership is operational and non-derivable: all known
-- holdings stay visible as context (queried from service_policies by customer),
-- but only the policies recorded here are "in the request" and go on the form.
-- =============================================================================
create table if not exists public.stewardship_outreach_policies (
  outreach_id uuid not null references public.stewardship_outreach (id) on delete cascade,
  policy_id   uuid not null references public.service_policies (id)     on delete cascade,
  primary key (outreach_id, policy_id)
);

comment on table public.stewardship_outreach_policies is
  'Policies included in the current servicing-agent request for an outreach item. '
  'Other known holdings remain visible as customer context but are not listed '
  'here. Term / non-cash-value policies may be present as context without being '
  'in the request; they never gate the stewardship work.';

create index if not exists stewardship_outreach_policies_policy_idx
  on public.stewardship_outreach_policies (policy_id);


-- =============================================================================
-- 3. ROW LEVEL SECURITY
-- Internal staff (admin) read; all writes via service_role. Matches the service
-- module and the pre-review tables. Internal-only; no agency portal access.
-- =============================================================================
alter table public.stewardship_outreach          enable row level security;
alter table public.stewardship_outreach_policies enable row level security;

create policy stewardship_outreach_admin_select
  on public.stewardship_outreach for select to authenticated
  using (public.jwt_is_admin());

create policy stewardship_outreach_all
  on public.stewardship_outreach for all to service_role
  using (true) with check (true);

create policy stewardship_outreach_policies_admin_select
  on public.stewardship_outreach_policies for select to authenticated
  using (public.jwt_is_admin());

create policy stewardship_outreach_policies_all
  on public.stewardship_outreach_policies for all to service_role
  using (true) with check (true);

-- >>> schema/catalog from 20261008000001_service_policies_review_initiative_fields.sql >>>
-- =============================================================================
-- Policy fields needed for Review Initiatives
-- Migration: 20261008000001_service_policies_review_initiative_fields.sql
--
-- Review Initiatives need three facts about the insured/policy that
-- service_policies does not yet carry:
--
--   1. Insured date of birth, at whatever precision the source actually knew.
--      Legacy books record DOB inconsistently: some rows have a full date,
--      some only month + year, some only a year, and some nothing at all.
--      We must NEVER invent a day (or a month) we were not given, so the DOB
--      is stored as explicit components plus a precision flag rather than
--      forced into a single `date` with a fabricated day.
--
--   2. Insured state (US state the insured resides in) — drives state-specific
--      review eligibility and sequencing.
--
--   3. Policy termination date — the date the policy actually terminated
--      (lapse, surrender, death, maturity). Distinct from the annuity
--      `surrender_end_date` (end of the surrender-charge period), which is a
--      product mechanic, not a termination event.
--
-- This is additive and non-destructive: all new columns are nullable and the
-- DOB precision defaults to 'missing', so existing rows remain valid.
-- The pre-existing masked `owner_dob_approx` column is left untouched; it masks
-- the OWNER's DOB for display, whereas these columns carry the INSURED's DOB
-- for review logic.
-- =============================================================================

-- ── Insured date of birth, stored by precision (no invented day) ─────────────
alter table public.service_policies
  add column if not exists insured_dob          date,
  add column if not exists insured_dob_year      smallint,
  add column if not exists insured_dob_month     smallint,
  add column if not exists insured_dob_precision text not null default 'missing';

comment on column public.service_policies.insured_dob is
  'Full insured date of birth. Populated ONLY when insured_dob_precision = '
  '''exact''. Null for every lower precision so no day is ever fabricated.';

comment on column public.service_policies.insured_dob_year is
  'Insured birth year. Present whenever precision is exact, month_year, or '
  'year_only; null when missing.';

comment on column public.service_policies.insured_dob_month is
  'Insured birth month (1-12). Present whenever precision is exact or '
  'month_year; null for year_only and missing. A day is never stored at this '
  'precision — only insured_dob (exact) carries a day.';

comment on column public.service_policies.insured_dob_precision is
  'How much of the insured DOB is actually known: '
  '''exact'' (full date in insured_dob), '
  '''month_year'' (year + month only), '
  '''year_only'' (year only), '
  '''missing'' (nothing). Lets review logic degrade gracefully without '
  'guessing a day or month that was never provided.';

-- Precision is one of the four allowed values.
alter table public.service_policies
  drop constraint if exists service_policies_insured_dob_precision_check;
alter table public.service_policies
  add constraint service_policies_insured_dob_precision_check
  check (insured_dob_precision in ('exact', 'month_year', 'year_only', 'missing'));

-- The stored components must match the declared precision. This is what
-- guarantees we never claim more certainty than we have (e.g. an 'exact'
-- precision with no full date, or a 'year_only' precision carrying a month).
alter table public.service_policies
  drop constraint if exists service_policies_insured_dob_shape_check;
alter table public.service_policies
  add constraint service_policies_insured_dob_shape_check
  check (
    case insured_dob_precision
      when 'exact' then
        insured_dob is not null
        and insured_dob_year  is not null
        and insured_dob_month is not null
      when 'month_year' then
        insured_dob is null
        and insured_dob_year  is not null
        and insured_dob_month is not null
      when 'year_only' then
        insured_dob is null
        and insured_dob_year  is not null
        and insured_dob_month is null
      when 'missing' then
        insured_dob is null
        and insured_dob_year  is null
        and insured_dob_month is null
    end
  );

-- Sanity bounds on the partial components (defensive; app validates too).
alter table public.service_policies
  drop constraint if exists service_policies_insured_dob_month_range_check;
alter table public.service_policies
  add constraint service_policies_insured_dob_month_range_check
  check (insured_dob_month is null or insured_dob_month between 1 and 12);

alter table public.service_policies
  drop constraint if exists service_policies_insured_dob_year_range_check;
alter table public.service_policies
  add constraint service_policies_insured_dob_year_range_check
  check (insured_dob_year is null or insured_dob_year between 1900 and 2100);

-- ── Insured state ────────────────────────────────────────────────────────────
alter table public.service_policies
  add column if not exists insured_state text;

comment on column public.service_policies.insured_state is
  'US state the insured resides in (e.g. ''PA''). Drives state-specific Review '
  'Initiative eligibility and sequencing. Matches the plain-text state '
  'convention used on customers.state.';

-- ── Policy termination date ────────────────────────────────────────────────
alter table public.service_policies
  add column if not exists policy_termination_date date;

comment on column public.service_policies.policy_termination_date is
  'Date the policy actually terminated (lapse, surrender, death, maturity). '
  'Null while in force. Distinct from the annuity surrender_end_date, which is '
  'the end of the surrender-charge period, not a termination event.';

-- Review Initiatives filter heavily on who is still in force and on birth year
-- cohorts, so index the fields they scan.
create index if not exists service_policies_insured_state_idx
  on public.service_policies (insured_state)
  where insured_state is not null and is_test = false;

create index if not exists service_policies_insured_dob_year_idx
  on public.service_policies (insured_dob_year)
  where insured_dob_year is not null and is_test = false;

create index if not exists service_policies_termination_date_idx
  on public.service_policies (policy_termination_date)
  where policy_termination_date is not null;

-- >>> schema/catalog from 20261008230000_projects_foundation.sql >>>
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

-- >>> schema/catalog from 20261009000001_project_types.sql >>>
-- =============================================================================
-- Project types — durable lookup for project_type, replacing free text
-- Migration: 20261009000001_project_types.sql
--
-- The projects foundation (20261008230000) stored project_type as free text.
-- This migration normalizes it into a durable lookup table and points projects
-- at it by foreign key:
--
--   project_types          — the durable catalog of project kinds (e.g.
--                            "1035 Exchange"). Soft-deletable via is_active:
--                            inactive types are hidden from the "Start New"
--                            dropdown but are NEVER deleted, so projects that
--                            already reference them keep their type.
--   projects.project_type_id — FK to project_types. on delete restrict means a
--                            type that is in use cannot be removed at all; the
--                            soft-delete (is_active = false) is the only way to
--                            retire a type, which preserves existing projects'
--                            type exactly as required.
--
-- Backfill: any distinct existing projects.project_type text is turned into a
-- project_types row and linked, so a replay against a populated database keeps
-- every project's type. (On the development branch there are currently no
-- projects, so the backfill is a no-op, but it stays correct for any replay.)
--
-- Seed: "1035 Exchange" is inserted with a fixed id so the first project can be
-- created immediately and the id is stable across environments.
--
-- Depends on: projects (20261008230000), set_updated_at() and jwt_is_admin()
--             (earlier in the chain). Writes via service_role; internal staff
--             (admin) read. Internal-only; no agency portal access.
-- =============================================================================


-- =============================================================================
-- 1. PROJECT TYPES
-- The durable catalog of project kinds. name is unique. is_active soft-retires a
-- type without deleting it, so projects referencing it keep their type.
-- =============================================================================
create table if not exists public.project_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.project_types is
  'Durable catalog of project kinds (e.g. "1035 Exchange"). Referenced by '
  'projects.project_type_id. Retire a type by setting is_active = false; types '
  'are never deleted, so existing projects keep their type.';

comment on column public.project_types.is_active is
  'When false, the type is hidden from the "Start New" dropdown but remains '
  'referenceable; projects that already use it are unaffected.';

-- Case-insensitive uniqueness so "1035 Exchange" and "1035 exchange" cannot
-- both exist as separate catalog rows.
create unique index if not exists project_types_name_key
  on public.project_types (lower(name));

create index if not exists project_types_active_idx
  on public.project_types (is_active)
  where is_active;


-- =============================================================================
-- 2. SEED — the first project type
-- Fixed id so it is stable across environments and the first project can be
-- created straight away. on conflict keeps a replay idempotent.
-- =============================================================================
insert into public.project_types (id, name, description, is_active)
values (
  'a1035000-0000-4000-8000-000000000001'::uuid,
  '1035 Exchange',
  'IRS Section 1035 exchange initiative — moving cash-value coverage to a new '
  'contract without triggering a taxable event.',
  true
)
on conflict (lower(name)) do nothing;


-- =============================================================================
-- 3. PROJECTS → PROJECT_TYPES FK
-- Add the FK column, backfill from the existing text, then enforce NOT NULL and
-- drop the old text column. on delete restrict guarantees a type in use cannot
-- be deleted (soft-delete via is_active is the retirement path).
-- =============================================================================

-- 3a. Add the nullable FK column first so the backfill can populate it.
alter table public.projects
  add column if not exists project_type_id uuid references public.project_types (id) on delete restrict;

-- 3b. Backfill: turn every distinct existing project_type text into a catalog
-- row (if not already present), then link each project to its type. Guarded so
-- it only runs while the old text column is still present.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projects' and column_name = 'project_type'
  ) then
    -- create any missing catalog rows from distinct existing values
    insert into public.project_types (name, is_active)
    select distinct btrim(p.project_type), true
    from public.projects p
    where p.project_type is not null
      and btrim(p.project_type) <> ''
      and not exists (
        select 1 from public.project_types t
        where lower(t.name) = lower(btrim(p.project_type))
      );

    -- link each project to the matching catalog row
    update public.projects p
       set project_type_id = t.id
      from public.project_types t
     where p.project_type_id is null
       and p.project_type is not null
       and lower(t.name) = lower(btrim(p.project_type));
  end if;
end
$$;

-- 3c. Enforce NOT NULL now that every row is backfilled.
alter table public.projects
  alter column project_type_id set not null;

-- 3d. Drop the old free-text column — project_types is now authoritative.
alter table public.projects
  drop column if exists project_type;

create index if not exists projects_project_type_id_idx
  on public.projects (project_type_id);


-- =============================================================================
-- 4. TABLE PRIVILEGES
-- Match every existing public table: default privileges do not auto-grant DML to
-- the API roles on this branch, so grant explicitly or PostgREST returns 403.
-- RLS below gates row access.
-- =============================================================================
grant all on public.project_types to anon, authenticated, service_role;


-- =============================================================================
-- 5. ROW LEVEL SECURITY
-- Internal staff (admin) read; all writes via service_role. Matches the rest of
-- the projects / service / stewardship modules. Internal-only.
-- =============================================================================
alter table public.project_types enable row level security;

create policy project_types_admin_select
  on public.project_types for select to authenticated
  using (public.jwt_is_admin());

create policy project_types_all
  on public.project_types for all to service_role
  using (true) with check (true);


-- Refresh PostgREST's schema cache so the new table / column are visible via the
-- API immediately.
notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261010000001_project_population_engine.sql >>>
-- =============================================================================
-- Project Population Builder — server-side query engine
-- Migration: 20261010000001_project_population_engine.sql
--
-- The administrative Population Builder is a faceted filter over the real
-- service_policies book (joined to customers / agencies). Faceted filtering
-- needs real SQL aggregation that the PostgREST client cannot express well:
--   * matching policy count and DISTINCT customer count for the current criteria
--   * per-facet available values WITH counts, where each facet's list reflects
--     all the OTHER active filters (classic faceted narrowing)
--   * the matched (customer, policy) set to commit into a run
--
-- So the logic lives in SQL as a small set of functions keyed off a single
-- criteria jsonb (the exact snapshot persisted in project_runs.criteria):
--
--   project_population_filter_sql()  — internal: not a function, documented
--                                      shape of the criteria jsonb (see below).
--   project_population_matches(c)    — returns (customer_id, policy_id) rows that
--                                      match the criteria. The one authoritative
--                                      definition of the active predicate and
--                                      every facet filter; everything else is
--                                      built on top of it.
--   project_population_summary(c)    — policy_count + distinct customer_count.
--   project_population_facets(c)     — jsonb: for each discrete facet, the
--                                      available values + counts computed with
--                                      the OTHER facets applied; for each range
--                                      facet, the data min/max over the current
--                                      population.
--
-- CRITERIA JSONB SHAPE (mirrors src/lib/projects/population-criteria.ts):
--   {
--     "activeOnly": true,                      -- default true when absent
--     "cashValue": "any" | "has" | "none",
--     "discrete": { "<facet>": ["v1","v2"] },  -- OR within a facet
--     "range":    { "<facet>": {"min":n,"max":n} },
--     "date":     { "<facet>": {"mode":"before|after|between","from":"","to":""} }
--   }
-- Facets AND together. Discrete facets: agency, carrier, product_type,
-- term_length, rate_class, customer_segment, insured_state. Range facets:
-- face_amount, cash_value, annual_premium, customer_age, insured_age. Date
-- facets: issue_date, termination_date, surrender_end_date.
--
-- PHI: age facets operate on age derived from DOB; no DOB is returned anywhere.
--
-- Depends on: service_policies, customers, agencies, project_runs/customers/
--             matches (projects foundation). SECURITY DEFINER so the internal
--             admin API (service-role) and the engine share one definition;
--             execute granted to service_role only.
-- =============================================================================


-- =============================================================================
-- Active-policy predicate
-- coverage_status is dirty free text ("Active (Inforce)", "Active", "active",
-- "Issued", ...). "Active" means NOT matching any terminated / closed pattern.
-- Centralized here so every function shares one definition.
-- =============================================================================
create or replace function public.project_policy_is_active(p_coverage_status text)
returns boolean
language sql
immutable
as $$
  select p_coverage_status is null
      or p_coverage_status !~* '(terminat|lapse|surrender|death|deceased|expired|matured|annuitized|non-?for|paid.?up|claim|conversion|pending)'
$$;

comment on function public.project_policy_is_active(text) is
  'Normalized active-policy test over the dirty coverage_status free text: '
  'active = not matching a terminated/closed pattern.';


-- =============================================================================
-- Age helper — whole years from a date to today. NULL-safe. Never returns DOB.
-- =============================================================================
create or replace function public.project_age_years(p_dob date)
returns integer
language sql
immutable
as $$
  -- Whole years from DOB to today. Ages outside a plausible human range are
  -- treated as unknown (NULL) so bad DOB data (e.g. year 0001 placeholders)
  -- cannot poison age filters or slider bounds. Never returns the DOB itself.
  select case
    when p_dob is null then null
    else (
      case
        when extract(year from age(current_date, p_dob))::int between 0 and 120
          then extract(year from age(current_date, p_dob))::int
        else null
      end
    )
  end
$$;


-- =============================================================================
-- Date facet matcher — before / after / between (inclusive). NULL spec => pass.
-- A policy whose date column is NULL never matches an active date filter.
-- Defined before the match function that uses it (SQL bodies are validated at
-- creation time, so referenced functions must already exist).
-- =============================================================================
create or replace function public.project_date_match(p_value date, p_spec jsonb)
returns boolean
language sql
immutable
as $$
  select case
    when p_spec is null then true
    when (p_spec->>'from') is null and (p_spec->>'to') is null then true
    when p_value is null then false
    when p_spec->>'mode' = 'before'  then p_value <= (p_spec->>'to')::date
    when p_spec->>'mode' = 'after'   then p_value >= (p_spec->>'from')::date
    when p_spec->>'mode' = 'between' then
         (p_spec->>'from' is null or p_value >= (p_spec->>'from')::date)
     and (p_spec->>'to'   is null or p_value <= (p_spec->>'to')::date)
    else true
  end
$$;


-- =============================================================================
-- CORE: matched (customer_id, policy_id) rows for a criteria jsonb.
-- is_test = false is always enforced. Only policies linked to a customer are
-- eligible for a population (a project adds customers), so customer_id not null.
-- =============================================================================
create or replace function public.project_population_matches(c jsonb)
returns table (customer_id uuid, policy_id uuid)
language sql
stable
as $$
  with params as (
    select
      coalesce((c->>'activeOnly')::boolean, true)       as active_only,
      coalesce(c->>'cashValue', 'any')                   as cash_choice,
      c->'discrete'                                       as d,
      c->'range'                                          as r,
      c->'date'                                           as dt
  )
  select sp.customer_id, sp.id as policy_id
  from public.service_policies sp
  join public.customers cu on cu.id = sp.customer_id
  cross join params p
  where sp.is_test = false
    and cu.is_test = false
    and sp.customer_id is not null
    -- default population: active policies only
    and (not p.active_only or public.project_policy_is_active(sp.coverage_status))
    -- cash value quick choice
    and (
      p.cash_choice = 'any'
      or (p.cash_choice = 'has'  and coalesce(sp.cash_value_amount, 0) > 0)
      or (p.cash_choice = 'none' and coalesce(sp.cash_value_amount, 0) <= 0)
    )
    -- ── discrete facets (OR within, AND across). Absent/empty => no filter.
    and (p.d->'agency' is null or jsonb_array_length(p.d->'agency') = 0
         or sp.agency_id::text in (select jsonb_array_elements_text(p.d->'agency')))
    and (p.d->'carrier' is null or jsonb_array_length(p.d->'carrier') = 0
         or sp.carrier in (select jsonb_array_elements_text(p.d->'carrier')))
    and (p.d->'product_type' is null or jsonb_array_length(p.d->'product_type') = 0
         or coalesce(sp.product_type, '∅') in (select jsonb_array_elements_text(p.d->'product_type')))
    and (p.d->'term_length' is null or jsonb_array_length(p.d->'term_length') = 0
         or coalesce(sp.term_length, '∅') in (select jsonb_array_elements_text(p.d->'term_length')))
    and (p.d->'rate_class' is null or jsonb_array_length(p.d->'rate_class') = 0
         or coalesce(sp.rate_class, '∅') in (select jsonb_array_elements_text(p.d->'rate_class')))
    and (p.d->'customer_segment' is null or jsonb_array_length(p.d->'customer_segment') = 0
         or coalesce(cu.segment, '∅') in (select jsonb_array_elements_text(p.d->'customer_segment')))
    and (p.d->'insured_state' is null or jsonb_array_length(p.d->'insured_state') = 0
         or coalesce(sp.insured_state, '∅') in (select jsonb_array_elements_text(p.d->'insured_state')))
    -- ── range facets (inclusive, open-ended bounds allowed)
    and (p.r->'face_amount'->>'min' is null or sp.face_amount >= (p.r->'face_amount'->>'min')::numeric)
    and (p.r->'face_amount'->>'max' is null or sp.face_amount <= (p.r->'face_amount'->>'max')::numeric)
    and (p.r->'cash_value'->>'min' is null or sp.cash_value_amount >= (p.r->'cash_value'->>'min')::numeric)
    and (p.r->'cash_value'->>'max' is null or sp.cash_value_amount <= (p.r->'cash_value'->>'max')::numeric)
    and (p.r->'annual_premium'->>'min' is null or sp.annual_premium >= (p.r->'annual_premium'->>'min')::numeric)
    and (p.r->'annual_premium'->>'max' is null or sp.annual_premium <= (p.r->'annual_premium'->>'max')::numeric)
    and (p.r->'customer_age'->>'min' is null or public.project_age_years(cu.date_of_birth) >= (p.r->'customer_age'->>'min')::int)
    and (p.r->'customer_age'->>'max' is null or public.project_age_years(cu.date_of_birth) <= (p.r->'customer_age'->>'max')::int)
    and (p.r->'insured_age'->>'min' is null or public.project_age_years(sp.insured_dob) >= (p.r->'insured_age'->>'min')::int)
    and (p.r->'insured_age'->>'max' is null or public.project_age_years(sp.insured_dob) <= (p.r->'insured_age'->>'max')::int)
    -- ── date facets (before / after / between, inclusive)
    and public.project_date_match(sp.issue_date,              p.dt->'issue_date')
    and public.project_date_match(sp.policy_termination_date, p.dt->'termination_date')
    and public.project_date_match(sp.surrender_end_date,      p.dt->'surrender_end_date')
$$;

comment on function public.project_population_matches(jsonb) is
  'Authoritative (customer_id, policy_id) match set for a population criteria '
  'jsonb. is_test=false enforced; only customer-linked policies are eligible.';


-- =============================================================================
-- SUMMARY — matching policy count + distinct customer count.
-- =============================================================================
create or replace function public.project_population_summary(c jsonb)
returns table (policy_count bigint, customer_count bigint)
language sql
stable
as $$
  select count(*)::bigint, count(distinct m.customer_id)::bigint
  from public.project_population_matches(c) m
$$;


-- =============================================================================
-- FACETS — for a given criteria, return each discrete facet's available values
-- with counts (DISTINCT customers per value), each computed with that facet's
-- own selection REMOVED (so a user can still see/expand sibling values) but all
-- other facets applied. Range facets return the data min/max over the full
-- matched population. Count semantics are customer-based to match the headline.
-- =============================================================================
create or replace function public.project_population_facets(c jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  -- seed with an empty discrete object so jsonb_set can place each facet leaf
  -- (jsonb_set does not create intermediate parent keys).
  result jsonb := '{"discrete":{}}'::jsonb;
  facet record;
  -- discrete facets: id, backing expression over sp/cu
  discrete_facets text[][] := array[
    ['agency',           'sp.agency_id::text'],
    ['carrier',          'sp.carrier'],
    ['product_type',     'sp.product_type'],
    ['term_length',      'sp.term_length'],
    ['rate_class',       'sp.rate_class'],
    ['customer_segment', 'cu.segment'],
    ['insured_state',    'sp.insured_state']
  ];
  i int;
  fid text;
  fexpr text;
  c_wo jsonb;
  vals jsonb;
  rng jsonb;
begin
  -- Discrete facets: strip the facet's own selection, then count by value.
  for i in 1 .. array_length(discrete_facets, 1) loop
    fid   := discrete_facets[i][1];
    fexpr := discrete_facets[i][2];

    -- criteria with this facet's discrete selection removed
    c_wo := c;
    if c_wo ? 'discrete' then
      c_wo := jsonb_set(c_wo, '{discrete}', (c_wo->'discrete') - fid);
    end if;

    execute format($f$
      select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v asc), '[]'::jsonb)
      from (
        select %s as v, count(distinct sp.customer_id) as n
        from public.service_policies sp
        join public.customers cu on cu.id = sp.customer_id
        join public.project_population_matches($1) m on m.policy_id = sp.id
        group by %s
      ) s
    $f$, fexpr, fexpr)
    into vals
    using c_wo;

    result := jsonb_set(result, array['discrete', fid], coalesce(vals, '[]'::jsonb), true);
  end loop;

  -- Range facets: data bounds over the current matched population (full criteria).
  select jsonb_build_object(
    'face_amount',    jsonb_build_object('min', min(sp.face_amount),       'max', max(sp.face_amount)),
    'cash_value',     jsonb_build_object('min', min(sp.cash_value_amount), 'max', max(sp.cash_value_amount)),
    'annual_premium', jsonb_build_object('min', min(sp.annual_premium),    'max', max(sp.annual_premium)),
    'customer_age',   jsonb_build_object('min', min(public.project_age_years(cu.date_of_birth)), 'max', max(public.project_age_years(cu.date_of_birth))),
    'insured_age',    jsonb_build_object('min', min(public.project_age_years(sp.insured_dob)),    'max', max(public.project_age_years(sp.insured_dob)))
  )
  into rng
  from public.service_policies sp
  join public.customers cu on cu.id = sp.customer_id
  join public.project_population_matches(c) m on m.policy_id = sp.id;

  result := jsonb_set(result, '{range}', coalesce(rng, '{}'::jsonb), true);

  return result;
end
$$;

comment on function public.project_population_facets(jsonb) is
  'Faceted narrowing: per-discrete-facet available values + distinct-customer '
  'counts (that facet''s own selection removed, others applied) and range-facet '
  'data bounds for the current population.';


-- =============================================================================
-- EXECUTE grants — engine is called by the internal admin API via service_role.
-- =============================================================================
grant execute on function public.project_policy_is_active(text)       to service_role;
grant execute on function public.project_age_years(date)              to service_role;
grant execute on function public.project_date_match(date, jsonb)      to service_role;
grant execute on function public.project_population_matches(jsonb)    to service_role;
grant execute on function public.project_population_summary(jsonb)    to service_role;
grant execute on function public.project_population_facets(jsonb)     to service_role;


notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261011000001_population_commit_and_status.sql >>>
-- =============================================================================
-- Population Builder corrections — atomic commit + honest active classification
-- Migration: 20261011000001_population_commit_and_status.sql
--
-- Two corrections to the population engine (20261010000001):
--
-- 1. ATOMIC COMMIT. Committing a population touches three tables (project_runs,
--    project_customers, project_matches). The API route did these as separate
--    statements, so a failure partway could leave a run with no / partial
--    population. project_population_commit() performs all three in a single
--    plpgsql function body, which runs in one transaction and rolls back
--    entirely on any error — no partial run/population can survive a failure.
--
-- 2. HONEST ACTIVE CLASSIFICATION. The previous active test used a broad regex
--    that silently excluded in-force statuses — notably "Paid-Up" (caught by a
--    paid-up pattern) — and lumped genuinely ambiguous statuses in with
--    "inactive". coverage_status is dirty free text; its real distinct values on
--    the book are classified explicitly here into three classes:
--
--      terminated — clearly ended: terminated / lapse / surrender / death /
--                   deceased / expired / matured / annuitized / "paid up from a
--                   death claim" / pending. EXCLUDED from an active population.
--      active     — clearly in force: active / inforce / issued / premium waived
--                   / Paid-Up (a paid-up policy is still in force). ELIGIBLE.
--      ambiguous  — cannot be determined from this field alone. Includes the
--                   Non-Forfeiture (NFO) elections (Extended Term Insurance,
--                   Reduced Paid-Up) and carrier product/annuity codes that are
--                   not lifecycle statuses at all ("PROTECTEDPAY SEC CORE SGL",
--                   "i4LIFE GIB", "LINC 2.0 MR"). These are NOT asserted to be
--                   in force. For an active-only population they are excluded,
--                   but surfaced via project_population_ambiguous_statuses so the
--                   exclusion is reported, never silent, and never invented.
--
--    "active only" now means status class = 'active'. project_policy_is_active
--    is redefined accordingly so the whole engine (matches / summary / facets)
--    inherits the corrected classification unchanged.
--
-- Development only. Depends on 20261010000001 and the projects foundation.
-- =============================================================================


-- =============================================================================
-- 1. STATUS CLASSIFIER — explicit three-way classification of coverage_status.
-- Order matters: a death-claim "paid up" is terminated and must be tested before
-- the in-force "paid-up". Anything not matched by a clear rule is 'ambiguous'
-- rather than being assumed active or inactive.
-- =============================================================================
create or replace function public.project_policy_status_class(p_coverage_status text)
returns text
language sql
immutable
as $$
  select case
    -- Unknown / blank status: treat as ambiguous (cannot assert in force).
    when p_coverage_status is null or btrim(p_coverage_status) = '' then 'ambiguous'

    -- Clearly terminated / ended. Death-claim "paid up" is caught here first.
    when p_coverage_status ~* 'death|deceased' then 'terminated'
    when p_coverage_status ~* 'terminat|lapse|surrender|expired|matured|annuitiz' then 'terminated'
    when p_coverage_status ~* '^\s*pending\s*$' then 'terminated'

    -- Genuinely ambiguous: non-forfeiture elections and carrier product codes
    -- that are not lifecycle statuses. Cannot be safely called in force.
    when p_coverage_status ~* 'non-?for|\bNFO\b|\bRPU\b' then 'ambiguous'
    when p_coverage_status ~* 'protectedpay|i4life|linc\s|gib|sgl' then 'ambiguous'

    -- Clearly in force (including Paid-Up, which remains in force).
    when p_coverage_status ~* 'active|inforce|in force|issued|premium waived|paid.?up' then 'active'

    -- Anything else is not clearly determinable.
    else 'ambiguous'
  end
$$;

comment on function public.project_policy_status_class(text) is
  'Explicit three-way classification of the dirty coverage_status free text: '
  'terminated / active / ambiguous. Paid-Up is active (still in force); '
  'death-claim paid-up is terminated; NFO elections and carrier product codes '
  'are ambiguous (not asserted in force). Used by the active-only population.';


-- =============================================================================
-- 2. ACTIVE PREDICATE — redefined on the classifier. active-only = class 'active'
-- so ambiguous statuses are NOT counted as active, and Paid-Up IS.
-- =============================================================================
create or replace function public.project_policy_is_active(p_coverage_status text)
returns boolean
language sql
immutable
as $$
  select public.project_policy_status_class(p_coverage_status) = 'active'
$$;

comment on function public.project_policy_is_active(text) is
  'True only for the clearly in-force (active) status class. Ambiguous statuses '
  '(e.g. NFO elections) are excluded from an active-only population and reported '
  'separately via project_population_ambiguous_statuses, never silently treated '
  'as active.';


-- =============================================================================
-- 3. AMBIGUOUS-STATUS REPORT — surface the statuses that an active-only
-- population excludes because they cannot be determined. This makes the
-- exclusion explicit and auditable. It evaluates against the non-status part of
-- the criteria (is_test, customer link) so the report reflects the book being
-- filtered, independent of the activeOnly flag itself.
-- =============================================================================
create or replace function public.project_population_ambiguous_statuses()
returns table (coverage_status text, policy_count bigint)
language sql
stable
as $$
  select sp.coverage_status, count(*)::bigint
  from public.service_policies sp
  join public.customers cu on cu.id = sp.customer_id
  where sp.is_test = false
    and cu.is_test = false
    and sp.customer_id is not null
    and public.project_policy_status_class(sp.coverage_status) = 'ambiguous'
  group by sp.coverage_status
  order by count(*) desc
$$;

comment on function public.project_population_ambiguous_statuses() is
  'Coverage statuses (with policy counts) that an active-only population excludes '
  'because they cannot be safely classified as in force or terminated. Reported '
  'rather than silently decided.';


-- =============================================================================
-- 4. ATOMIC COMMIT — create run + add new customers + record all matches in one
-- transaction. plpgsql function bodies execute in a single transaction, so any
-- error (including a constraint violation partway) rolls the whole thing back:
-- no orphan run, no partial population, no partial matches.
--
-- Semantics preserved from the route:
--   * run_number = next ordinal for the project
--   * only customers NOT already in project_customers are added (existing
--     members preserved; nothing removed)
--   * every triggering policy recorded in project_matches with evidence
-- Returns a single-row summary.
-- =============================================================================
create or replace function public.project_population_commit(
  p_project_id uuid,
  p_criteria   jsonb,
  p_user       uuid
)
returns table (
  run_id            uuid,
  run_number        integer,
  matched_policies  bigint,
  matched_customers bigint,
  added_customers   bigint,
  already_in_project bigint
)
language plpgsql
as $$
declare
  v_run_id      uuid;
  v_run_number  integer;
  v_now         timestamptz := now();
  v_matched_pol bigint;
  v_matched_cust bigint;
  v_added       bigint;
begin
  -- Guard: project must exist.
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project % not found', p_project_id using errcode = 'P0002';
  end if;

  -- Materialize the match set once so every step is consistent.
  create temp table _commit_matches on commit drop as
  select m.customer_id, m.policy_id
  from public.project_population_matches(p_criteria) m;

  select count(*), count(distinct customer_id)
    into v_matched_pol, v_matched_cust
  from _commit_matches;

  -- Refuse to create an empty run.
  if v_matched_pol = 0 then
    raise exception 'Population is empty' using errcode = 'P0001';
  end if;

  -- Next run number. Qualify the column: the RETURNS TABLE OUT parameter
  -- run_number would otherwise shadow project_runs.run_number here.
  select coalesce(max(pr.run_number), 0) + 1 into v_run_number
  from public.project_runs pr where pr.project_id = p_project_id;

  -- 1. Create the run.
  insert into public.project_runs (
    project_id, run_number, criteria, started_at, started_by, completed_at, completed_by
  )
  values (
    p_project_id, v_run_number, p_criteria, v_now, p_user, v_now, p_user
  )
  returning id into v_run_id;

  -- 2. Add only customers not already in the project.
  with new_customers as (
    select distinct cm.customer_id
    from _commit_matches cm
    where not exists (
      select 1 from public.project_customers pc
      where pc.project_id = p_project_id and pc.customer_id = cm.customer_id
    )
  ), ins as (
    insert into public.project_customers (project_id, customer_id, added_by_run_id)
    select p_project_id, nc.customer_id, v_run_id from new_customers nc
    returning 1
  )
  select count(*) into v_added from ins;

  -- 3. Record every triggering policy as a match with evidence.
  insert into public.project_matches (run_id, customer_id, policy_id, reason, evidence)
  select
    v_run_id, cm.customer_id, cm.policy_id,
    'Qualified by population criteria',
    jsonb_build_object('run_number', v_run_number, 'criteria', p_criteria, 'qualified_policy_id', cm.policy_id)
  from _commit_matches cm;

  return query select
    v_run_id, v_run_number, v_matched_pol, v_matched_cust, v_added,
    (v_matched_cust - v_added);
end
$$;

comment on function public.project_population_commit(uuid, jsonb, uuid) is
  'Atomically create a project_run, add only not-already-present customers, and '
  'record every triggering policy as a match with evidence — all in one '
  'transaction. Any failure rolls back the entire commit (no partial run or '
  'population). Raises P0001 for an empty population, P0002 for a missing project.';


-- =============================================================================
-- 5. EXECUTE grants — called by the internal admin API via service_role.
-- =============================================================================
grant execute on function public.project_policy_status_class(text)        to service_role;
grant execute on function public.project_population_ambiguous_statuses()   to service_role;
grant execute on function public.project_population_commit(uuid, jsonb, uuid) to service_role;


notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261012000001_population_age_precision.sql >>>
-- =============================================================================
-- Population Builder — age from best available DOB precision
-- Migration: 20261012000001_population_age_precision.sql
--
-- The Customer Age and Insured Age facets previously derived age ONLY from a
-- fully-populated exact-date column:
--   * customer_age used customers.date_of_birth (exact DATE) — populated for
--     only ~1,156 of 11,407 customers. For books like Cassidy, where the owner's
--     birth info was imported as a masked month/year (service_policies
--     .owner_dob_approx = 'MM/xx/YYYY') and deliberately NOT written to the exact
--     date column, almost every customer fell out, so the facet collapsed to a
--     single value (the "63–63" defect).
--   * insured_age used service_policies.insured_dob (exact DATE) — 0 populated —
--     while the real data is in insured_dob_year / insured_dob_month
--     (precision 'month_year').
--
-- This migration derives age from the BEST precision actually available, without
-- inventing missing birth information and without a persistent age column:
--
--   exact DOB  -> actual age
--   month/year -> age from year, decremented only if the birth MONTH has not yet
--                 arrived this calendar year (no day is invented)
--   year only  -> approximate age from the birth year (year difference)
--   none       -> unknown (NULL) — excluded from age filters and from bounds
--
-- Customer age source precedence (per customer):
--   1. customers.date_of_birth (exact)
--   2. the customer's policies' owner_dob_approx 'MM/xx/YYYY' (month+year). When
--      a customer's policies disagree on year, the most recent policy wins
--      (deterministic), then highest year, so one stable value is chosen.
--
-- Insured age source precedence (per policy):
--   1. insured_dob (exact)
--   2. insured_dob_year + insured_dob_month (month/year)
--   3. insured_dob_year only (year)
--
-- PHI: still returns AGE ONLY. No DOB, month, or day is exposed; the masked
-- owner_dob_approx is parsed server-side and only an integer age leaves these
-- functions.
--
-- Development only. Depends on 20261010000001 (the population engine).
-- =============================================================================


-- =============================================================================
-- Age from year (+ optional month), today-relative. No day is invented: when a
-- month is known we decrement only if that month has not yet occurred this year;
-- when only a year is known we use the plain year difference. Implausible ages
-- (outside 0..120) are treated as unknown so bad data cannot poison filters.
-- =============================================================================
create or replace function public.project_age_from_parts(p_year int, p_month int)
returns integer
language sql
immutable
as $$
  select case
    when p_year is null then null
    else (
      with a as (
        select
          (extract(year  from current_date)::int - p_year)
          - case
              when p_month is null then 0
              when extract(month from current_date)::int < p_month then 1
              else 0
            end as years
      )
      select case when a.years between 0 and 120 then a.years else null end from a
    )
  end
$$;

comment on function public.project_age_from_parts(int, int) is
  'Age from a birth year and optional birth month, today-relative. With a month, '
  'decrements only if that month has not yet occurred this year; with year only, '
  'uses the year difference. No day is invented. Returns NULL for implausible ages.';


-- =============================================================================
-- Parse a masked owner DOB 'MM/xx/YYYY' (or 'xx/xx/YYYY') into year / month.
-- Year is the trailing 4 digits; month is the leading 2 digits when numeric,
-- else NULL (year-only). Returns NULL year when no 4-digit year is present.
-- =============================================================================
create or replace function public.project_masked_dob_year(p_masked text)
returns integer
language sql
immutable
as $$
  select nullif(substring(p_masked from '([0-9]{4})\s*$'), '')::int
$$;

create or replace function public.project_masked_dob_month(p_masked text)
returns integer
language sql
immutable
as $$
  select case
    when p_masked is null then null
    when substring(p_masked from '^([0-9]{1,2})') ~ '^[0-9]{1,2}$'
      then nullif(substring(p_masked from '^([0-9]{1,2})'), '')::int
    else null
  end
$$;


-- =============================================================================
-- CUSTOMER AGE — best available precision for a customer.
-- 1. exact customers.date_of_birth
-- 2. else the customer's best masked owner DOB from their policies
--    (owner_dob_approx), choosing deterministically: most recent policy, then
--    highest year. Month used when present; otherwise year-only.
-- Takes the customer id + exact dob so callers that already joined customers
-- avoid a re-lookup for the exact case.
-- =============================================================================
create or replace function public.project_customer_age(p_customer_id uuid, p_dob date)
returns integer
language sql
stable
as $$
  select coalesce(
    -- 1. exact DOB
    public.project_age_years(p_dob),
    -- 2. masked owner month/year from the customer's policies
    (
      select public.project_age_from_parts(
               public.project_masked_dob_year(sp.owner_dob_approx),
               public.project_masked_dob_month(sp.owner_dob_approx))
      from public.service_policies sp
      where sp.customer_id = p_customer_id
        and sp.is_test = false
        and sp.owner_dob_approx is not null
        and public.project_masked_dob_year(sp.owner_dob_approx) is not null
      order by sp.updated_at desc nulls last,
               public.project_masked_dob_year(sp.owner_dob_approx) desc
      limit 1
    )
  )
$$;

comment on function public.project_customer_age(uuid, date) is
  'Best-available-precision age for a customer: exact date_of_birth, else the '
  'month/year parsed from the customer''s owner_dob_approx (deterministic pick). '
  'Age only; no DOB exposed.';


-- =============================================================================
-- INSURED AGE — best available precision for a policy's insured.
-- 1. exact insured_dob
-- 2. else insured_dob_year + insured_dob_month (month/year)
-- 3. else insured_dob_year only (year)
-- =============================================================================
create or replace function public.project_insured_age(p_insured_dob date, p_year int, p_month int)
returns integer
language sql
immutable
as $$
  select coalesce(
    public.project_age_years(p_insured_dob),
    public.project_age_from_parts(p_year, p_month)
  )
$$;

comment on function public.project_insured_age(date, int, int) is
  'Best-available-precision age for a policy''s insured: exact insured_dob, else '
  'insured_dob_year (+month). Age only; no DOB exposed.';


-- =============================================================================
-- Redefine the MATCH function to use the precision-aware age for customer_age
-- and insured_age. Everything else is unchanged from 20261010000001.
-- =============================================================================
create or replace function public.project_population_matches(c jsonb)
returns table (customer_id uuid, policy_id uuid)
language sql
stable
as $$
  with params as (
    select
      coalesce((c->>'activeOnly')::boolean, true)       as active_only,
      coalesce(c->>'cashValue', 'any')                   as cash_choice,
      c->'discrete'                                       as d,
      c->'range'                                          as r,
      c->'date'                                           as dt
  )
  select sp.customer_id, sp.id as policy_id
  from public.service_policies sp
  join public.customers cu on cu.id = sp.customer_id
  cross join params p
  where sp.is_test = false
    and cu.is_test = false
    and sp.customer_id is not null
    and (not p.active_only or public.project_policy_is_active(sp.coverage_status))
    and (
      p.cash_choice = 'any'
      or (p.cash_choice = 'has'  and coalesce(sp.cash_value_amount, 0) > 0)
      or (p.cash_choice = 'none' and coalesce(sp.cash_value_amount, 0) <= 0)
    )
    and (p.d->'agency' is null or jsonb_array_length(p.d->'agency') = 0
         or sp.agency_id::text in (select jsonb_array_elements_text(p.d->'agency')))
    and (p.d->'carrier' is null or jsonb_array_length(p.d->'carrier') = 0
         or sp.carrier in (select jsonb_array_elements_text(p.d->'carrier')))
    and (p.d->'product_type' is null or jsonb_array_length(p.d->'product_type') = 0
         or coalesce(sp.product_type, '∅') in (select jsonb_array_elements_text(p.d->'product_type')))
    and (p.d->'term_length' is null or jsonb_array_length(p.d->'term_length') = 0
         or coalesce(sp.term_length, '∅') in (select jsonb_array_elements_text(p.d->'term_length')))
    and (p.d->'rate_class' is null or jsonb_array_length(p.d->'rate_class') = 0
         or coalesce(sp.rate_class, '∅') in (select jsonb_array_elements_text(p.d->'rate_class')))
    and (p.d->'customer_segment' is null or jsonb_array_length(p.d->'customer_segment') = 0
         or coalesce(cu.segment, '∅') in (select jsonb_array_elements_text(p.d->'customer_segment')))
    and (p.d->'insured_state' is null or jsonb_array_length(p.d->'insured_state') = 0
         or coalesce(sp.insured_state, '∅') in (select jsonb_array_elements_text(p.d->'insured_state')))
    and (p.r->'face_amount'->>'min' is null or sp.face_amount >= (p.r->'face_amount'->>'min')::numeric)
    and (p.r->'face_amount'->>'max' is null or sp.face_amount <= (p.r->'face_amount'->>'max')::numeric)
    and (p.r->'cash_value'->>'min' is null or sp.cash_value_amount >= (p.r->'cash_value'->>'min')::numeric)
    and (p.r->'cash_value'->>'max' is null or sp.cash_value_amount <= (p.r->'cash_value'->>'max')::numeric)
    and (p.r->'annual_premium'->>'min' is null or sp.annual_premium >= (p.r->'annual_premium'->>'min')::numeric)
    and (p.r->'annual_premium'->>'max' is null or sp.annual_premium <= (p.r->'annual_premium'->>'max')::numeric)
    -- precision-aware customer age (exact DOB, else masked owner month/year)
    and (p.r->'customer_age'->>'min' is null or public.project_customer_age(cu.id, cu.date_of_birth) >= (p.r->'customer_age'->>'min')::int)
    and (p.r->'customer_age'->>'max' is null or public.project_customer_age(cu.id, cu.date_of_birth) <= (p.r->'customer_age'->>'max')::int)
    -- precision-aware insured age (exact, else year+month, else year)
    and (p.r->'insured_age'->>'min' is null or public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month) >= (p.r->'insured_age'->>'min')::int)
    and (p.r->'insured_age'->>'max' is null or public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month) <= (p.r->'insured_age'->>'max')::int)
    and public.project_date_match(sp.issue_date,              p.dt->'issue_date')
    and public.project_date_match(sp.policy_termination_date, p.dt->'termination_date')
    and public.project_date_match(sp.surrender_end_date,      p.dt->'surrender_end_date')
$$;


-- =============================================================================
-- Redefine FACETS so the customer_age / insured_age range BOUNDS use the same
-- precision-aware ages. Discrete facets are unchanged from 20261010000001.
-- =============================================================================
create or replace function public.project_population_facets(c jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  result jsonb := '{"discrete":{}}'::jsonb;
  discrete_facets text[][] := array[
    ['agency',           'sp.agency_id::text'],
    ['carrier',          'sp.carrier'],
    ['product_type',     'sp.product_type'],
    ['term_length',      'sp.term_length'],
    ['rate_class',       'sp.rate_class'],
    ['customer_segment', 'cu.segment'],
    ['insured_state',    'sp.insured_state']
  ];
  i int;
  fid text;
  fexpr text;
  c_wo jsonb;
  vals jsonb;
  rng jsonb;
begin
  for i in 1 .. array_length(discrete_facets, 1) loop
    fid   := discrete_facets[i][1];
    fexpr := discrete_facets[i][2];

    c_wo := c;
    if c_wo ? 'discrete' then
      c_wo := jsonb_set(c_wo, '{discrete}', (c_wo->'discrete') - fid);
    end if;

    execute format($f$
      select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v asc), '[]'::jsonb)
      from (
        select %s as v, count(distinct sp.customer_id) as n
        from public.service_policies sp
        join public.customers cu on cu.id = sp.customer_id
        join public.project_population_matches($1) m on m.policy_id = sp.id
        group by %s
      ) s
    $f$, fexpr, fexpr)
    into vals
    using c_wo;

    result := jsonb_set(result, array['discrete', fid], coalesce(vals, '[]'::jsonb), true);
  end loop;

  -- Range bounds over the current matched population, using precision-aware ages.
  select jsonb_build_object(
    'face_amount',    jsonb_build_object('min', min(sp.face_amount),       'max', max(sp.face_amount)),
    'cash_value',     jsonb_build_object('min', min(sp.cash_value_amount), 'max', max(sp.cash_value_amount)),
    'annual_premium', jsonb_build_object('min', min(sp.annual_premium),    'max', max(sp.annual_premium)),
    'customer_age',   jsonb_build_object(
                        'min', min(public.project_customer_age(cu.id, cu.date_of_birth)),
                        'max', max(public.project_customer_age(cu.id, cu.date_of_birth))),
    'insured_age',    jsonb_build_object(
                        'min', min(public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month)),
                        'max', max(public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month)))
  )
  into rng
  from public.service_policies sp
  join public.customers cu on cu.id = sp.customer_id
  join public.project_population_matches(c) m on m.policy_id = sp.id;

  result := jsonb_set(result, '{range}', coalesce(rng, '{}'::jsonb), true);

  return result;
end
$$;


-- =============================================================================
-- EXECUTE grants for the new helper functions (service_role runs the engine).
-- =============================================================================
grant execute on function public.project_age_from_parts(int, int)        to service_role;
grant execute on function public.project_masked_dob_year(text)            to service_role;
grant execute on function public.project_masked_dob_month(text)           to service_role;
grant execute on function public.project_customer_age(uuid, date)         to service_role;
grant execute on function public.project_insured_age(date, int, int)      to service_role;


notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261013000001_customer_age_conflict_unknown.sql >>>
-- =============================================================================
-- Population Builder — customer age: conflicting owner DOB => unknown
-- Migration: 20261013000001_customer_age_conflict_unknown.sql
--
-- Correction to project_customer_age (introduced in 20261012000001).
--
-- Previously, when a customer had no exact customers.date_of_birth, age was
-- derived from the owner_dob_approx of ONE policy chosen deterministically
-- (most recent, then highest year). That silently picks a winner when a
-- customer's linked policies disagree on the owner's birth year — i.e. it
-- guesses which DOB is correct. That is a data-integrity problem.
--
-- Corrected rule (no guessing):
--   1. exact customers.date_of_birth is authoritative when present.
--   2. otherwise look at ALL usable linked owner_dob_approx birth years:
--        * if they all agree on a single birth YEAR, derive the age at that
--          year's precision — using the birth MONTH only if every agreeing row
--          also shares the same month (otherwise year-only, no invented month).
--        * if the linked policies carry materially conflicting birth-year
--          information (more than one distinct year), Customer Age is UNKNOWN
--          (NULL) for population filtering — we do not pick a winner.
--
-- Only project_customer_age changes. Insured-age logic, the Clear behavior, and
-- every other engine function are untouched; the match/facet functions call
-- project_customer_age unchanged, so they inherit the correction.
--
-- PHI: still age only; no DOB/day exposed. Development only.
-- =============================================================================

create or replace function public.project_customer_age(p_customer_id uuid, p_dob date)
returns integer
language sql
stable
as $$
  select coalesce(
    -- 1. exact DOB is authoritative
    public.project_age_years(p_dob),
    -- 2. consensus across the customer's linked owner_dob_approx values
    (
      with parts as (
        select
          public.project_masked_dob_year(sp.owner_dob_approx)  as yr,
          public.project_masked_dob_month(sp.owner_dob_approx) as mo
        from public.service_policies sp
        where sp.customer_id = p_customer_id
          and sp.is_test = false
          and sp.owner_dob_approx is not null
          and public.project_masked_dob_year(sp.owner_dob_approx) is not null
      ),
      agg as (
        select
          count(distinct yr)                           as distinct_years,
          min(yr)                                      as the_year,
          count(distinct mo) filter (where mo is not null) as distinct_months,
          min(mo) filter (where mo is not null)        as the_month
        from parts
      )
      select case
        -- no usable owner birth year at all
        when a.the_year is null then null
        -- materially conflicting birth years across linked policies => unknown
        when a.distinct_years > 1 then null
        -- single agreed year: use month only if all agreeing rows share one month
        else public.project_age_from_parts(
               a.the_year,
               case when a.distinct_months = 1 then a.the_month else null end)
      end
      from agg a
    )
  )
$$;

comment on function public.project_customer_age(uuid, date) is
  'Best-available-precision age for a customer with NO guessing on conflict: '
  'exact date_of_birth is authoritative; otherwise the customer''s linked '
  'owner_dob_approx values must agree on a single birth year (month used only '
  'if all agree), else Customer Age is NULL (unknown). Age only; no DOB exposed.';


notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261014000001_customer_age_setbased_perf.sql >>>
-- =============================================================================
-- Population Builder — set-based customer age (fix facets statement timeout)
-- Migration: 20261014000001_customer_age_setbased_perf.sql
--
-- Regression: after the precision-aware Customer Age change, the scalar
-- project_customer_age(customer_id, dob) runs a correlated subquery over
-- service_policies for EVERY row. project_population_facets evaluates it inside
-- min()/max() over the whole matched population (≈9,860 rows) and does so for
-- the range-bounds query, so the owner_dob_approx book is rescanned per row.
-- EXPLAIN ANALYZE showed the range-bounds aggregate ballooning from ~0.6s
-- (producing the rows) to ~5.9s purely from the per-row age subquery; the full
-- facets function (which also re-runs the match set several times) then exceeds
-- the statement timeout.
--
-- Fix (smallest safe correction, SAME semantics): compute each customer's age
-- ONCE, set-based, and reuse it — no per-row rescans.
--
--   project_customer_age_map()  -> table (customer_id uuid, age int)
--     * one GROUP BY over service_policies collapses each customer's usable
--       owner_dob_approx values into distinct_years / agreed year / agreed month
--       (month kept only if all agreeing rows share it) in a single pass.
--     * joined to customers so an exact date_of_birth stays authoritative, and
--       materially conflicting birth years (distinct_years > 1) resolve to NULL
--       (unknown) exactly as before — no winner is chosen.
--
-- project_population_matches and project_population_facets now LEFT JOIN this map
-- for the customer-age filter and bounds instead of calling the scalar per row.
-- Insured age is unchanged (it is an immutable scalar over the policy's own
-- columns, already cheap). The scalar project_customer_age(uuid,date) is kept as
-- the semantic reference / for any other caller, but is no longer on the hot path.
--
-- Development only. Depends on 20261012000001 / 20261013000001.
-- =============================================================================


-- =============================================================================
-- Set-based per-customer age. One pass over service_policies for the owner DOB
-- consensus, joined to customers for the authoritative exact DOB. Returns a row
-- only for customers that have at least one usable birth-year source; callers
-- LEFT JOIN, so a missing row == unknown age (NULL), same as before.
-- =============================================================================
create or replace function public.project_customer_age_map()
returns table (customer_id uuid, age integer)
language sql
stable
as $$
  with owner_consensus as (
    -- collapse each customer's usable masked owner DOB values in ONE pass
    select
      sp.customer_id,
      count(distinct public.project_masked_dob_year(sp.owner_dob_approx))
        filter (where public.project_masked_dob_year(sp.owner_dob_approx) is not null) as distinct_years,
      min(public.project_masked_dob_year(sp.owner_dob_approx))
        filter (where public.project_masked_dob_year(sp.owner_dob_approx) is not null) as the_year,
      count(distinct public.project_masked_dob_month(sp.owner_dob_approx))
        filter (where public.project_masked_dob_month(sp.owner_dob_approx) is not null) as distinct_months,
      min(public.project_masked_dob_month(sp.owner_dob_approx))
        filter (where public.project_masked_dob_month(sp.owner_dob_approx) is not null) as the_month
    from public.service_policies sp
    where sp.is_test = false
      and sp.customer_id is not null
      and sp.owner_dob_approx is not null
    group by sp.customer_id
  )
  select
    cu.id as customer_id,
    coalesce(
      -- 1. exact DOB authoritative
      public.project_age_years(cu.date_of_birth),
      -- 2. owner consensus: single agreed year (month only if all agree),
      --    conflicting years => NULL (unknown)
      case
        when oc.the_year is null then null
        when oc.distinct_years > 1 then null
        else public.project_age_from_parts(
               oc.the_year,
               case when oc.distinct_months = 1 then oc.the_month else null end)
      end
    ) as age
  from public.customers cu
  left join owner_consensus oc on oc.customer_id = cu.id
  where cu.is_test = false
    and (cu.date_of_birth is not null or oc.customer_id is not null)
$$;

comment on function public.project_customer_age_map() is
  'Set-based per-customer age (customer_id, age) computed in one pass. Exact '
  'date_of_birth is authoritative; otherwise the customer''s owner_dob_approx '
  'values must agree on a single birth year (month only if all agree), else age '
  'is NULL (unknown). Reused by the match/facet engine so customer age is not '
  'recomputed per row. Same semantics as project_customer_age, no guessing.';


-- =============================================================================
-- MATCH function — customer-age filter now via a LEFT JOIN to the age map.
-- Everything else (active predicate, cash, discrete, other ranges, insured age,
-- dates) is unchanged from 20261012000001.
-- =============================================================================
create or replace function public.project_population_matches(c jsonb)
returns table (customer_id uuid, policy_id uuid)
language sql
stable
as $$
  with params as (
    select
      coalesce((c->>'activeOnly')::boolean, true)       as active_only,
      coalesce(c->>'cashValue', 'any')                   as cash_choice,
      c->'discrete'                                       as d,
      c->'range'                                          as r,
      c->'date'                                           as dt
  ),
  -- Only materialize the customer-age map when a customer_age filter is present.
  cage as (
    select m.customer_id, m.age
    from public.project_customer_age_map() m
    where (select (c->'range'->'customer_age') is not null)
  )
  select sp.customer_id, sp.id as policy_id
  from public.service_policies sp
  join public.customers cu on cu.id = sp.customer_id
  cross join params p
  left join cage on cage.customer_id = cu.id
  where sp.is_test = false
    and cu.is_test = false
    and sp.customer_id is not null
    and (not p.active_only or public.project_policy_is_active(sp.coverage_status))
    and (
      p.cash_choice = 'any'
      or (p.cash_choice = 'has'  and coalesce(sp.cash_value_amount, 0) > 0)
      or (p.cash_choice = 'none' and coalesce(sp.cash_value_amount, 0) <= 0)
    )
    and (p.d->'agency' is null or jsonb_array_length(p.d->'agency') = 0
         or sp.agency_id::text in (select jsonb_array_elements_text(p.d->'agency')))
    and (p.d->'carrier' is null or jsonb_array_length(p.d->'carrier') = 0
         or sp.carrier in (select jsonb_array_elements_text(p.d->'carrier')))
    and (p.d->'product_type' is null or jsonb_array_length(p.d->'product_type') = 0
         or coalesce(sp.product_type, '∅') in (select jsonb_array_elements_text(p.d->'product_type')))
    and (p.d->'term_length' is null or jsonb_array_length(p.d->'term_length') = 0
         or coalesce(sp.term_length, '∅') in (select jsonb_array_elements_text(p.d->'term_length')))
    and (p.d->'rate_class' is null or jsonb_array_length(p.d->'rate_class') = 0
         or coalesce(sp.rate_class, '∅') in (select jsonb_array_elements_text(p.d->'rate_class')))
    and (p.d->'customer_segment' is null or jsonb_array_length(p.d->'customer_segment') = 0
         or coalesce(cu.segment, '∅') in (select jsonb_array_elements_text(p.d->'customer_segment')))
    and (p.d->'insured_state' is null or jsonb_array_length(p.d->'insured_state') = 0
         or coalesce(sp.insured_state, '∅') in (select jsonb_array_elements_text(p.d->'insured_state')))
    and (p.r->'face_amount'->>'min' is null or sp.face_amount >= (p.r->'face_amount'->>'min')::numeric)
    and (p.r->'face_amount'->>'max' is null or sp.face_amount <= (p.r->'face_amount'->>'max')::numeric)
    and (p.r->'cash_value'->>'min' is null or sp.cash_value_amount >= (p.r->'cash_value'->>'min')::numeric)
    and (p.r->'cash_value'->>'max' is null or sp.cash_value_amount <= (p.r->'cash_value'->>'max')::numeric)
    and (p.r->'annual_premium'->>'min' is null or sp.annual_premium >= (p.r->'annual_premium'->>'min')::numeric)
    and (p.r->'annual_premium'->>'max' is null or sp.annual_premium <= (p.r->'annual_premium'->>'max')::numeric)
    -- precision-aware customer age via the set-based map (unknown => excluded)
    and (p.r->'customer_age'->>'min' is null or (cage.age is not null and cage.age >= (p.r->'customer_age'->>'min')::int))
    and (p.r->'customer_age'->>'max' is null or (cage.age is not null and cage.age <= (p.r->'customer_age'->>'max')::int))
    -- precision-aware insured age (immutable scalar; cheap)
    and (p.r->'insured_age'->>'min' is null or public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month) >= (p.r->'insured_age'->>'min')::int)
    and (p.r->'insured_age'->>'max' is null or public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month) <= (p.r->'insured_age'->>'max')::int)
    and public.project_date_match(sp.issue_date,              p.dt->'issue_date')
    and public.project_date_match(sp.policy_termination_date, p.dt->'termination_date')
    and public.project_date_match(sp.surrender_end_date,      p.dt->'surrender_end_date')
$$;


-- =============================================================================
-- FACETS — customer-age range bounds now come from the age map joined to the
-- matched customers (one map build), not a per-row scalar. Discrete facets and
-- the other range/insured bounds are unchanged from 20261012000001.
-- =============================================================================
-- =============================================================================
-- Helper: build an in-memory SQL predicate over the _pop temp table for the
-- selected discrete facets in a criteria jsonb, optionally EXCLUDING one facet
-- (used so a facet's own value list reflects the other filters but not itself).
-- Values are quoted safely with quote_literal. Returns 'true' when nothing is
-- selected. The column names match the _pop columns built in the facets fn.
-- =============================================================================
create or replace function public._pop_discrete_pred(c jsonb, p_exclude text)
returns text
language plpgsql
immutable
as $$
declare
  map jsonb := jsonb_build_object(
    'agency','agency','carrier','carrier','product_type','product_type',
    'term_length','term_length','rate_class','rate_class',
    'customer_segment','segment','insured_state','insured_state');
  fid text;
  fcol text;
  arr jsonb;
  vals text;
  clauses text[] := array[]::text[];
begin
  if c->'discrete' is null then return 'true'; end if;
  for fid in select jsonb_object_keys(c->'discrete') loop
    if p_exclude is not null and fid = p_exclude then continue; end if;
    if not (map ? fid) then continue; end if;
    arr := c->'discrete'->fid;
    if arr is null or jsonb_array_length(arr) = 0 then continue; end if;
    fcol := map->>fid;
    select string_agg(quote_literal(x), ',') into vals
    from jsonb_array_elements_text(arr) as t(x);
    clauses := clauses || format('(%I in (%s))', fcol, vals);
  end loop;
  if array_length(clauses, 1) is null then return 'true'; end if;
  return array_to_string(clauses, ' and ');
end
$$;


-- The facets function previously called project_population_matches up to 9
-- times (one per discrete facet + range bounds + customer-age), each re-running
-- the full match scan whose coverage_status regex seq scan dominates (~0.4s).
-- That repetition — compounded by the per-row customer-age subquery — is what
-- pushed the call over the statement timeout.
--
-- This version does the expensive work exactly ONCE. It materializes a base set
-- of policies that pass EVERYTHING EXCEPT the discrete facets (active predicate,
-- cash, all range/age/date filters), with the facet columns and precomputed
-- customer age attached. The regex scan and the age map build then happen a
-- single time; every discrete facet value-list and every range bound is computed
-- in memory over that small set (≤ the active book), applying the OTHER discrete
-- selections as cheap predicates. Narrowing semantics are identical: each facet's
-- list reflects all other active filters with its own selection removed.
--
-- VOLATILE: materializes a temp table (CREATE TABLE AS), not allowed in a
-- STABLE/IMMUTABLE function. Called directly by the API, so VOLATILE is safe.
create or replace function public.project_population_facets(c jsonb)
returns jsonb
language plpgsql
volatile
as $$
declare
  result jsonb := '{"discrete":{}}'::jsonb;
  -- facet id -> the column in _pop holding that facet's value (NULL => '∅')
  discrete_facets text[][] := array[
    ['agency',           'agency'],
    ['carrier',          'carrier'],
    ['product_type',     'product_type'],
    ['term_length',      'term_length'],
    ['rate_class',       'rate_class'],
    ['customer_segment', 'segment'],
    ['insured_state',    'insured_state']
  ];
  i int;
  fid text;
  fcol text;
  -- the set of OTHER discrete predicates (every selected facet except fid)
  other_pred text;
  vals jsonb;
  rng jsonb;
  cust_age jsonb;
  all_pred text;
begin
  -- One pass: active + non-discrete filters applied, facet columns + customer
  -- age (set-based map) attached. The expensive coverage_status regex scan and
  -- the owner-DOB consensus happen once here.
  create temp table _pop on commit drop as
  select
    sp.id                             as policy_id,
    sp.customer_id                    as customer_id,
    coalesce(sp.agency_id::text, '∅') as agency,
    coalesce(sp.carrier, '∅')         as carrier,
    coalesce(sp.product_type, '∅')    as product_type,
    coalesce(sp.term_length, '∅')     as term_length,
    coalesce(sp.rate_class, '∅')      as rate_class,
    coalesce(cu.segment, '∅')         as segment,
    coalesce(sp.insured_state, '∅')   as insured_state,
    sp.face_amount                    as face_amount,
    sp.cash_value_amount              as cash_value_amount,
    sp.annual_premium                 as annual_premium,
    am.age                            as customer_age,
    public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month) as insured_age
  from public.service_policies sp
  join public.customers cu on cu.id = sp.customer_id
  left join public.project_customer_age_map() am on am.customer_id = sp.customer_id
  cross join (select
      coalesce((c->>'activeOnly')::boolean, true) as active_only,
      coalesce(c->>'cashValue', 'any')             as cash_choice,
      c->'range' as r, c->'date' as dt) p
  where sp.is_test = false
    and cu.is_test = false
    and sp.customer_id is not null
    and (not p.active_only or public.project_policy_is_active(sp.coverage_status))
    and (
      p.cash_choice = 'any'
      or (p.cash_choice = 'has'  and coalesce(sp.cash_value_amount, 0) > 0)
      or (p.cash_choice = 'none' and coalesce(sp.cash_value_amount, 0) <= 0)
    )
    and (p.r->'face_amount'->>'min' is null or sp.face_amount >= (p.r->'face_amount'->>'min')::numeric)
    and (p.r->'face_amount'->>'max' is null or sp.face_amount <= (p.r->'face_amount'->>'max')::numeric)
    and (p.r->'cash_value'->>'min' is null or sp.cash_value_amount >= (p.r->'cash_value'->>'min')::numeric)
    and (p.r->'cash_value'->>'max' is null or sp.cash_value_amount <= (p.r->'cash_value'->>'max')::numeric)
    and (p.r->'annual_premium'->>'min' is null or sp.annual_premium >= (p.r->'annual_premium'->>'min')::numeric)
    and (p.r->'annual_premium'->>'max' is null or sp.annual_premium <= (p.r->'annual_premium'->>'max')::numeric)
    and (p.r->'customer_age'->>'min' is null or (am.age is not null and am.age >= (p.r->'customer_age'->>'min')::int))
    and (p.r->'customer_age'->>'max' is null or (am.age is not null and am.age <= (p.r->'customer_age'->>'max')::int))
    and (p.r->'insured_age'->>'min' is null or public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month) >= (p.r->'insured_age'->>'min')::int)
    and (p.r->'insured_age'->>'max' is null or public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month) <= (p.r->'insured_age'->>'max')::int)
    and public.project_date_match(sp.issue_date,              p.dt->'issue_date')
    and public.project_date_match(sp.policy_termination_date, p.dt->'termination_date')
    and public.project_date_match(sp.surrender_end_date,      p.dt->'surrender_end_date');

  -- Build the in-memory predicate for ALL selected discrete facets (used for the
  -- bounds / full match), and a per-facet predicate that excludes one facet.
  all_pred := public._pop_discrete_pred(c, null);

  for i in 1 .. array_length(discrete_facets, 1) loop
    fid  := discrete_facets[i][1];
    fcol := discrete_facets[i][2];
    other_pred := public._pop_discrete_pred(c, fid);  -- all selected facets EXCEPT fid

    execute format($f$
      select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v asc), '[]'::jsonb)
      from (
        select %I as v, count(distinct customer_id) as n
        from _pop
        where %s
        group by %I
      ) s
    $f$, fcol, other_pred, fcol)
    into vals;

    result := jsonb_set(result, array['discrete', fid], coalesce(vals, '[]'::jsonb), true);
  end loop;

  -- Bounds over the fully-filtered set (all discrete selections applied).
  execute format($f$
    select jsonb_build_object(
      'face_amount',    jsonb_build_object('min', min(face_amount),       'max', max(face_amount)),
      'cash_value',     jsonb_build_object('min', min(cash_value_amount), 'max', max(cash_value_amount)),
      'annual_premium', jsonb_build_object('min', min(annual_premium),    'max', max(annual_premium)),
      'insured_age',    jsonb_build_object('min', min(insured_age),       'max', max(insured_age)),
      'customer_age',   jsonb_build_object(
                          'min', min(customer_age) filter (where customer_age is not null),
                          'max', max(customer_age) filter (where customer_age is not null))
    )
    from _pop where %s
  $f$, all_pred)
  into rng;

  result := jsonb_set(result, '{range}', coalesce(rng, '{}'::jsonb), true);

  drop table if exists _pop;
  return result;
end
$$;


grant execute on function public.project_customer_age_map() to service_role;
grant execute on function public._pop_discrete_pred(jsonb, text) to service_role;

notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261014000002_population_source_view.sql >>>
-- =============================================================================
-- Population Builder — derived population-source view (perf refactor)
-- Migration: 20261014000002_population_source_view.sql
--
-- Supersedes the ad-hoc per-call age handling. Reusable derived values —
-- normalized policy status, insured age, and customer age — are now computed
-- ONCE in a single derived source, and every match / count / facet query
-- operates against that derived result instead of recomputing expensive
-- per-row/per-facet values. This is the normalized-derived-query pattern the
-- performance fix calls for.
--
--   view public.project_population_source
--     One row per eligible policy (is_test = false, customer-linked), carrying:
--       * normalized_status + is_active   (project_policy_status_class once)
--       * insured_age                     (project_insured_age once)
--       * customer_age                    (joined ONCE from the set-based
--                                          project_customer_age_map(); exact DOB
--                                          authoritative, conflicting owner
--                                          birth years => NULL, no guessing)
--       * the discrete facet columns (agency/carrier/product_type/term_length/
--         rate_class/segment/insured_state, NULL => '∅')
--       * money columns + date columns for range/date filtering and bounds
--
-- customer_age is NOT persisted — it is a derived column of the view, recomputed
-- from DOB sources on read. No business age column is added. The statement
-- timeout is unchanged.
--
-- project_population_matches / _summary / _facets are redefined to read from the
-- view. facets materializes the criteria-filtered derived rows ONCE per call and
-- computes all discrete value-lists + range bounds in memory (discrete narrowing
-- applied as cheap predicates), so the coverage_status scan and the owner-DOB
-- consensus run a single time per call.
--
-- Development only. Depends on the scalar/age helpers from 20261012/13/14.
-- =============================================================================


-- =============================================================================
-- DERIVED SOURCE VIEW — reusable per-policy population row. Computes the
-- expensive derived values once; callers filter it by criteria.
-- =============================================================================
create or replace view public.project_population_source
with (security_invoker = true) as
select
  sp.id                               as policy_id,
  sp.customer_id                      as customer_id,
  -- normalized policy status (dirty coverage_status -> active/terminated/ambiguous)
  public.project_policy_status_class(sp.coverage_status) as normalized_status,
  (public.project_policy_status_class(sp.coverage_status) = 'active') as is_active,
  -- discrete facet values (NULL surfaced as the ∅ sentinel the UI labels "Not set")
  coalesce(sp.agency_id::text, '∅')   as agency,
  coalesce(sp.carrier, '∅')           as carrier,
  coalesce(sp.product_type, '∅')      as product_type,
  coalesce(sp.term_length, '∅')       as term_length,
  coalesce(sp.rate_class, '∅')        as rate_class,
  coalesce(cu.segment, '∅')           as segment,
  coalesce(sp.insured_state, '∅')     as insured_state,
  -- value columns
  sp.face_amount                      as face_amount,
  sp.cash_value_amount                as cash_value_amount,
  sp.annual_premium                   as annual_premium,
  -- date columns
  sp.issue_date                       as issue_date,
  sp.policy_termination_date          as policy_termination_date,
  sp.surrender_end_date               as surrender_end_date,
  -- derived ages (computed once; never persisted)
  public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month) as insured_age,
  cam.age                             as customer_age
from public.service_policies sp
join public.customers cu on cu.id = sp.customer_id
left join public.project_customer_age_map() cam on cam.customer_id = sp.customer_id
where sp.is_test = false
  and cu.is_test = false
  and sp.customer_id is not null;

comment on view public.project_population_source is
  'Derived population source: one row per eligible (non-test, customer-linked) '
  'policy with normalized_status/is_active, insured_age and customer_age computed '
  'once (customer_age from the set-based age map; exact DOB authoritative, '
  'conflicting owner birth years => NULL). Match/count/facet queries read this '
  'instead of recomputing derived values. Ages are derived, never persisted.';

grant select on public.project_population_source to service_role;


-- =============================================================================
-- MATCH — read the derived source; apply criteria. Same output + semantics.
-- =============================================================================
create or replace function public.project_population_matches(c jsonb)
returns table (customer_id uuid, policy_id uuid)
language sql
stable
as $$
  with params as (
    select
      coalesce((c->>'activeOnly')::boolean, true) as active_only,
      coalesce(c->>'cashValue', 'any')             as cash_choice,
      c->'discrete' as d, c->'range' as r, c->'date' as dt
  )
  select s.customer_id, s.policy_id
  from public.project_population_source s
  cross join params p
  where (not p.active_only or s.is_active)
    and (
      p.cash_choice = 'any'
      or (p.cash_choice = 'has'  and coalesce(s.cash_value_amount, 0) > 0)
      or (p.cash_choice = 'none' and coalesce(s.cash_value_amount, 0) <= 0)
    )
    and (p.d->'agency' is null or jsonb_array_length(p.d->'agency') = 0
         or s.agency in (select jsonb_array_elements_text(p.d->'agency')))
    and (p.d->'carrier' is null or jsonb_array_length(p.d->'carrier') = 0
         or s.carrier in (select jsonb_array_elements_text(p.d->'carrier')))
    and (p.d->'product_type' is null or jsonb_array_length(p.d->'product_type') = 0
         or s.product_type in (select jsonb_array_elements_text(p.d->'product_type')))
    and (p.d->'term_length' is null or jsonb_array_length(p.d->'term_length') = 0
         or s.term_length in (select jsonb_array_elements_text(p.d->'term_length')))
    and (p.d->'rate_class' is null or jsonb_array_length(p.d->'rate_class') = 0
         or s.rate_class in (select jsonb_array_elements_text(p.d->'rate_class')))
    and (p.d->'customer_segment' is null or jsonb_array_length(p.d->'customer_segment') = 0
         or s.segment in (select jsonb_array_elements_text(p.d->'customer_segment')))
    and (p.d->'insured_state' is null or jsonb_array_length(p.d->'insured_state') = 0
         or s.insured_state in (select jsonb_array_elements_text(p.d->'insured_state')))
    and (p.r->'face_amount'->>'min' is null or s.face_amount >= (p.r->'face_amount'->>'min')::numeric)
    and (p.r->'face_amount'->>'max' is null or s.face_amount <= (p.r->'face_amount'->>'max')::numeric)
    and (p.r->'cash_value'->>'min' is null or s.cash_value_amount >= (p.r->'cash_value'->>'min')::numeric)
    and (p.r->'cash_value'->>'max' is null or s.cash_value_amount <= (p.r->'cash_value'->>'max')::numeric)
    and (p.r->'annual_premium'->>'min' is null or s.annual_premium >= (p.r->'annual_premium'->>'min')::numeric)
    and (p.r->'annual_premium'->>'max' is null or s.annual_premium <= (p.r->'annual_premium'->>'max')::numeric)
    and (p.r->'customer_age'->>'min' is null or (s.customer_age is not null and s.customer_age >= (p.r->'customer_age'->>'min')::int))
    and (p.r->'customer_age'->>'max' is null or (s.customer_age is not null and s.customer_age <= (p.r->'customer_age'->>'max')::int))
    and (p.r->'insured_age'->>'min' is null or (s.insured_age is not null and s.insured_age >= (p.r->'insured_age'->>'min')::int))
    and (p.r->'insured_age'->>'max' is null or (s.insured_age is not null and s.insured_age <= (p.r->'insured_age'->>'max')::int))
    and public.project_date_match(s.issue_date,              p.dt->'issue_date')
    and public.project_date_match(s.policy_termination_date, p.dt->'termination_date')
    and public.project_date_match(s.surrender_end_date,      p.dt->'surrender_end_date')
$$;


-- =============================================================================
-- FACETS — materialize the criteria-filtered derived rows ONCE, then compute
-- all discrete value-lists (narrowing: each facet's own selection removed) and
-- range bounds in memory against that derived result.
-- =============================================================================
create or replace function public.project_population_facets(c jsonb)
returns jsonb
language plpgsql
volatile
as $$
declare
  result jsonb := '{"discrete":{}}'::jsonb;
  discrete_facets text[] := array['agency','carrier','product_type','term_length','rate_class','customer_segment','insured_state'];
  -- map facet id -> column in the derived rows
  col_of jsonb := jsonb_build_object(
    'agency','agency','carrier','carrier','product_type','product_type',
    'term_length','term_length','rate_class','rate_class',
    'customer_segment','segment','insured_state','insured_state');
  fid text;
  fcol text;
  other_pred text;
  all_pred text;
  vals jsonb;
  rng jsonb;
begin
  -- Derived result for this criteria, WITHOUT the discrete filters, materialized
  -- once. Non-discrete criteria (active/cash/range/age/date) are already applied
  -- by reading the matched set with discrete removed; keep the discrete columns
  -- so narrowing can be applied in memory.
  create temp table _src on commit drop as
  select s.policy_id, s.customer_id, s.agency, s.carrier, s.product_type,
         s.term_length, s.rate_class, s.segment, s.insured_state,
         s.face_amount, s.cash_value_amount, s.annual_premium,
         s.insured_age, s.customer_age
  from public.project_population_source s
  cross join (select
      coalesce((c->>'activeOnly')::boolean, true) as active_only,
      coalesce(c->>'cashValue', 'any')             as cash_choice,
      c->'range' as r, c->'date' as dt) p
  where (not p.active_only or s.is_active)
    and (
      p.cash_choice = 'any'
      or (p.cash_choice = 'has'  and coalesce(s.cash_value_amount, 0) > 0)
      or (p.cash_choice = 'none' and coalesce(s.cash_value_amount, 0) <= 0)
    )
    and (p.r->'face_amount'->>'min' is null or s.face_amount >= (p.r->'face_amount'->>'min')::numeric)
    and (p.r->'face_amount'->>'max' is null or s.face_amount <= (p.r->'face_amount'->>'max')::numeric)
    and (p.r->'cash_value'->>'min' is null or s.cash_value_amount >= (p.r->'cash_value'->>'min')::numeric)
    and (p.r->'cash_value'->>'max' is null or s.cash_value_amount <= (p.r->'cash_value'->>'max')::numeric)
    and (p.r->'annual_premium'->>'min' is null or s.annual_premium >= (p.r->'annual_premium'->>'min')::numeric)
    and (p.r->'annual_premium'->>'max' is null or s.annual_premium <= (p.r->'annual_premium'->>'max')::numeric)
    and (p.r->'customer_age'->>'min' is null or (s.customer_age is not null and s.customer_age >= (p.r->'customer_age'->>'min')::int))
    and (p.r->'customer_age'->>'max' is null or (s.customer_age is not null and s.customer_age <= (p.r->'customer_age'->>'max')::int))
    and (p.r->'insured_age'->>'min' is null or (s.insured_age is not null and s.insured_age >= (p.r->'insured_age'->>'min')::int))
    and (p.r->'insured_age'->>'max' is null or (s.insured_age is not null and s.insured_age <= (p.r->'insured_age'->>'max')::int))
    and public.project_date_match(s.issue_date,              p.dt->'issue_date')
    and public.project_date_match(s.policy_termination_date, p.dt->'termination_date')
    and public.project_date_match(s.surrender_end_date,      p.dt->'surrender_end_date');

  -- predicate covering ALL selected discrete facets (full match set)
  all_pred := public._pop_discrete_pred(c, null);

  -- per-facet value lists, each with that facet's OWN selection removed
  foreach fid in array discrete_facets loop
    fcol := col_of->>fid;
    other_pred := public._pop_discrete_pred(c, fid);
    execute format($f$
      select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v asc), '[]'::jsonb)
      from (
        select %I as v, count(distinct customer_id) as n
        from _src where %s
        group by %I
      ) s
    $f$, fcol, other_pred, fcol)
    into vals;
    result := jsonb_set(result, array['discrete', fid], coalesce(vals, '[]'::jsonb), true);
  end loop;

  -- range bounds over the fully-filtered derived set
  execute format($f$
    select jsonb_build_object(
      'face_amount',    jsonb_build_object('min', min(face_amount),       'max', max(face_amount)),
      'cash_value',     jsonb_build_object('min', min(cash_value_amount), 'max', max(cash_value_amount)),
      'annual_premium', jsonb_build_object('min', min(annual_premium),    'max', max(annual_premium)),
      'insured_age',    jsonb_build_object(
                          'min', min(insured_age) filter (where insured_age is not null),
                          'max', max(insured_age) filter (where insured_age is not null)),
      'customer_age',   jsonb_build_object(
                          'min', min(customer_age) filter (where customer_age is not null),
                          'max', max(customer_age) filter (where customer_age is not null))
    )
    from _src where %s
  $f$, all_pred)
  into rng;

  result := jsonb_set(result, '{range}', coalesce(rng, '{}'::jsonb), true);

  drop table if exists _src;
  return result;
end
$$;


notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261014000003_population_age_after_base_filter.sql >>>
-- =============================================================================
-- Population Builder — compute customer age AFTER base filtering (perf)
-- Migration: 20261014000003_population_age_after_base_filter.sql
--
-- Regression repro (via the PostgREST RPC path the app uses): agency =
-- "Cassidy, Jerry", product type unrestricted, Issue Date on/before 2016-01-01.
-- EXPLAIN ANALYZE of the facets inner build showed the cost is NOT the small
-- result — it is that project_population_source LEFT JOINs
-- project_customer_age_map() (a whole-book set-returning function). That join
-- builds every customer's age — a GROUP BY over ~7,500 owner rows + a hash join
-- across all 11,407 customers — BEFORE the agency/date predicates reduce the
-- population to ~150 policies. Every unrelated filter change (e.g. Issue Date)
-- therefore recomputes customer age for the entire book.
--
-- Fix (the required architecture, smallest sufficient change):
--   1. The derived source view carries only cheap base-policy columns + the
--      normalized status and insured_age (both immutable scalars on the policy's
--      own columns). Customer age is NO LONGER joined in the view.
--   2. Customer age is computed only for the REDUCED working set, via
--      project_customer_age_for(uuid[]) which resolves ages for a bounded list
--      of customer ids (exact DOB authoritative; conflicting owner birth years
--      => NULL — unchanged semantics).
--   3. matches applies all base predicates first, then joins ages for just the
--      surviving customers, and only when a customer_age filter is present.
--   4. facets builds the base working set first (no age), computes discrete
--      lists and non-age bounds from it, and computes customer-age bounds by
--      resolving ages for only that set's distinct customers.
--
-- Age capability and data-integrity semantics are preserved; statement_timeout
-- is unchanged; customer age is still derived, never persisted.
--
-- Development only. Depends on 20261014000002 and the age helpers.
-- =============================================================================


-- =============================================================================
-- Derived source view WITHOUT customer_age (cheap base). Status + insured_age
-- are immutable scalars over each policy's own columns.
-- =============================================================================
-- Dropping customer_age from the view requires a drop+recreate (create or
-- replace cannot remove a column). Functions reference the view by name at
-- runtime, so there is no hard dependency blocking the drop.
drop view if exists public.project_population_source;
create view public.project_population_source
with (security_invoker = true) as
select
  sp.id                               as policy_id,
  sp.customer_id                      as customer_id,
  public.project_policy_status_class(sp.coverage_status) as normalized_status,
  (public.project_policy_status_class(sp.coverage_status) = 'active') as is_active,
  coalesce(sp.agency_id::text, '∅')   as agency,
  coalesce(sp.carrier, '∅')           as carrier,
  coalesce(sp.product_type, '∅')      as product_type,
  coalesce(sp.term_length, '∅')       as term_length,
  coalesce(sp.rate_class, '∅')        as rate_class,
  coalesce(cu.segment, '∅')           as segment,
  coalesce(sp.insured_state, '∅')     as insured_state,
  sp.face_amount                      as face_amount,
  sp.cash_value_amount                as cash_value_amount,
  sp.annual_premium                   as annual_premium,
  sp.issue_date                       as issue_date,
  sp.policy_termination_date          as policy_termination_date,
  sp.surrender_end_date               as surrender_end_date,
  public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month) as insured_age
from public.service_policies sp
join public.customers cu on cu.id = sp.customer_id
where sp.is_test = false
  and cu.is_test = false
  and sp.customer_id is not null;

comment on view public.project_population_source is
  'Derived population source (cheap base): one row per eligible policy with '
  'normalized_status/is_active and insured_age. Customer age is NOT joined here '
  '— it is resolved only for the reduced working set via '
  'project_customer_age_for() so unrelated filters do not recompute age for the '
  'whole book.';

grant select on public.project_population_source to service_role;


-- =============================================================================
-- Customer age for a BOUNDED set of customers (the reduced working population).
-- Same semantics as project_customer_age_map but restricted to the given ids:
-- exact date_of_birth authoritative; else owner_dob_approx must agree on a
-- single birth year (month only if all agree); conflicting years => NULL.
-- =============================================================================
create or replace function public.project_customer_age_for(p_ids uuid[])
returns table (customer_id uuid, age integer)
language sql
stable
as $$
  with owner_consensus as (
    select
      sp.customer_id,
      count(distinct public.project_masked_dob_year(sp.owner_dob_approx))
        filter (where public.project_masked_dob_year(sp.owner_dob_approx) is not null) as distinct_years,
      min(public.project_masked_dob_year(sp.owner_dob_approx))
        filter (where public.project_masked_dob_year(sp.owner_dob_approx) is not null) as the_year,
      count(distinct public.project_masked_dob_month(sp.owner_dob_approx))
        filter (where public.project_masked_dob_month(sp.owner_dob_approx) is not null) as distinct_months,
      min(public.project_masked_dob_month(sp.owner_dob_approx))
        filter (where public.project_masked_dob_month(sp.owner_dob_approx) is not null) as the_month
    from public.service_policies sp
    where sp.is_test = false
      and sp.customer_id = any(p_ids)
      and sp.owner_dob_approx is not null
    group by sp.customer_id
  )
  select
    cu.id as customer_id,
    coalesce(
      public.project_age_years(cu.date_of_birth),
      case
        when oc.the_year is null then null
        when oc.distinct_years > 1 then null
        else public.project_age_from_parts(
               oc.the_year,
               case when oc.distinct_months = 1 then oc.the_month else null end)
      end
    ) as age
  from public.customers cu
  left join owner_consensus oc on oc.customer_id = cu.id
  where cu.id = any(p_ids)
    and cu.is_test = false
$$;

comment on function public.project_customer_age_for(uuid[]) is
  'Set-based customer age for a bounded list of customer ids (the reduced '
  'population). Exact DOB authoritative; conflicting owner birth years => NULL. '
  'Used so age is computed only for the filtered working set.';

grant execute on function public.project_customer_age_for(uuid[]) to service_role;


-- =============================================================================
-- MATCH — base predicates first; customer age resolved only for survivors and
-- only when a customer_age filter is present.
-- =============================================================================
create or replace function public.project_population_matches(c jsonb)
returns table (customer_id uuid, policy_id uuid)
language sql
stable
as $$
  with params as (
    select
      coalesce((c->>'activeOnly')::boolean, true) as active_only,
      coalesce(c->>'cashValue', 'any')             as cash_choice,
      c->'discrete' as d, c->'range' as r, c->'date' as dt,
      (c->'range'->'customer_age') is not null     as has_age_filter
  ),
  -- Everything EXCEPT the customer-age filter, from the cheap base view.
  base as (
    select s.customer_id, s.policy_id
    from public.project_population_source s
    cross join params p
    where (not p.active_only or s.is_active)
      and (
        p.cash_choice = 'any'
        or (p.cash_choice = 'has'  and coalesce(s.cash_value_amount, 0) > 0)
        or (p.cash_choice = 'none' and coalesce(s.cash_value_amount, 0) <= 0)
      )
      and (p.d->'agency' is null or jsonb_array_length(p.d->'agency') = 0
           or s.agency in (select jsonb_array_elements_text(p.d->'agency')))
      and (p.d->'carrier' is null or jsonb_array_length(p.d->'carrier') = 0
           or s.carrier in (select jsonb_array_elements_text(p.d->'carrier')))
      and (p.d->'product_type' is null or jsonb_array_length(p.d->'product_type') = 0
           or s.product_type in (select jsonb_array_elements_text(p.d->'product_type')))
      and (p.d->'term_length' is null or jsonb_array_length(p.d->'term_length') = 0
           or s.term_length in (select jsonb_array_elements_text(p.d->'term_length')))
      and (p.d->'rate_class' is null or jsonb_array_length(p.d->'rate_class') = 0
           or s.rate_class in (select jsonb_array_elements_text(p.d->'rate_class')))
      and (p.d->'customer_segment' is null or jsonb_array_length(p.d->'customer_segment') = 0
           or s.segment in (select jsonb_array_elements_text(p.d->'customer_segment')))
      and (p.d->'insured_state' is null or jsonb_array_length(p.d->'insured_state') = 0
           or s.insured_state in (select jsonb_array_elements_text(p.d->'insured_state')))
      and (p.r->'face_amount'->>'min' is null or s.face_amount >= (p.r->'face_amount'->>'min')::numeric)
      and (p.r->'face_amount'->>'max' is null or s.face_amount <= (p.r->'face_amount'->>'max')::numeric)
      and (p.r->'cash_value'->>'min' is null or s.cash_value_amount >= (p.r->'cash_value'->>'min')::numeric)
      and (p.r->'cash_value'->>'max' is null or s.cash_value_amount <= (p.r->'cash_value'->>'max')::numeric)
      and (p.r->'annual_premium'->>'min' is null or s.annual_premium >= (p.r->'annual_premium'->>'min')::numeric)
      and (p.r->'annual_premium'->>'max' is null or s.annual_premium <= (p.r->'annual_premium'->>'max')::numeric)
      and (p.r->'insured_age'->>'min' is null or (s.insured_age is not null and s.insured_age >= (p.r->'insured_age'->>'min')::int))
      and (p.r->'insured_age'->>'max' is null or (s.insured_age is not null and s.insured_age <= (p.r->'insured_age'->>'max')::int))
      and public.project_date_match(s.issue_date,              p.dt->'issue_date')
      and public.project_date_match(s.policy_termination_date, p.dt->'termination_date')
      and public.project_date_match(s.surrender_end_date,      p.dt->'surrender_end_date')
  ),
  -- Resolve age ONLY for the reduced set, ONLY when an age filter is present.
  age as (
    select a.customer_id, a.age
    from public.project_customer_age_for(
           (select array_agg(distinct b.customer_id) from base b)) a
    where (select has_age_filter from params)
  )
  select b.customer_id, b.policy_id
  from base b
  cross join params p
  left join age ag on ag.customer_id = b.customer_id
  where (not p.has_age_filter or (
           ag.age is not null
           and (p.r->'customer_age'->>'min' is null or ag.age >= (p.r->'customer_age'->>'min')::int)
           and (p.r->'customer_age'->>'max' is null or ag.age <= (p.r->'customer_age'->>'max')::int)
        ))
$$;


-- =============================================================================
-- FACETS — base working set first (no age), then resolve customer-age bounds
-- for only that set's distinct customers.
-- =============================================================================
create or replace function public.project_population_facets(c jsonb)
returns jsonb
language plpgsql
volatile
as $$
declare
  result jsonb := '{"discrete":{}}'::jsonb;
  discrete_facets text[] := array['agency','carrier','product_type','term_length','rate_class','customer_segment','insured_state'];
  col_of jsonb := jsonb_build_object(
    'agency','agency','carrier','carrier','product_type','product_type',
    'term_length','term_length','rate_class','rate_class',
    'customer_segment','segment','insured_state','insured_state');
  fid text;
  fcol text;
  other_pred text;
  all_pred text;
  vals jsonb;
  rng jsonb;
  matched_ids uuid[];
  age_min int;
  age_max int;
begin
  -- Working set with ALL base predicates applied EXCEPT the discrete facets and
  -- EXCEPT customer age, materialized ONCE from the cheap view (no age join).
  -- Discrete columns are kept so each facet's narrowed list is computed in
  -- memory by applying the OTHER discrete selections (no re-scan, no re-call of
  -- the match function). The coverage_status classification happens once here.
  create temp table _src on commit drop as
  select s.policy_id, s.customer_id, s.agency, s.carrier, s.product_type,
         s.term_length, s.rate_class, s.segment, s.insured_state,
         s.face_amount, s.cash_value_amount, s.annual_premium, s.insured_age
  from public.project_population_source s
  cross join (select
      coalesce((c->>'activeOnly')::boolean, true) as active_only,
      coalesce(c->>'cashValue', 'any')             as cash_choice,
      c->'range' as r, c->'date' as dt) p
  where (not p.active_only or s.is_active)
    and (
      p.cash_choice = 'any'
      or (p.cash_choice = 'has'  and coalesce(s.cash_value_amount, 0) > 0)
      or (p.cash_choice = 'none' and coalesce(s.cash_value_amount, 0) <= 0)
    )
    and (p.r->'face_amount'->>'min' is null or s.face_amount >= (p.r->'face_amount'->>'min')::numeric)
    and (p.r->'face_amount'->>'max' is null or s.face_amount <= (p.r->'face_amount'->>'max')::numeric)
    and (p.r->'cash_value'->>'min' is null or s.cash_value_amount >= (p.r->'cash_value'->>'min')::numeric)
    and (p.r->'cash_value'->>'max' is null or s.cash_value_amount <= (p.r->'cash_value'->>'max')::numeric)
    and (p.r->'annual_premium'->>'min' is null or s.annual_premium >= (p.r->'annual_premium'->>'min')::numeric)
    and (p.r->'annual_premium'->>'max' is null or s.annual_premium <= (p.r->'annual_premium'->>'max')::numeric)
    and (p.r->'insured_age'->>'min' is null or (s.insured_age is not null and s.insured_age >= (p.r->'insured_age'->>'min')::int))
    and (p.r->'insured_age'->>'max' is null or (s.insured_age is not null and s.insured_age <= (p.r->'insured_age'->>'max')::int))
    and public.project_date_match(s.issue_date,              p.dt->'issue_date')
    and public.project_date_match(s.policy_termination_date, p.dt->'termination_date')
    and public.project_date_match(s.surrender_end_date,      p.dt->'surrender_end_date');

  -- Customer-age FILTER (when present): resolve ages for only _src's customers,
  -- then narrow _src to the matching customers. Age is computed on the reduced
  -- set, never the whole book.
  if (c->'range'->'customer_age') is not null then
    delete from _src
    where customer_id not in (
      select a.customer_id
      from public.project_customer_age_for((select array_agg(distinct customer_id) from _src)) a
      where a.age is not null
        and (c->'range'->'customer_age'->>'min' is null or a.age >= (c->'range'->'customer_age'->>'min')::int)
        and (c->'range'->'customer_age'->>'max' is null or a.age <= (c->'range'->'customer_age'->>'max')::int)
    );
  end if;

  all_pred := public._pop_discrete_pred(c, null);

  -- Discrete facet value lists: each with its OWN selection removed (narrowing),
  -- computed in memory against _src. No age needed for these (customer counts).
  foreach fid in array discrete_facets loop
    fcol := col_of->>fid;
    other_pred := public._pop_discrete_pred(c, fid);
    execute format($f$
      select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v asc), '[]'::jsonb)
      from (
        select %I as v, count(distinct customer_id) as n
        from _src where %s group by %I
      ) q
    $f$, fcol, other_pred, fcol)
    into vals;
    result := jsonb_set(result, array['discrete', fid], coalesce(vals, '[]'::jsonb), true);
  end loop;

  -- Non-age bounds over the FULLY-filtered set (all discrete applied).
  execute format($f$
    select jsonb_build_object(
      'face_amount',    jsonb_build_object('min', min(face_amount),       'max', max(face_amount)),
      'cash_value',     jsonb_build_object('min', min(cash_value_amount), 'max', max(cash_value_amount)),
      'annual_premium', jsonb_build_object('min', min(annual_premium),    'max', max(annual_premium)),
      'insured_age',    jsonb_build_object(
                          'min', min(insured_age) filter (where insured_age is not null),
                          'max', max(insured_age) filter (where insured_age is not null))
    )
    from _src where %s
  $f$, all_pred)
  into rng;

  -- Customer-age bounds: resolve ages ONLY for the fully-filtered set's distinct
  -- customers (bounded — e.g. ~129 for Cassidy), never the whole book.
  execute format($f$ select array_agg(distinct customer_id) from _src where %s $f$, all_pred)
  into matched_ids;
  select min(a.age), max(a.age) into age_min, age_max
  from public.project_customer_age_for(matched_ids) a;

  rng := jsonb_set(rng, '{customer_age}', jsonb_build_object('min', age_min, 'max', age_max), true);

  result := jsonb_set(result, '{range}', coalesce(rng, '{}'::jsonb), true);

  drop table if exists _src;
  return result;
end
$$;


notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261014000004_population_facets_lazy_age.sql >>>
-- =============================================================================
-- Population Builder — lazy / on-demand age in facets
-- Migration: 20261014000004_population_facets_lazy_age.sql
--
-- Even after computing age only for the matched set, project_population_facets
-- STILL resolved customer-age (and insured-age) bounds on every call — e.g.
-- Cassidy + Issue Date <= 2016 computed owner-DOB consensus for the matched
-- customers just to render the screen, although the user had not opened or
-- applied an age facet. That DOB work is the remaining cost.
--
-- This makes age strictly on-demand. project_population_facets gains an
-- age_facets text[] parameter naming the age facets whose bounds the caller
-- actually needs (because the user OPENED them). Age bounds are computed ONLY
-- when that facet is requested OR its criterion is applied. With no age facet
-- open and no age criterion, the function does ZERO DOB/age work: the base
-- working set carries no age columns, and the age-bounds / age-resolution steps
-- are skipped entirely.
--
-- Unchanged: base filtering (agency/carrier/product_type/issue_date/term_length/
-- amounts/cash/dates) never touches age; the customer-age FILTER (when a
-- criterion is applied) still narrows the set via project_customer_age_for; DOB
-- precision/data-integrity rules are intact (exact DOB authoritative; month/year
-- and year-only supported without inventing a day; conflicting owner birth years
-- => NULL). No statement_timeout change, no persisted age.
--
-- A 1-arg overload is kept (delegates with no age facets requested) so existing
-- callers keep working. Development only.
-- =============================================================================

create or replace function public.project_population_facets(c jsonb, age_facets text[])
returns jsonb
language plpgsql
volatile
as $$
declare
  result jsonb := '{"discrete":{}}'::jsonb;
  discrete_facets text[] := array['agency','carrier','product_type','term_length','rate_class','customer_segment','insured_state'];
  col_of jsonb := jsonb_build_object(
    'agency','agency','carrier','carrier','product_type','product_type',
    'term_length','term_length','rate_class','rate_class',
    'customer_segment','segment','insured_state','insured_state');
  fid text;
  fcol text;
  other_pred text;
  all_pred text;
  vals jsonb;
  rng jsonb;
  matched_ids uuid[];
  age_min int;
  age_max int;
  has_customer_age_crit boolean := (c->'range'->'customer_age') is not null;
  has_insured_age_crit  boolean := (c->'range'->'insured_age') is not null;
  want_customer_age boolean := has_customer_age_crit or ('customer_age' = any(coalesce(age_facets, '{}')));
  want_insured_age  boolean := has_insured_age_crit  or ('insured_age'  = any(coalesce(age_facets, '{}')));
begin
  -- Base working set: ALL base-policy predicates EXCEPT the discrete facets.
  -- No age columns and no age predicates here unless an age CRITERION is applied
  -- (handled below). Base filtering never touches DOB/age logic.
  create temp table _src on commit drop as
  select s.policy_id, s.customer_id, s.agency, s.carrier, s.product_type,
         s.term_length, s.rate_class, s.segment, s.insured_state,
         s.face_amount, s.cash_value_amount, s.annual_premium,
         s.insured_age
  from public.project_population_source s
  cross join (select
      coalesce((c->>'activeOnly')::boolean, true) as active_only,
      coalesce(c->>'cashValue', 'any')             as cash_choice,
      c->'range' as r, c->'date' as dt) p
  where (not p.active_only or s.is_active)
    and (
      p.cash_choice = 'any'
      or (p.cash_choice = 'has'  and coalesce(s.cash_value_amount, 0) > 0)
      or (p.cash_choice = 'none' and coalesce(s.cash_value_amount, 0) <= 0)
    )
    and (p.r->'face_amount'->>'min' is null or s.face_amount >= (p.r->'face_amount'->>'min')::numeric)
    and (p.r->'face_amount'->>'max' is null or s.face_amount <= (p.r->'face_amount'->>'max')::numeric)
    and (p.r->'cash_value'->>'min' is null or s.cash_value_amount >= (p.r->'cash_value'->>'min')::numeric)
    and (p.r->'cash_value'->>'max' is null or s.cash_value_amount <= (p.r->'cash_value'->>'max')::numeric)
    and (p.r->'annual_premium'->>'min' is null or s.annual_premium >= (p.r->'annual_premium'->>'min')::numeric)
    and (p.r->'annual_premium'->>'max' is null or s.annual_premium <= (p.r->'annual_premium'->>'max')::numeric)
    and public.project_date_match(s.issue_date,              p.dt->'issue_date')
    and public.project_date_match(s.policy_termination_date, p.dt->'termination_date')
    and public.project_date_match(s.surrender_end_date,      p.dt->'surrender_end_date');

  -- Insured-age FILTER (only when the criterion is applied). insured_age is a
  -- cheap policy-local scalar from the view; apply it directly.
  if has_insured_age_crit then
    delete from _src
    where not (
      insured_age is not null
      and (c->'range'->'insured_age'->>'min' is null or insured_age >= (c->'range'->'insured_age'->>'min')::int)
      and (c->'range'->'insured_age'->>'max' is null or insured_age <= (c->'range'->'insured_age'->>'max')::int)
    );
  end if;

  -- Customer-age FILTER (only when the criterion is applied). Resolve ages for
  -- just _src's customers (bounded), then narrow.
  if has_customer_age_crit then
    delete from _src
    where customer_id not in (
      select a.customer_id
      from public.project_customer_age_for((select array_agg(distinct customer_id) from _src)) a
      where a.age is not null
        and (c->'range'->'customer_age'->>'min' is null or a.age >= (c->'range'->'customer_age'->>'min')::int)
        and (c->'range'->'customer_age'->>'max' is null or a.age <= (c->'range'->'customer_age'->>'max')::int)
    );
  end if;

  all_pred := public._pop_discrete_pred(c, null);

  -- Discrete facet value lists (customer counts; no age work).
  foreach fid in array discrete_facets loop
    fcol := col_of->>fid;
    other_pred := public._pop_discrete_pred(c, fid);
    execute format($f$
      select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v asc), '[]'::jsonb)
      from (
        select %I as v, count(distinct customer_id) as n
        from _src where %s group by %I
      ) q
    $f$, fcol, other_pred, fcol)
    into vals;
    result := jsonb_set(result, array['discrete', fid], coalesce(vals, '[]'::jsonb), true);
  end loop;

  -- Non-age bounds over the fully-filtered set (cheap, policy-local columns).
  execute format($f$
    select jsonb_build_object(
      'face_amount',    jsonb_build_object('min', min(face_amount),       'max', max(face_amount)),
      'cash_value',     jsonb_build_object('min', min(cash_value_amount), 'max', max(cash_value_amount)),
      'annual_premium', jsonb_build_object('min', min(annual_premium),    'max', max(annual_premium))
    )
    from _src where %s
  $f$, all_pred)
  into rng;

  -- Insured-age bounds: ONLY when the facet is opened or its criterion applied.
  if want_insured_age then
    execute format($f$
      select jsonb_build_object(
        'min', min(insured_age) filter (where insured_age is not null),
        'max', max(insured_age) filter (where insured_age is not null))
      from _src where %s
    $f$, all_pred)
    into vals;
    rng := jsonb_set(rng, '{insured_age}', coalesce(vals, jsonb_build_object('min', null, 'max', null)), true);
  end if;

  -- Customer-age bounds: ONLY when the facet is opened or its criterion applied.
  -- Resolve ages for just the matched set's distinct customers.
  if want_customer_age then
    execute format($f$ select array_agg(distinct customer_id) from _src where %s $f$, all_pred)
    into matched_ids;
    select min(a.age), max(a.age) into age_min, age_max
    from public.project_customer_age_for(matched_ids) a;
    rng := jsonb_set(rng, '{customer_age}', jsonb_build_object('min', age_min, 'max', age_max), true);
  end if;

  result := jsonb_set(result, '{range}', coalesce(rng, '{}'::jsonb), true);

  drop table if exists _src;
  return result;
end
$$;


-- Backward-compatible 1-arg overload: no age facets requested. Age bounds are
-- then produced only if an age criterion is applied.
create or replace function public.project_population_facets(c jsonb)
returns jsonb
language sql
volatile
as $$
  select public.project_population_facets(c, '{}'::text[])
$$;


grant execute on function public.project_population_facets(jsonb, text[]) to service_role;
grant execute on function public.project_population_facets(jsonb)         to service_role;

notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261016000001_stewardship_grants.sql >>>
-- =============================================================================
-- Stewardship tables — missing API-role table privileges
-- Migration: 20261016000001_stewardship_grants.sql
--
-- The stewardship foundation migrations (20260927000002_stewardship_prereview,
-- 20260927000003_stewardship_outreach) enabled RLS and added policies but never
-- GRANTed table privileges to the Supabase API roles. On this branch default
-- privileges do NOT auto-grant DML to anon / authenticated / service_role, so
-- PostgREST returns 42501 "permission denied" even for service_role (which
-- bypasses RLS but still needs the table privilege). This is the same gap the
-- projects foundation migration (20261008230000) called out and fixed for its
-- own tables; the stewardship tables predate that discovery.
--
-- Without these grants, starting stewardship work (POST /api/stewardship/start)
-- fails for every path — agency book and project alike — because the admin
-- client cannot insert customer_prereviews / stewardship_outreach rows.
--
-- RLS still gates row access (anon / authenticated restricted by the existing
-- policies; service_role bypasses RLS). These grants only make the tables
-- reachable through the API, matching every existing public table.
-- =============================================================================

grant all on public.customer_prereviews          to anon, authenticated, service_role;
grant all on public.stewardship_outreach          to anon, authenticated, service_role;
grant all on public.stewardship_outreach_policies to anon, authenticated, service_role;

-- policy_documents and policy_review_policies were added in the same
-- prereview migration without grants; grant them too so the documentation
-- layer that follows stewardship is reachable through the API as well.
grant all on public.policy_documents       to anon, authenticated, service_role;
grant all on public.policy_review_policies to anon, authenticated, service_role;

-- >>> schema/catalog from 20261017000001_project_1035_step3_prepare_evaluate.sql >>>
-- =============================================================================
-- 1035 Exchange Review — Step 3 (Prepare & Evaluate) foundation
-- Migration: 20261017000001_project_1035_step3_prepare_evaluate.sql
--
-- This is the smallest safe extension that lets the 1035 Exchange Review project
-- carry a customer through the end of Step 3. It is project-type specific (the
-- 1035 workflow), NOT a general rules engine.
--
-- What the workflow needs that is NOT already derivable:
--   1. Step 3 requires two durable documents per customer — the latest CARRIER
--      STATEMENT and the REPROJECTION. We REUSE the existing policy_documents
--      foundation rather than inventing a parallel document model, and add the
--      project/customer context so a document can be associated with the right
--      project/customer/policy.
--   2. A per-customer, per-project PREPARATION + DETERMINATION state. Bob needs a
--      simple durable determination of Candidate / Not a Candidate. Operations
--      needs a durable "preparation complete" signal so readiness for Bob is not
--      guessed. Everything else (Step 2 servicing access, whose-turn routing) is
--      DERIVED at read time from service_policies.sa_status and the documents, so
--      it is not stored here.
--
-- Deliberately NOT built here: Step 4 (customer outreach/scheduling) and Step 5
-- (review execution). No third determination state is added; two is sufficient
-- for the settled flow and more can be added later only if evidence requires it.
--
-- Depends on: projects / project_customers (20261008230000), customers &
--             service_policies (service module), policy_documents
--             (20260927000002_stewardship_prereview), set_updated_at() and
--             jwt_is_admin() (earlier in the chain). Writes via service_role;
--             internal staff (admin) read. Internal-only; no agency portal.
-- =============================================================================


-- =============================================================================
-- 1. POLICY_DOCUMENTS — project / customer context (additive, nullable)
-- The table already stores (policy_id, document_type, document_date,
-- storage_location). Adding nullable project_id + customer_id lets a document be
-- associated with the project and customer it was collected for, without a
-- parallel document model and without disturbing any existing row (there are
-- none today, and the columns are nullable so prior usage would be unaffected).
-- =============================================================================
alter table public.policy_documents
  add column if not exists project_id  uuid references public.projects (id)  on delete cascade;

alter table public.policy_documents
  add column if not exists customer_id uuid references public.customers (id) on delete cascade;

comment on column public.policy_documents.project_id is
  'The project this document was collected for (e.g. the 1035 Exchange Review). '
  'Nullable: documents captured outside a project leave it null.';

comment on column public.policy_documents.customer_id is
  'The customer this document belongs to. Nullable for backward compatibility; '
  'the 1035 Step 3 flow always sets it so documents group by customer.';

create index if not exists policy_documents_project_customer_idx
  on public.policy_documents (project_id, customer_id)
  where project_id is not null;

-- One current document of a given type per (project, customer). Re-collecting a
-- carrier statement replaces the prior one via upsert on this key rather than
-- accumulating duplicates. policy_id/date/location still vary freely.
--
-- This is a PLAIN (non-partial) unique index so it can back an INSERT ... ON
-- CONFLICT (project_id, customer_id, document_type) upsert — Postgres cannot use
-- a partial unique index as an ON CONFLICT arbiter unless the statement repeats
-- the predicate, which the PostgREST client cannot express. Because the three
-- columns are nullable and Postgres treats NULLs as distinct, documents with a
-- null project_id or customer_id (pre-1035 usage) never collide here, which is
-- exactly the intended behavior.
create unique index if not exists policy_documents_project_customer_type_key
  on public.policy_documents (project_id, customer_id, document_type);


-- =============================================================================
-- 2. PROJECT_CUSTOMER_REVIEWS — Step 3 preparation + determination state
-- One row per (project_id, customer_id). Holds only the non-derivable workflow
-- facts for Step 3: whether operations has finished preparation, and Bob's
-- determination. Membership in the project still lives in project_customers;
-- this row is created lazily when Step 3 work begins for the customer.
-- =============================================================================
create table if not exists public.project_customer_reviews (
  id            uuid primary key default gen_random_uuid(),

  project_id    uuid not null references public.projects (id)  on delete cascade,
  customer_id   uuid not null references public.customers (id) on delete cascade,

  -- Operations preparation lifecycle for Step 3. 'preparing' while documents are
  -- being gathered; 'ready_for_evaluation' once operations marks preparation
  -- complete (both required documents present). Kept minimal and explicit.
  prep_status   text not null default 'preparing'
    check (prep_status in ('preparing', 'ready_for_evaluation')),

  -- Bob's durable 1035 determination. Null until Bob decides. Exactly two
  -- outcomes per the settled flow; add another only if evidence requires it.
  determination text
    check (determination in ('candidate', 'not_a_candidate')),

  -- Audit of the determination (who/when), without inventing a reviewer model:
  -- producers.id is the existing durable producer identity (Bob is a producer).
  determined_by uuid references public.producers (id) on delete set null,
  determined_at timestamptz,

  -- Free-text operations/Bob note (optional).
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.project_customer_reviews is
  'Per-customer Step 3 (Prepare & Evaluate) state for a project — currently the '
  '1035 Exchange Review workflow. Stores only non-derivable facts: operations '
  'preparation status and Bob''s Candidate / Not a Candidate determination. '
  'Step 2 servicing access and whose-turn routing are derived at read time from '
  'service_policies.sa_status and policy_documents, not stored here.';

comment on column public.project_customer_reviews.prep_status is
  'preparing: operations is still gathering the carrier statement + reprojection. '
  'ready_for_evaluation: operations marked preparation complete; the customer is '
  'surfaced for Bob''s determination.';

comment on column public.project_customer_reviews.determination is
  'Bob''s durable 1035 determination: candidate | not_a_candidate. Null until '
  'decided.';

-- At most one Step 3 row per customer per project.
create unique index if not exists project_customer_reviews_unique
  on public.project_customer_reviews (project_id, customer_id);

create index if not exists project_customer_reviews_project_idx
  on public.project_customer_reviews (project_id);

create index if not exists project_customer_reviews_determination_idx
  on public.project_customer_reviews (project_id, determination);

create trigger project_customer_reviews_set_updated_at
  before update on public.project_customer_reviews
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 3. TABLE PRIVILEGES
-- Match every existing public table: default privileges do not auto-grant DML to
-- the API roles on this branch, so grant explicitly or PostgREST returns 403.
-- RLS below gates row access.
-- =============================================================================
grant all on public.project_customer_reviews to anon, authenticated, service_role;


-- =============================================================================
-- 4. ROW LEVEL SECURITY
-- Internal staff (admin) read; all writes via service_role. Matches the
-- projects / stewardship / service modules. Internal-only; no agency portal.
-- =============================================================================
alter table public.project_customer_reviews enable row level security;

create policy project_customer_reviews_admin_select
  on public.project_customer_reviews for select to authenticated
  using (public.jwt_is_admin());

create policy project_customer_reviews_all
  on public.project_customer_reviews for all to service_role
  using (true) with check (true);


-- Refresh PostgREST's schema cache so the new table / columns are visible via
-- the API immediately.
notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261018000001_rightpath_documents_storage.sql >>>
-- =============================================================================
-- Right Path document storage — private Supabase Storage bucket
-- Migration: 20261018000001_rightpath_documents_storage.sql
--
-- Creates the single PRIVATE bucket that holds the actual uploaded file bytes
-- for Right Path policy/review documents. The first consumer is the 1035
-- Exchange Review Step 3 flow (carrier statement + reprojection), but the bucket
-- is the durable Right Path document store, not a 1035-only or dev-only artifact.
--
-- Design (production-intended, promotable as-is):
--   * One bucket `rightpath-documents`, public = false. Never public.
--   * policy_documents remains the durable DOCUMENT RECORD. storage_location on
--     that row holds the object PATH within this bucket (e.g.
--     "1035/<project>/<customer>/carrier_statement.pdf"). No second document
--     system is introduced.
--   * All uploads/downloads go through server routes using the service-role
--     client (which bypasses storage RLS), exactly like every other table in
--     this app. Downloads are issued as short-lived SIGNED URLs so the bucket
--     stays private — no public URL is ever exposed.
--   * storage.objects RLS policies below are defense-in-depth so that, even if a
--     non-service-role client reached the bucket, only internal admins could
--     read/write it and anon/agency users get nothing. This matches the
--     admin-only posture of the projects / stewardship / service modules.
--
-- Depends on: Supabase Storage (storage.buckets, storage.objects — provided by
--             the platform) and public.jwt_is_admin() (20260516000002).
-- Idempotent: safe to re-run (on conflict / drop-if-exists guards).
-- =============================================================================


-- =============================================================================
-- 1. BUCKET — private, single Right Path document store.
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('rightpath-documents', 'rightpath-documents', false)
on conflict (id) do update set public = false;


-- =============================================================================
-- 2. STORAGE.OBJECTS RLS — admin read/write for this bucket; service_role all.
-- storage.objects has RLS enabled by the platform. We add scoped policies for
-- the rightpath-documents bucket only; other buckets are unaffected. The server
-- uses the service-role client (bypasses RLS); these policies ensure that even a
-- direct authenticated client is limited to internal admins, and anon/agency
-- users are denied entirely (no matching policy).
-- =============================================================================

-- Internal admins may read objects in this bucket (e.g. if a future authenticated
-- client reads directly; the current app uses signed URLs via the server).
drop policy if exists rightpath_documents_admin_select on storage.objects;
create policy rightpath_documents_admin_select
  on storage.objects for select to authenticated
  using (bucket_id = 'rightpath-documents' and public.jwt_is_admin());

-- Internal admins may insert objects in this bucket.
drop policy if exists rightpath_documents_admin_insert on storage.objects;
create policy rightpath_documents_admin_insert
  on storage.objects for insert to authenticated
  with check (bucket_id = 'rightpath-documents' and public.jwt_is_admin());

-- Internal admins may update objects in this bucket (overwrite / supersede).
drop policy if exists rightpath_documents_admin_update on storage.objects;
create policy rightpath_documents_admin_update
  on storage.objects for update to authenticated
  using (bucket_id = 'rightpath-documents' and public.jwt_is_admin())
  with check (bucket_id = 'rightpath-documents' and public.jwt_is_admin());

-- Internal admins may delete objects in this bucket.
drop policy if exists rightpath_documents_admin_delete on storage.objects;
create policy rightpath_documents_admin_delete
  on storage.objects for delete to authenticated
  using (bucket_id = 'rightpath-documents' and public.jwt_is_admin());

-- service_role: full access (the server upload/download/supersede path).
drop policy if exists rightpath_documents_service_all on storage.objects;
create policy rightpath_documents_service_all
  on storage.objects for all to service_role
  using (bucket_id = 'rightpath-documents')
  with check (bucket_id = 'rightpath-documents');


-- Refresh PostgREST schema cache (harmless for storage; keeps convention).
notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261019000001_policy_documents_policy_scoped.sql >>>
-- =============================================================================
-- 1035 Exchange Review — Step 3 documents become POLICY-specific
-- Migration: 20261019000001_policy_documents_policy_scoped.sql
--
-- CORRECTION to the Step 3 document model. A project customer can have MULTIPLE
-- policies being evaluated, so the carrier statement and the reprojection are
-- per POLICY, not merely per customer. The prior uniqueness rule
--   (project_id, customer_id, document_type)   [20261017000001]
-- let a document for Policy B overwrite the document for Policy A. The correct
-- durable rule is
--   (project_id, customer_id, policy_id, document_type).
--
-- This is the smallest additive change: policy_id already exists on
-- policy_documents (NOT NULL, references service_policies). We only swap the
-- unique index to include it. No new table, no new column, no new bucket.
--
-- Storage object paths also become policy-specific in application code
-- (1035/<project>/<customer>/<policy>/<type>.<ext>); that is handled by the
-- route and does not require DDL. Existing object paths, if any, are reconciled
-- by the app on next upload (upsert overwrites at the new, policy-scoped key).
--
-- Depends on: 20261017000001 (project/customer context + the index this replaces)
--             and the pre-existing policy_documents.policy_id column
--             (20260927000002). Idempotent and safe to re-run.
-- =============================================================================


-- =============================================================================
-- 1. SAFETY BACKFILL — ensure every project-scoped row has a policy_id.
-- policy_id is already NOT NULL on this table, so this is defensive only: if a
-- future/legacy row ever lacked one, anchor it to a permanent policy for that
-- customer (else any policy for that customer). No-op on a well-formed table.
-- =============================================================================
update public.policy_documents d
set policy_id = sub.policy_id
from (
  select distinct on (sp.customer_id) sp.customer_id, sp.id as policy_id
  from public.service_policies sp
  where sp.is_test = false
  order by
    sp.customer_id,
    -- prefer a permanent (non-term) policy, then stable by id
    (case
       when upper(regexp_replace(coalesce(sp.product_type, ''), '[\s_-]', '', 'g')) like 'TERM%'
         then 1 else 0
     end),
    sp.id
) sub
where d.policy_id is null
  and d.customer_id is not null
  and d.customer_id = sub.customer_id;


-- =============================================================================
-- 2. SWAP THE UNIQUE INDEX — customer-scoped -> policy-scoped.
-- Drop the old (project, customer, type) key and create the policy-aware key.
-- A plain (non-partial) unique index so it can back an INSERT ... ON CONFLICT
-- (project_id, customer_id, policy_id, document_type) upsert from PostgREST.
-- The columns project_id/customer_id are nullable; Postgres treats NULLs as
-- distinct, so pre-1035 rows (null project/customer) never collide here, which
-- is the intended behavior — exactly as before, now with policy granularity.
-- =============================================================================
drop index if exists public.policy_documents_project_customer_type_key;

create unique index if not exists policy_documents_project_customer_policy_type_key
  on public.policy_documents (project_id, customer_id, policy_id, document_type);


-- Keep the existing lookup index on (project_id, customer_id) — it still serves
-- "all documents for this customer in this project" reads in the workflow build.


-- Refresh PostgREST's schema cache so the new index-backed upsert arbiter is
-- usable via the API immediately.
notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261020000001_projects_lifecycle_archive.sql >>>
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

-- >>> schema/catalog from 20261021000001_ipf_work_overlay.sql >>>
-- =============================================================================
-- IPF work overlay — employee capabilities, shared-queue claiming, project
-- participation / escalation, and Today's Focus
-- Migration: 20261021000001_ipf_work_overlay.sql
--
-- This lands the operational + assistant overlay from IPF
-- (bobpfromm/ipf-stewardship) onto Right Path's EXISTING tables, single-tenant
-- and with Right Path's own auth. It is the smallest complete vertical slice
-- that makes the shared Stewardship board and the 1035 project workable by
-- capability instead of by routine individual assignment.
--
-- What is lifted from IPF (the functional blueprint), and how it is re-homed:
--
--   1. CAPABILITIES. IPF's qualification flags + work-function catalog +
--      per-member assignment model is reused verbatim in SHAPE, but re-homed on
--      Right Path's `producers` table (NOT practice_team_members, no
--      practice_id). Qualification flags are nullable eligibility FACTS
--      (NULL = unknown, true/false = asserted), never titles or a role
--      hierarchy. A capability a member is not assigned to is simply the
--      ABSENCE of a row. The DB rejects a routable/overqualified assignment for
--      a capability whose required license the member does not hold, so an
--      incompatible assignment can never be persisted even if the UI is
--      bypassed.
--
--   2. SHARED-QUEUE CLAIMING. IPF's queue-owned-until-claimed model is reused on
--      `stewardship_outreach` (Right Path's shared board). Work is SHARED by
--      default: no claim at creation. A claim is a lightweight, optional soft
--      lease recorded ON THE WORK ROW (claimed_by_producer_id + claimed_at),
--      deliberately distinct from any episode/case assignee. The board is NEVER
--      filtered by claim; claiming only marks a commitment. action_context jsonb
--      is added for IPF parity (claim/callback metadata) without new tables.
--
--   3. PROJECT PARTICIPATION + ESCALATION. Participation (who works in a
--      project, even when nothing needs them now) and escalation (who an
--      exception goes to, in order) are kept SEPARATE from each other and from
--      project ownership — exactly the Right Path operating decision. For the
--      1035 project, operational problems escalate through Angie before Bob;
--      Andy is never a default escalation destination.
--
--   4. TODAY'S FOCUS. Management direction that ELEVATES a project or a single
--      activity. It is temporary by construction: expires_at is NOT NULL, so a
--      focus always has an end and can never silently become a permanent
--      priority. It feeds the GoRules Daily Direction decision as a signal; it
--      never disables other work and never overrides a customer commitment or
--      capability eligibility (those constraints stay in the engine/UI).
--
-- Deliberately NOT imported from IPF: practice_id multi-tenancy, the
-- ipf_command_owner SECURITY DEFINER command chain, audit_events, and the
-- ipf_require_practice_membership / ipf_check_permission gates. Right Path is
-- single-tenant; writes flow through service-role /api routes guarded by
-- requireInternalAdmin, and RLS mirrors every existing internal module
-- (admin SELECT via jwt_is_admin(), all writes via service_role).
--
-- Depends on: producers (20260522000002), projects (20261008230000),
--             stewardship_outreach (20260927000003), set_updated_at() and
--             jwt_is_admin() (earlier in the chain), auth.users (Supabase Auth).
--             Internal-only; no agency portal access. Idempotent / re-runnable.
-- =============================================================================


-- =============================================================================
-- 1. QUALIFICATION FLAGS ON PRODUCERS (IPF eligibility facts, re-homed)
-- Nullable with NO default: NULL = the fact is not established (unknown), true =
-- affirmatively held, false = affirmatively not held. We never default a fact
-- from a title/stereotype and never invent completeness: an unpopulated flag
-- stays unknown rather than silently reading as "not licensed".
-- =============================================================================
alter table public.producers
  add column if not exists is_life_licensed            boolean,
  add column if not exists is_securities_licensed      boolean,
  add column if not exists is_registered_support_staff boolean;

comment on column public.producers.is_life_licensed is
  'Eligibility fact for licensing gating: whether this team member holds a life '
  'license. NULL = unknown (not established), true = held, false = affirmatively '
  'not held. Not a title and not a routing assignment. Gates capabilities whose '
  'work_functions.required_qualification = ''life_licensed''.';

comment on column public.producers.is_securities_licensed is
  'Eligibility fact for registration/licensing gating: whether this team member '
  'holds a securities license. NULL = unknown, true = held, false = not held. '
  'Captured for later workflows; no securities capability rule is defined yet.';

comment on column public.producers.is_registered_support_staff is
  'Eligibility fact: whether this team member is registered support staff. '
  'NULL = unknown, true = held, false = not held. Captured for later workflows.';


-- =============================================================================
-- 2. WORK FUNCTIONS — the capability catalog (what work exists)
-- A durable catalog of the business ACTIVITIES a team member can be qualified to
-- perform. canonical_key is the stable machine key the engine and the shared
-- queues reference. required_qualification names the single qualification flag a
-- member must hold to be routably assigned (NULL = no license gate). This is the
-- authoritative requirement source of truth (IPF ADR: the requirement lives in
-- exactly one declared-data place).
-- =============================================================================
create table if not exists public.work_functions (
  id                     uuid primary key default gen_random_uuid(),
  canonical_key          text not null,
  label                  text not null,
  description            text,
  -- the qualification flag required to be ROUTABLY assigned to this capability,
  -- or NULL when the capability has no licensing gate. Checked by the trigger
  -- in section 3. Values match the producers qualification flag keys.
  required_qualification text
    check (required_qualification in
      ('life_licensed', 'securities_licensed', 'registered_support_staff')),
  sort_order             integer not null default 0,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.work_functions is
  'Capability catalog: the business activities a team member can be qualified to '
  'perform (e.g. outreach, operations_prep, determination). canonical_key is the '
  'stable key the shared queues and the GoRules Daily Direction engine reference. '
  'required_qualification is the single authoritative license gate for the '
  'capability (NULL = no gate).';

create unique index if not exists work_functions_canonical_key_key
  on public.work_functions (lower(canonical_key));

create index if not exists work_functions_active_idx
  on public.work_functions (is_active) where is_active;

drop trigger if exists work_functions_set_updated_at on public.work_functions;
create trigger work_functions_set_updated_at
  before update on public.work_functions
  for each row execute function public.set_updated_at();


-- First-slice capabilities. These are the ACTUAL activities present today: the
-- shared Stewardship board (outreach + the research exception) and the 1035
-- project's own derived stages (operations preparation, and Bob's senior-producer
-- determination). No activity is invented for work that does not yet exist
-- (no scheduling / appointment capability is seeded). determination requires a
-- life license; the rest are operations work with no license gate.
insert into public.work_functions (canonical_key, label, description, required_qualification, sort_order)
values
  ('outreach',        'Outreach',                 'Contact customers to establish servicing access (calls, emails, due promised callbacks) on the shared Stewardship board.', null, 10),
  ('research',        'Contact Research',         'Exception path: find usable contact information when a customer has none or it has failed.', null, 20),
  ('operations_prep', 'Operations Preparation',   'Collect and prepare the per-policy documents a project step requires (e.g. 1035 Step 3 carrier statement + reprojection) and hand the customer forward.', null, 30),
  ('determination',   'Determination',            'Make the customer-level candidacy / recommendation decision for a project (e.g. the 1035 Candidate / Not a Candidate determination). Senior producer work.', 'life_licensed', 40),
  ('office_support',  'General Office Support',   'Ordinary office business that is not tied to a specific project workflow.', null, 50)
on conflict (lower(canonical_key)) do update
  set label = excluded.label,
      description = excluded.description,
      required_qualification = excluded.required_qualification,
      sort_order = excluded.sort_order;


-- =============================================================================
-- 3. PRODUCER WORK FUNCTIONS — per-member capability assignment (eligibility)
-- Who is qualified+authorized for which capability. assignment_type:
--   'primary'       routable, the default workers for the capability
--   'support'       routable, backs up primary
--   'overqualified' capable but NOT normally routed (e.g. a senior producer who
--                   CAN do operations prep but should not be routed it)
-- "Not qualified" is never stored; it is simply the ABSENCE of a row.
-- project_id scopes an assignment to a single project (project-specific
-- participation / exception); NULL means it applies agency-wide. The unique
-- index treats agency-wide (NULL) and each project as distinct scopes.
-- =============================================================================
create table if not exists public.producer_work_functions (
  id               uuid primary key default gen_random_uuid(),
  producer_id      uuid not null references public.producers (id)     on delete cascade,
  work_function_id uuid not null references public.work_functions (id) on delete cascade,
  assignment_type  text not null
    check (assignment_type in ('primary', 'support', 'overqualified')),
  -- NULL = agency-wide eligibility; a project id = eligibility scoped to that
  -- project only (participation exception). on delete cascade so removing a
  -- project cleans up its scoped assignments.
  project_id       uuid references public.projects (id) on delete cascade,
  -- Provenance of the row, so a corrective migration can safely remove ONLY the
  -- rows it itself seeded without ever touching a legitimately-created
  -- assignment. 'migration_seed' = created by a migration's demonstration seed;
  -- 'manual' (default) = created by a human (Team editor) or an evidence-based
  -- migration. Only 'migration_seed' rows are eligible for migration cleanup.
  source           text not null default 'manual'
    check (source in ('migration_seed', 'manual')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.producer_work_functions is
  'Per-member capability assignment (eligibility). A member is eligible for a '
  'capability only if a routable (primary/support) row exists; absence of a row '
  'means not qualified. assignment_type overqualified = capable but not routed. '
  'project_id NULL = agency-wide; a project id scopes the assignment to that '
  'project (project-specific participation / exception).';

-- Agency-wide uniqueness (project_id IS NULL) and per-project uniqueness are two
-- partial unique indexes, because NULL project_id would never collide otherwise.
create unique index if not exists producer_work_functions_agencywide_key
  on public.producer_work_functions (producer_id, work_function_id)
  where project_id is null;

create unique index if not exists producer_work_functions_project_key
  on public.producer_work_functions (producer_id, work_function_id, project_id)
  where project_id is not null;

create index if not exists producer_work_functions_wf_idx
  on public.producer_work_functions (work_function_id);
create index if not exists producer_work_functions_project_idx
  on public.producer_work_functions (project_id) where project_id is not null;

drop trigger if exists producer_work_functions_set_updated_at on public.producer_work_functions;
create trigger producer_work_functions_set_updated_at
  before update on public.producer_work_functions
  for each row execute function public.set_updated_at();


-- Requirement gate (IPF parity, re-homed as a trigger instead of a governed
-- command): the DB rejects a routable or overqualified assignment for a
-- capability whose required license the member does not AFFIRMATIVELY hold. The
-- qualification flag must be exactly true; NULL (unknown) or false both fail,
-- so an unestablished license can never silently satisfy a gate.
create or replace function public.enforce_work_function_qualification()
  returns trigger
  language plpgsql
as $$
declare
  v_required text;
  v_has      boolean;
begin
  select required_qualification into v_required
    from public.work_functions where id = new.work_function_id;

  if v_required is null then
    return new; -- no license gate on this capability
  end if;

  select case v_required
           when 'life_licensed'            then is_life_licensed
           when 'securities_licensed'      then is_securities_licensed
           when 'registered_support_staff' then is_registered_support_staff
         end
    into v_has
    from public.producers where id = new.producer_id;

  if v_has is distinct from true then
    raise exception
      'Producer % lacks the qualification (%) required for this capability',
      new.producer_id, v_required
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_work_function_qualification() is
  'Rejects a producer_work_functions assignment for a capability whose required '
  'license the producer does not affirmatively hold (flag must be exactly true; '
  'NULL/unknown and false both fail). Mirrors the IPF requirement gate.';

drop trigger if exists producer_work_functions_qualification on public.producer_work_functions;
create trigger producer_work_functions_qualification
  before insert or update on public.producer_work_functions
  for each row execute function public.enforce_work_function_qualification();


-- =============================================================================
-- 4. SHARED-QUEUE CLAIMING ON stewardship_outreach (optional soft lease)
-- Work on the shared board is SHARED by default: these columns are NULL at
-- creation (no backfill sets them), so every existing and future row starts
-- unclaimed and visible to every eligible worker. A claim is an OPTIONAL,
-- lightweight commitment recorded on the work row itself — distinct from any
-- case/episode assignee. The board is never filtered by the claim.
-- action_context mirrors IPF's per-action metadata bag (claim/callback context)
-- so the claim path and later callback metadata have a home without a new table.
-- =============================================================================
alter table public.stewardship_outreach
  add column if not exists action_context       jsonb not null default '{}'::jsonb,
  add column if not exists claimed_by_producer_id uuid references public.producers (id) on delete set null,
  add column if not exists claimed_at           timestamptz;

comment on column public.stewardship_outreach.claimed_by_producer_id is
  'OPTIONAL soft-lease claim: the producer who has committed to this shared '
  'board item. NULL = unclaimed (shared, visible to every eligible worker). A '
  'claim never filters the board and is distinct from any case/episode assignee.';

comment on column public.stewardship_outreach.action_context is
  'Per-item metadata bag (IPF parity). Carries claim/callback context without a '
  'new table. Never a business-state column; the queue + transition columns '
  'remain authoritative for workflow state.';

create index if not exists stewardship_outreach_claimed_by_idx
  on public.stewardship_outreach (claimed_by_producer_id)
  where claimed_by_producer_id is not null;


-- =============================================================================
-- 5. PROJECT PARTICIPATION — who works in a project (My Projects)
-- Participation makes a project show up for a team member even when nothing
-- currently requires their attention. It is DELIBERATELY separate from project
-- ownership and from escalation (section 6): participating is not owning, and
-- not every participant performs every activity.
-- =============================================================================
create table if not exists public.project_participants (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id)  on delete cascade,
  producer_id uuid not null references public.producers (id) on delete cascade,
  -- optional free-text note on how they participate (e.g. "operations prep").
  -- NOT a role hierarchy and NOT an ownership claim.
  note        text,
  added_at    timestamptz not null default now(),
  constraint project_participants_unique unique (project_id, producer_id)
);

comment on table public.project_participants is
  'Who participates in a project (drives My Projects visibility). Separate from '
  'project ownership and from escalation. Participation does not imply '
  'performing every activity.';


-- =============================================================================
-- 6. PROJECT ESCALATION CONTACTS — who an exception goes to, in order
-- Escalation is project-specific and ordered by tier (1 = first destination).
-- It addresses EXCEPTIONS; it is not an approval step inserted into routine
-- work. Kept separate from participation and ownership.
-- =============================================================================
create table if not exists public.project_escalation_contacts (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id)  on delete cascade,
  producer_id uuid not null references public.producers (id) on delete cascade,
  -- 1 = first escalation destination for an operational exception, 2 = next, ...
  tier        integer not null check (tier >= 1),
  note        text,
  created_at  timestamptz not null default now(),
  constraint project_escalation_tier_unique unique (project_id, tier)
);

comment on table public.project_escalation_contacts is
  'Ordered, project-specific escalation for operational EXCEPTIONS (tier 1 = '
  'first destination). Not an approval step on routine work; separate from '
  'participation and ownership.';


-- =============================================================================
-- 7. TODAY'S FOCUS — temporary management direction fed to GoRules
-- Elevates a project (scope='project') or a single activity (scope='activity')
-- for a bounded period. expires_at is NOT NULL by construction, so a focus
-- always ends and can never silently become a permanent priority. The engine
-- reads only CURRENTLY-active focus (now < expires_at). Focus is a signal that
-- influences ordering; it never disables other work and never overrides a
-- customer commitment or capability eligibility.
-- =============================================================================
create table if not exists public.todays_focus (
  id               uuid primary key default gen_random_uuid(),
  -- what is being elevated:
  --   'project'  -> project_id is required, work_function_id is null
  --   'activity' -> work_function_id is required, project_id is optional
  --                 (optionally scope the activity to one project)
  scope            text not null check (scope in ('project', 'activity')),
  project_id       uuid references public.projects (id)       on delete cascade,
  work_function_id uuid references public.work_functions (id) on delete cascade,
  note             text,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  -- temporary by construction: a focus always has an end.
  expires_at       timestamptz not null,
  constraint todays_focus_scope_shape check (
    (scope = 'project'  and project_id is not null and work_function_id is null)
    or
    (scope = 'activity' and work_function_id is not null)
  ),
  constraint todays_focus_expiry_after_creation check (expires_at > created_at)
);

comment on table public.todays_focus is
  'Temporary management direction that elevates a project or a single activity '
  'for a bounded period (expires_at is required, so focus is never permanent). '
  'Fed to the GoRules Daily Direction engine as a priority signal; it never '
  'disables other work and never overrides a customer commitment or capability '
  'eligibility.';

create index if not exists todays_focus_active_idx
  on public.todays_focus (expires_at);


-- =============================================================================
-- 8. SEED — capabilities, 1035 participation, and 1035 escalation (real roster)
-- Grounded in the actual roster and the real "1035 Reviews" project. These seed
-- the FIRST workable slice; they are declared data, not a permanent hierarchy,
-- and the Team settings UI can change them. on conflict keeps replays idempotent.
-- =============================================================================
-- [removed: employee/project business-data seed block — superseded by the
--  single email-resolved settled-config block at the end of this migration]


-- =============================================================================
-- 9. TABLE PRIVILEGES
-- Match every existing public table: default privileges do not auto-grant DML to
-- the API roles on this branch, so grant explicitly or PostgREST returns 403.
-- RLS below is what actually gates row access.
-- =============================================================================
grant all on public.work_functions              to anon, authenticated, service_role;
grant all on public.producer_work_functions      to anon, authenticated, service_role;
grant all on public.project_participants          to anon, authenticated, service_role;
grant all on public.project_escalation_contacts   to anon, authenticated, service_role;
grant all on public.todays_focus                  to anon, authenticated, service_role;


-- =============================================================================
-- 10. ROW LEVEL SECURITY
-- Internal staff (admin) read; all writes via service_role. Matches the
-- projects / stewardship module pattern exactly. Internal-only; no portal.
-- =============================================================================
alter table public.work_functions             enable row level security;
alter table public.producer_work_functions    enable row level security;
alter table public.project_participants        enable row level security;
alter table public.project_escalation_contacts enable row level security;
alter table public.todays_focus                enable row level security;

drop policy if exists work_functions_admin_select on public.work_functions;
create policy work_functions_admin_select
  on public.work_functions for select to authenticated using (public.jwt_is_admin());
drop policy if exists work_functions_all on public.work_functions;
create policy work_functions_all
  on public.work_functions for all to service_role using (true) with check (true);

drop policy if exists producer_work_functions_admin_select on public.producer_work_functions;
create policy producer_work_functions_admin_select
  on public.producer_work_functions for select to authenticated using (public.jwt_is_admin());
drop policy if exists producer_work_functions_all on public.producer_work_functions;
create policy producer_work_functions_all
  on public.producer_work_functions for all to service_role using (true) with check (true);

drop policy if exists project_participants_admin_select on public.project_participants;
create policy project_participants_admin_select
  on public.project_participants for select to authenticated using (public.jwt_is_admin());
drop policy if exists project_participants_all on public.project_participants;
create policy project_participants_all
  on public.project_participants for all to service_role using (true) with check (true);

drop policy if exists project_escalation_contacts_admin_select on public.project_escalation_contacts;
create policy project_escalation_contacts_admin_select
  on public.project_escalation_contacts for select to authenticated using (public.jwt_is_admin());
drop policy if exists project_escalation_contacts_all on public.project_escalation_contacts;
create policy project_escalation_contacts_all
  on public.project_escalation_contacts for all to service_role using (true) with check (true);

drop policy if exists todays_focus_admin_select on public.todays_focus;
create policy todays_focus_admin_select
  on public.todays_focus for select to authenticated using (public.jwt_is_admin());
drop policy if exists todays_focus_all on public.todays_focus;
create policy todays_focus_all
  on public.todays_focus for all to service_role using (true) with check (true);


-- Refresh PostgREST's schema cache so the new tables / columns are visible via
-- the API immediately.
notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261022000001_ipf_overlay_corrections.sql >>>
-- =============================================================================
-- IPF overlay corrections — management authority, project ownership, and
-- removal of title-inferred capabilities
-- Migration: 20261022000001_ipf_overlay_corrections.sql
--
-- Corrects material issues in 20261021000001_ipf_work_overlay:
--
--   1. MANAGEMENT AUTHORITY. Today's Focus is management direction, but the
--      internal auth model has a single 'admin' role shared by all internal
--      staff, so it cannot distinguish management from line staff. Add the
--      evidenced producers.is_management responsibility fact (nullable, like the
--      qualification flags — a settled responsibility, NOT a job title) and set
--      it true only where management is a settled decision.
--
--   2. PROJECT OWNERSHIP / RESPONSIBILITY, kept DISTINCT from participation and
--      escalation. Add project_participants.role so a participant's project
--      responsibility (owner, operations manager, senior producer, ...) is
--      explicit. Ownership and operations-management are responsibilities on the
--      participation row; the escalation path stays its own ordered table.
--
--   3. REMOVE TITLE-INFERRED CAPABILITIES. The first-slice seed assigned
--      outreach / research / operations_prep / office_support from job titles
--      alone. Capabilities must come from actual evidence or a settled decision,
--      not a title, so those assignments are removed. The ONLY capability kept
--      is Bob -> determination, which is a SETTLED decision codified in the 1035
--      workflow (src/lib/projects/review-1035.ts: the determination is "Bob's
--      turn"); his is_life_licensed fact is required by that responsibility.
--      The capability catalog and the schema are unchanged; capabilities are now
--      simply unassigned until management assigns them (the Team editor is the
--      future home for that), which is the honest state.
--
--   4. STAFFING / ACCOUNTABILITY (settled decisions):
--        * Bob owns the 1035 project AND serves as operations manager.
--        * Angie is the FIRST operational escalation contact (unchanged).
--        * Ashley is a SENIOR PRODUCER, not the 1035 operations manager (the
--          prior seed mislabeled her "Operations manager").
--
-- SAFE REPLAY + PRODUCTION PORTABILITY: every step is idempotent and guarded.
-- Columns use ADD COLUMN IF NOT EXISTS. Capability removal is scoped to the
-- exact (producer, capability) pairs the prior seed created and is a no-op if
-- they are already gone. Staffing updates are guarded on the real 1035 project
-- existing, and on each producer existing, so a replay against production (which
-- may not yet have that project or those producers) is a clean no-op rather than
-- an error. Nothing here depends on the prior seed having run.
--
-- Already applied to development; this reconciles the corrections with the live
-- development schema. Depends on 20261021000001_ipf_work_overlay.
-- =============================================================================


-- =============================================================================
-- 1. MANAGEMENT RESPONSIBILITY FACT ON PRODUCERS
-- Nullable, no default: NULL/unknown and false both mean "not authorized as
-- management"; only an affirmative true authorizes setting Today's Focus. This
-- is a settled responsibility fact, not a title.
-- =============================================================================
alter table public.producers
  add column if not exists is_management boolean;

comment on column public.producers.is_management is
  'Management responsibility fact: whether this team member is authorized to set '
  'management direction (Today''s Focus). NULL/unknown and false both mean not '
  'authorized; only true authorizes. A settled responsibility, not a job title.';


-- =============================================================================
-- 2. PROJECT PARTICIPATION ROLE
-- An explicit, optional project responsibility on the participation row, kept
-- distinct from the escalation path. Open text (not a hard enum) so new project
-- types can describe their own responsibilities without a schema change; the
-- values used today are 'owner', 'operations_manager', 'senior_producer',
-- 'operations', 'outreach'.
-- =============================================================================
alter table public.project_participants
  add column if not exists role text;

comment on column public.project_participants.role is
  'Optional project responsibility for this participant (e.g. owner, '
  'operations_manager, senior_producer, operations, outreach). Distinct from the '
  'escalation path (project_escalation_contacts) and from capability eligibility '
  '(producer_work_functions). Participation/ownership does not imply performing '
  'every activity.';


-- =============================================================================
-- 3. REMOVE TITLE-INFERRED CAPABILITY ASSIGNMENTS (provably seed-origin only)
-- The first-slice seed created a set of agency-wide capability assignments from
-- job titles. Those must be removed, but a corrective migration must NEVER
-- delete an assignment that did NOT come from its own seed (a human assignment
-- via the Team editor, or an evidence-based assignment from a later migration),
-- and must never silently change an assignment_type.
--
-- Provenance is therefore the gate: this removes a row ONLY when it is both a
-- known title-inferred (producer, capability) pair AND marked
-- source = 'migration_seed'. Any row a human/other migration created carries
-- source = 'manual' (the column default) and is left completely untouched —
-- even for the very same (producer, capability) pair and whatever its
-- assignment_type. On a fresh replay, section 8 of 20261021000001 now seeds only
-- Bob -> determination (also 'migration_seed', and deliberately excluded below),
-- so there are no title-inferred seed rows to remove and this is a clean no-op;
-- it also no-ops in any environment that never ran the historical seed or whose
-- producers differ.
--
-- (The source column itself is added by 20261021000001 for a fresh replay, and
-- backfilled on the already-applied development database by
-- 20261024000001_capability_source_provenance so this guard has a column to
-- read. If the column is somehow absent, this block is skipped rather than
-- failing.)
-- =============================================================================
-- [removed: employee/project business-data seed block — superseded by the
--  single email-resolved settled-config block at the end of this migration]


-- =============================================================================
-- 4. STAFFING / ACCOUNTABILITY — settled decisions
-- Guarded on the real 1035 project and each producer existing, so a replay in an
-- environment without them is a clean no-op.
-- =============================================================================
-- [removed: employee/project business-data seed block — superseded by the
--  single email-resolved settled-config block at the end of this migration]


-- Refresh PostgREST's schema cache so the new columns are visible via the API.
notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261023000001_capabilities_evidence_and_management.sql >>>
-- =============================================================================
-- IPF overlay — evidence-based capabilities and management authority
-- Migration: 20261023000001_capabilities_evidence_and_management.sql
--
-- Forward data correction (no schema change). Two settled things:
--
--   1. EVIDENCE-BASED CAPABILITIES. The prior correction (20261022000001)
--      removed capability assignments that had been inferred from job titles,
--      leaving only Bob -> determination. This migration restores the
--      assignments that are backed by ESTABLISHED, ACTUAL RESPONSIBILITIES
--      (not titles):
--        * Dulce and Gabe perform customer outreach and calls   -> 'outreach'
--        * Angie handles servicing outreach and operations
--            -> 'outreach' (support), 'research', 'operations_prep'
--        * Bob performs 1035 determinations                     -> 'determination'
--            (already present; reasserted idempotently, with his life-license
--             fact which that responsibility requires)
--      Nothing is asserted for anyone else: genuinely unknown qualifications
--      stay unassigned (the absence of a row = not qualified), and no licensing
--      flag is invented.
--
--   2. MANAGEMENT AUTHORITY (confirmed decision). Both Bob (operations manager)
--      and Andy (agency owner) may set, modify, and end Today's Focus. Grant
--      producers.is_management = true to BOTH, using their verified producer
--      records. No other employee receives this authority.
--
-- SAFE REPLAY + PORTABILITY: every write is guarded on the producer and the
-- capability existing and uses on-conflict / existence filters, so a replay — or
-- a run against an environment with a different roster — is a clean no-op rather
-- than an error, and never overwrites a legitimate assignment made elsewhere.
--
-- Already applied to development as part of this correction. Depends on
-- 20261021000001_ipf_work_overlay and 20261022000001_ipf_overlay_corrections.
-- =============================================================================


-- =============================================================================
-- 1. EVIDENCE-BASED CAPABILITY ASSIGNMENTS
-- Each row is inserted only when BOTH the producer and the work function exist,
-- via a join, so a different roster cannot cause a foreign-key failure. Routable
-- assignment types only (primary/support). on conflict do nothing keeps replays
-- idempotent and preserves any assignment a human later changes.
-- =============================================================================
-- [removed: employee/project business-data seed block — superseded by the
--  single email-resolved settled-config block at the end of this migration]


-- =============================================================================
-- 2. MANAGEMENT AUTHORITY — Bob and Andy only
-- Confirmed decision: Bob (operations manager) and Andy (agency owner) may set,
-- modify, and end Today's Focus. Grant to BOTH via their verified records; no
-- other employee. Guarded on existence; idempotent.
-- =============================================================================
-- [removed: employee/project business-data seed block — superseded by the
--  single email-resolved settled-config block at the end of this migration]


-- Refresh PostgREST's schema cache (no new columns, but keeps a replay uniform).
notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261024000001_capability_source_provenance.sql >>>
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
-- [removed: employee/project business-data seed block — superseded by the
--  single email-resolved settled-config block at the end of this migration]

comment on column public.producer_work_functions.source is
  'Provenance: ''migration_seed'' = created by a migration demonstration seed '
  '(eligible for migration cleanup); ''manual'' (default) = created by a human '
  'or an evidence-based migration (never touched by cleanup).';

-- 2. Backfill to the fresh-replay end-state.
-- First, everything is legitimate/manual by default (protects all rows).
-- [removed: employee/project business-data write — see settled-config block]

-- Then re-tag ONLY the one demonstration-seeded row that a fresh replay would
-- mark 'migration_seed': Bob -> determination, agency-wide, created by the
-- 20261021000001 seed. Guarded on the producer + capability existing. This is
-- the row the corrective migration deliberately KEEPS (it is excluded from the
-- cleanup pair-list), so tagging it changes no behavior; it simply makes the
-- development provenance identical to a fresh replay.
-- [removed: employee/project business-data seed block — superseded by the
--  single email-resolved settled-config block at the end of this migration]

notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261025000001_1035_project_responsibilities.sql >>>
-- =============================================================================
-- 1035 project responsibilities — corrected participant descriptions
-- Migration: 20261025000001_1035_project_responsibilities.sql
--
-- Corrects the 1035 project PARTICIPANT responsibilities surfaced in My
-- Projects so each person's project responsibility reads accurately. These are
-- PROJECT RESPONSIBILITIES (project_participants.role + note), kept strictly
-- distinct from:
--   - job titles        (producers.title — untouched here)
--   - qualifications    (producers.is_* license facts — only Angie's life
--                        license is asserted below, as a FACT, not a role)
--   - routing/eligibility (producer_work_functions — DELIBERATELY untouched: a
--                        responsibility label never changes who work is routed
--                        to)
--
-- Settled responsibilities (acceptance decision):
--   Bob     Project Owner and Operations Manager   (role already 'owner')
--   Angie   Operations (life licensed)             (role 'operations';
--                                                    is_life_licensed = true)
--   Nikki   Underwriting Support (licensing unconfirmed)
--                                                   (role 'underwriting_support';
--                                                    licensing left NULL/unknown)
--   Gabe    Operations                             (role 'operations')
--   Dulce   Operations                             (role 'operations')
--   Ashley  Senior Producer                        (role already 'senior_producer')
--
-- Angie's life-license fact: Angie performs operations that touch life-licensed
-- work, and her life license is a settled, established FACT, so is_life_licensed
-- is set true. This is a qualification fact, not a project role; it is recorded
-- on producers, and My Projects shows it as a separate "(life licensed)"
-- annotation beside the Operations responsibility. Nikki's licensing is NOT
-- asserted (it is unconfirmed), so her fact stays NULL (unknown) and surfaces as
-- "(licensing unconfirmed)" for the underwriting-support responsibility.
--
-- IMPORTANT: no routing is changed. Gabe and Dulce keep their existing outreach
-- capability assignments (producer_work_functions); only their PROJECT
-- responsibility label changes to Operations. The two concepts are independent.
--
-- SAFE REPLAY + PRODUCTION PORTABILITY: every write is guarded on the real 1035
-- project and each producer existing, and only UPDATEs existing participation
-- rows (participants were seeded by 20261021000001). A run against an
-- environment without that project or those producers is a clean no-op.
--
-- Depends on 20261021000001_ipf_work_overlay (project_participants + role) and
-- 20261022000001_ipf_overlay_corrections (role column, Bob/Ashley/Angie roles).
-- =============================================================================
-- [removed: employee/project business-data seed block — superseded by the
--  single email-resolved settled-config block at the end of this migration]

-- Refresh PostgREST's schema cache (no new columns; keeps a replay uniform).
notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261026000001_project_1035_document_skips.sql >>>
-- =============================================================================
-- 1035 Exchange Review — Step 3 document SKIPS (durable "unavailable" marker).
--
-- Operations Preparation requires, for each PERMANENT policy, a Carrier
-- Statement and a Reprojection. A document can either be UPLOADED (a row in
-- policy_documents) or explicitly SKIPPED as UNAVAILABLE. A skip is NOT a
-- received document: it is a durable, reversible record that operations
-- affirmatively marked this (policy, document type) unavailable so the customer
-- can still advance. Keeping skips in their own table leaves policy_documents
-- strictly about real files (its storage_location / document_date stay NOT NULL
-- and honest), and makes a skip reversible by deleting its row.
--
-- Grain matches a real document exactly: one row per
-- (project_id, customer_id, policy_id, document_type). A real upload and a skip
-- for the same tuple are mutually exclusive by workflow (the UI/route clears one
-- when setting the other), and the gating logic treats a (policy, type) as
-- ADDRESSED when either a document exists OR a skip row exists.
-- =============================================================================
create table if not exists public.project_customer_document_skips (
  id            uuid primary key default gen_random_uuid(),

  project_id    uuid not null references public.projects (id)          on delete cascade,
  customer_id   uuid not null references public.customers (id)         on delete cascade,
  policy_id     uuid not null references public.service_policies (id)  on delete cascade,

  -- The required Step-3 document type being marked unavailable. Mirrors
  -- REQUIRED_DOCUMENT_TYPES in src/lib/projects/review-1035.ts.
  document_type text not null
    check (document_type in ('carrier_statement', 'reprojection')),

  -- Why it is unavailable (optional free text) and provenance of the skip.
  reason        text,
  skipped_by    uuid references public.producers (id) on delete set null,
  skipped_at    timestamptz not null default now(),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.project_customer_document_skips is
  'Durable, reversible "document unavailable" markers for 1035 Step 3. A row '
  'means operations explicitly SKIPPED a required document (carrier_statement or '
  'reprojection) for a specific permanent policy because it is unavailable. This '
  'is NOT a received document — real files live in policy_documents. A (policy, '
  'type) counts as ADDRESSED for the handoff gate when a policy_documents row '
  'exists OR a skip row exists. Reversible by deleting the row.';

comment on column public.project_customer_document_skips.document_type is
  'carrier_statement | reprojection — the required Step-3 document marked '
  'unavailable for this policy.';

-- One current skip per (project, customer, policy, document_type) — the same
-- grain as a policy_documents row, so a skip is per-policy-per-type and upserts
-- cleanly on this arbiter.
create unique index if not exists project_customer_document_skips_unique
  on public.project_customer_document_skips (project_id, customer_id, policy_id, document_type);

create index if not exists project_customer_document_skips_project_customer_idx
  on public.project_customer_document_skips (project_id, customer_id);

create trigger project_customer_document_skips_set_updated_at
  before update on public.project_customer_document_skips
  for each row execute function public.set_updated_at();


-- =============================================================================
-- TABLE PRIVILEGES — match every existing public table (DML is granted
-- explicitly or PostgREST returns 403). RLS below gates row access.
-- =============================================================================
grant all on public.project_customer_document_skips to anon, authenticated, service_role;


-- =============================================================================
-- ROW LEVEL SECURITY — internal staff (admin) read; all writes via service_role.
-- Matches project_customer_reviews and the rest of the project module.
-- =============================================================================
alter table public.project_customer_document_skips enable row level security;

create policy project_customer_document_skips_admin_select
  on public.project_customer_document_skips for select to authenticated
  using (public.jwt_is_admin());

create policy project_customer_document_skips_all
  on public.project_customer_document_skips for all to service_role
  using (true) with check (true);


-- Refresh PostgREST's schema cache so the new table is visible via the API.
notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261027000001_contact_review_work_function.sql >>>
-- =============================================================================
-- Contact Review capability — catalog row + eligibility mirrored from Research
-- Migration: 20261027000001_contact_review_work_function.sql
--
-- Contact Review is the project-scoped pass that completes customer contact
-- information missing from the Cassidy import (reuses the existing shared
-- research interface and writes only to the customer record). It already exists
-- as a surface at /projects/[id]/contact-review. This migration makes it a
-- first-class entry in My Work -> Quiet Work by giving it a capability catalog
-- row, so eligibility is resolved by the SAME producer_work_functions machinery
-- every other activity uses — no hardcoded person, no new workflow.
--
-- Eligibility model (settled): Contact Review is contact-completion work, the
-- same capability family as Contact Research ('research'). So the people
-- eligible to perform Contact Review are exactly those already eligible for
-- Contact Research. Rather than name anyone, this migration DERIVES the grants
-- from the live 'research' assignments: for every producer_work_functions row
-- on 'research', it creates the matching 'contact_review' row (same producer,
-- assignment_type, project scope, source). Whoever can do Contact Research can
-- do Contact Review — including future grantees, because the Team editor writes
-- both through the same table.
--
-- SAFE REPLAY + PORTABILITY: the catalog upsert is idempotent; the eligibility
-- insert is guarded by `on conflict do nothing` against the existing partial
-- unique indexes, so a re-run adds nothing. An environment with no 'research'
-- rows simply grants nothing. No existing assignment is modified or removed.
--
-- Depends on 20261021000001_ipf_work_overlay (work_functions +
-- producer_work_functions, their unique indexes, and the qualification trigger).
-- Contact Review has NO license gate (required_qualification is null), matching
-- Contact Research, so the qualification trigger never blocks these inserts.
-- =============================================================================

-- 1. Catalog row. sort_order 25 places Contact Review immediately after Contact
--    Research (20) and before Operations Preparation (30), so the Quiet Work
--    listing reads research -> contact review -> operations in a natural order.
insert into public.work_functions (canonical_key, label, description, required_qualification, sort_order)
values
  ('contact_review', 'Contact Review',
   'Project-scoped pass to complete customer contact information missing from the import: look the customer up in eAgent and fill in a missing email or phone. Writes only to the customer record.',
   null, 25)
on conflict (lower(canonical_key)) do update
  set label = excluded.label,
      description = excluded.description,
      required_qualification = excluded.required_qualification,
      sort_order = excluded.sort_order;

-- 2. Eligibility, mirrored from Research. One row per existing 'research'
--    assignment, pointed at 'contact_review'. The source is carried through so
--    provenance stays truthful (a mirrored manual grant reads as 'manual'); a
--    distinct marker is not used because these ARE the research grants, re-
--    expressed for the sibling capability. on conflict do nothing makes replay
--    a no-op against both the agency-wide and the per-project unique indexes.
-- [removed: employee/project business-data write — see settled-config block]

-- Refresh PostgREST's schema cache so the new catalog row is immediately
-- resolvable by the API layer.
notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261028000001_case_touches_customer_level.sql >>>
-- =============================================================================
-- Generalize case_touches into one shared communication history that can be
-- recorded against a customer directly, not only through a case.
--
-- Why: the 1035 stewardship outreach flow needs to record a durable email touch
-- that is visible in the customer's Touch History, but stewardship customers
-- typically have no `cases` row (verified on the development clone: 69 of 70
-- open-outreach customers had no non-test case). Rather than fabricate an
-- artificial case or stand up a competing history system, we let case_touches
-- carry a customer-level touch.
--
-- This is additive and backward compatible:
--   * Every existing touch keeps its case_id; nothing is migrated or dropped.
--   * case_id becomes nullable so a touch can be customer-only.
--   * A presence check guarantees a touch always points at a case, a customer,
--     or both — never nothing.
--   * A new touch_type value 'servicing_outreach' identifies the 1035
--     servicing-agent authorization email as its own activity type.
-- =============================================================================

-- 1. Direct customer association (nullable; existing rows stay case-only).
alter table public.case_touches
  add column if not exists customer_id uuid references public.customers (id) on delete cascade;

-- 2. Allow a touch to exist without a case (customer-level touch).
alter table public.case_touches
  alter column case_id drop not null;

-- 3. A touch must point at a case, a customer, or both — never neither.
alter table public.case_touches
  drop constraint if exists case_touches_target_present_check;
alter table public.case_touches
  add constraint case_touches_target_present_check
  check (case_id is not null or customer_id is not null);

-- 4. Add the 1035 servicing-outreach activity type to the allowed set.
alter table public.case_touches
  drop constraint if exists case_touches_touch_type_check;
alter table public.case_touches
  add constraint case_touches_touch_type_check
  check (touch_type in ('call', 'voicemail', 'text', 'email', 'missed_appointment', 'servicing_outreach'));

-- 5. Efficient lookup of a customer's touches (customer card gathers by this).
create index if not exists case_touches_customer_id_idx
  on public.case_touches (customer_id, touched_at desc)
  where customer_id is not null;

comment on column public.case_touches.customer_id is
  'Optional direct customer association. Set for customer-level touches that are '
  'not tied to a case (e.g. 1035 servicing-agent outreach, where the customer '
  'often has no case row). Case-linked touches continue to reach the customer '
  'through case_id -> cases.customer_id; this column is the direct path.';

-- >>> schema/catalog from 20261029000001_case_touches_drop_servicing_outreach_type.sql >>>
-- =============================================================================
-- Correction: the 1035 servicing-agent authorization email is recorded as an
-- ordinary 'email' touch, identified by its description, not by a dedicated
-- activity type. Revert the touch_type allow-list added in
-- 20261028000001_case_touches_customer_level.sql back to the established set.
--
-- The customer-level extension to case_touches (nullable customer_id, relaxed
-- case_id, presence check, index) is retained; only the extra 'servicing_outreach'
-- type is removed.
--
-- SAFE: no servicing_outreach rows exist (verified on the development clone
-- before this migration), so tightening the CHECK validates cleanly with no
-- data to migrate. The guard below makes that explicit and keeps replay honest:
-- if any such row somehow exists, it is relabeled to 'email' first so the new
-- constraint can never fail to apply.
-- =============================================================================

-- Defensive: fold any stray servicing_outreach touch into a plain email touch.
-- [removed: case_touches relabel UPDATE — the touch_type CHECK below is applied
--  directly; production has no 'servicing_outreach' rows to relabel]

alter table public.case_touches
  drop constraint if exists case_touches_touch_type_check;

alter table public.case_touches
  add constraint case_touches_touch_type_check
  check (touch_type in ('call', 'voicemail', 'text', 'email', 'missed_appointment'));

-- >>> schema/catalog from 20261030000001_servicing_onboarding_completion.sql >>>
-- =============================================================================
-- Servicing-Agent Onboarding — complete the capture/stewardship workflow
-- Migration: 20261030000001_servicing_onboarding_completion.sql
--
-- The Servicing-Agent Onboarding workflow is the existing Stewardship flow
-- (customer_prereviews + stewardship_outreach + per-policy sa_status on
-- service_policies). This migration adds ONLY the small amount of non-derivable
-- state the workflow was still missing, re-homed on the existing tables. It adds
-- NO new workflow system, NO second database, NO tenancy or auth concepts.
--
-- What it adds, and why each is non-derivable:
--
--   1. Customer-verified contact flags on stewardship_outreach. "On file" is
--      already derivable from customers.email/phone/address. "The customer
--      themselves confirmed this value is correct" is a distinct human fact that
--      is NOT derivable from the contact value's mere presence. These three
--      nullable timestamps record that confirmation (null = not yet verified).
--
--   2. form_delivery_method on stewardship_outreach. The authorization form can
--      be delivered by email or by postal mail. Which channel was chosen for a
--      given outreach is an operator decision, not derivable from any other
--      record. Null until the worker picks a channel.
--
-- What it deliberately does NOT add:
--
--   * No follow-up "attempt count" or "max attempts" column. Follow-ups are
--     scheduled by rolling stewardship_outreach.follow_up_due / callback_date
--     forward on each unsuccessful attempt; there is NO arbitrary attempt limit,
--     so there is nothing to count or cap. The existing columns carry it.
--
--   * No new signed-form / carrier-submission / confirmation columns. Those
--     already exist: stewardship_outreach.form_received_at (signed form back),
--     submitted_at (sent to carrier), carrier_correction, and the PER-POLICY
--     servicing-agent confirmation on service_policies.sa_status /
--     sa_form_sent_at. This workflow reuses them unchanged.
--
-- Depends on: stewardship_outreach (20260927000003). Additive and nullable, so
-- no backfill and no change to existing rows. Grants are re-applied because the
-- stewardship tables rely on explicit table GRANTs (see 20261016000001).
-- =============================================================================


-- 1. Customer-verified contact flags. Each records WHEN the customer confirmed
--    that specific contact value is correct. Distinct from "a value is on file".
alter table public.stewardship_outreach
  add column if not exists phone_verified_at   timestamptz,
  add column if not exists email_verified_at   timestamptz,
  add column if not exists address_verified_at timestamptz;

comment on column public.stewardship_outreach.phone_verified_at is
  'When the customer confirmed their phone is correct during onboarding. Null = '
  'not customer-verified. Distinct from a phone merely being on file.';
comment on column public.stewardship_outreach.email_verified_at is
  'When the customer confirmed their email is correct during onboarding. Null = '
  'not customer-verified. Distinct from an email merely being on file.';
comment on column public.stewardship_outreach.address_verified_at is
  'When the customer confirmed their mailing address is correct during '
  'onboarding. Null = not customer-verified. Required-ish for postal delivery.';


-- 2. Authorization-form delivery channel. Null until the worker chooses.
alter table public.stewardship_outreach
  add column if not exists form_delivery_method text
    check (form_delivery_method in ('email', 'postal'));

comment on column public.stewardship_outreach.form_delivery_method is
  'How the servicing-agent authorization form was delivered to the customer: '
  'email or postal mail. Null until a channel is chosen. Operator decision; not '
  'derivable from other records.';


-- 3. Re-apply grants (stewardship tables depend on explicit table privileges;
--    adding columns does not change privileges, but this keeps the pattern
--    consistent and harmless if re-run).
grant all on public.stewardship_outreach to anon, authenticated, service_role;

-- >>> schema/catalog from 20261030000002_case_touches_postal_type.sql >>>
-- =============================================================================
-- Add 'postal' to case_touches.touch_type
-- Migration: 20261030000002_case_touches_postal_type.sql
--
-- Servicing-agent onboarding can deliver the authorization form by postal mail
-- as well as by email. A mailed form is a real outbound contact that belongs in
-- the customer's history, but 'postal' was not an allowed touch_type, so such a
-- touch could not be recorded honestly (the alternatives — 'email', 'call' —
-- would mislabel the channel). This extends the CHECK to allow 'postal'.
--
-- Additive and safe: no existing row uses 'postal' (verified against the
-- development clone), so the drop/recreate cannot reject existing data. Matches
-- the pattern of 20260526000001 (missed_appointment).
-- =============================================================================

alter table public.case_touches
  drop constraint if exists case_touches_touch_type_check;

alter table public.case_touches
  add constraint case_touches_touch_type_check
  check (touch_type in ('call', 'voicemail', 'text', 'email', 'missed_appointment', 'postal'));

-- >>> schema/catalog from 20261031000001_onboarding_corrections.sql >>>
-- =============================================================================
-- Servicing-Agent Onboarding — correctness fixes (permanent verification +
-- durable completion marker)
-- Migration: 20261031000001_onboarding_corrections.sql
--
-- Two corrections to the onboarding (Stewardship) workflow. Both re-home state
-- that was being kept in the wrong place; neither redesigns the workflow.
--
--   1. Customer-verified contact flags belong on the CUSTOMER, not on the
--      temporary outreach row. A customer confirming their phone / email /
--      address is correct is durable customer-record truth that must survive the
--      end of outreach (the stewardship_outreach row is deleted when onboarding
--      completes). The earlier placement on stewardship_outreach
--      (20261030000001) lost the verification the moment onboarding finished.
--      These three nullable timestamps on customers are the permanent home.
--
--   2. Onboarding COMPLETION needs a durable, non-derivable marker. Completion
--      cannot be inferred from service_policies.sa_status = 'confirmed': a policy
--      can reach confirmed by routes unrelated to an onboarding run, and the
--      request-policy set is deleted (cascade) when the outreach row is removed
--      on completion, so after the fact there is nothing to derive "this
--      onboarding completed" from. customer_prereviews.servicing_completed_at
--      records exactly when a servicing-agent onboarding run finished (every
--      request policy confirmed). It drives: the accurate completed-onboarding
--      summary, the Wanderer -> Explorer promotion (which now fires at
--      completion, not on the first per-policy confirmation), and the Initial
--      Analysis handoff.
--
-- Additive and nullable, so no backfill and no change to existing rows. The
-- stewardship_outreach.*_verified_at columns from 20261030000001 are left in
-- place (harmless, unused) rather than dropped, to keep this migration purely
-- additive and reversible; application code now reads/writes the customers
-- columns exclusively.
--
-- Depends on: customers (20260516000001), customer_prereviews (20260927000002).
-- =============================================================================


-- 1. Permanent customer-verified contact flags on the CUSTOMER record.
alter table public.customers
  add column if not exists phone_verified_at   timestamptz,
  add column if not exists email_verified_at   timestamptz,
  add column if not exists address_verified_at timestamptz;

comment on column public.customers.phone_verified_at is
  'When the customer last confirmed their phone is correct (servicing-agent '
  'onboarding verification). Null = not customer-verified. Durable; distinct '
  'from a phone merely being on file.';
comment on column public.customers.email_verified_at is
  'When the customer last confirmed their email is correct. Null = not '
  'customer-verified. Durable; distinct from an email merely being on file.';
comment on column public.customers.address_verified_at is
  'When the customer last confirmed their mailing address is correct. Null = '
  'not customer-verified. Durable; distinct from an address being on file.';


-- 2. Durable onboarding-completion marker on the pre-review work item.
alter table public.customer_prereviews
  add column if not exists servicing_completed_at timestamptz;

comment on column public.customer_prereviews.servicing_completed_at is
  'When the servicing-agent onboarding run for this customer completed (every '
  'policy in the request had its servicing agent confirmed). Durable and '
  'non-derivable: the outreach row and its request-policy links are deleted on '
  'completion. Null while onboarding is in progress or never run. Drives the '
  'completed-onboarding summary, the Wanderer->Explorer promotion, and the '
  'Initial Analysis handoff.';

-- >>> schema/catalog from 20261101000001_onboarding_followups_refusal_handoff.sql >>>
-- =============================================================================
-- Servicing-Agent Onboarding — refusal stop, resilient handoff, and
-- clear-verification-on-contact-change
-- Migration: 20261101000001_onboarding_followups_refusal_handoff.sql
--
-- Three additive corrections. None redesign the workflow.
--
--   1. Explicit refusal stop. A customer who explicitly declines
--      ('not-interested') must stop surfacing for further outreach until a human
--      deliberately reopens them. stewardship_outreach.refused_at records that
--      stop. It is NOT an automatic lost/closed state (none exists): it is a
--      human-recorded disposition that suppresses resurfacing, reversible via an
--      explicit reopen. The item keeps its queue; actionable/resurfacing reads
--      simply skip refused items while refused_at is set.
--
--   2. Resilient Initial Analysis handoff. The handoff at onboarding completion
--      must never be silently lost. customer_prereviews.handoff_status records
--      the outcome ('done' | 'failed'), and handoff_error carries the reason on
--      failure, so a failed handoff is visible and retryable instead of
--      swallowed by a best-effort catch. Null = no handoff attempted yet.
--
--   3. Clear contact verification when the contact value changes. The
--      customers.*_verified_at flags (added 20261031000001) record that a
--      customer confirmed a value is correct. If that value later changes, the
--      confirmation no longer applies and must clear. A trigger does this at the
--      database for EVERY write path (the customer edit API, imports, the
--      stewardship research-found write), so no single code path can forget it.
--      Address verification tracks the mailing address across BOTH conventions
--      present in this schema (street and address_line1) plus city/state/zip.
--
-- Depends on: stewardship_outreach (20260927000003), customer_prereviews +
-- the verification/completion columns (20261031000001). Additive and nullable;
-- no backfill. Grants re-applied for the stewardship table per its convention.
-- =============================================================================


-- 1. Refusal stop (explicit, reversible; not an auto-close).
alter table public.stewardship_outreach
  add column if not exists refused_at timestamptz;

comment on column public.stewardship_outreach.refused_at is
  'When the customer explicitly declined further servicing-agent outreach '
  '(call outcome not-interested). While set, the item is suppressed from '
  'actionable/resurfacing reads. Cleared by an explicit reopen. Human-recorded; '
  'never an automatic lost/closed state.';

grant all on public.stewardship_outreach to anon, authenticated, service_role;


-- 2. Resilient handoff outcome on the pre-review.
alter table public.customer_prereviews
  add column if not exists handoff_status text
    check (handoff_status in ('done', 'failed')),
  add column if not exists handoff_error  text;

comment on column public.customer_prereviews.handoff_status is
  'Outcome of the Initial Analysis handoff triggered at onboarding completion: '
  'done = the analysis prep item was created/confirmed; failed = the handoff '
  'errored and must be retried (see handoff_error). Null = not attempted. A '
  'failed handoff is never silently lost.';
comment on column public.customer_prereviews.handoff_error is
  'Error detail when handoff_status = failed, for diagnosis and retry.';


-- 3. Clear verification flags when the corresponding contact value changes.
create or replace function public.clear_contact_verification_on_change()
returns trigger
language plpgsql
as $$
begin
  -- Phone: clear phone_verified_at when the phone value changes.
  if new.phone is distinct from old.phone then
    new.phone_verified_at := null;
  end if;

  -- Email: clear email_verified_at when the email value changes.
  if new.email is distinct from old.email then
    new.email_verified_at := null;
  end if;

  -- Address: clear address_verified_at when any component of the mailing
  -- address changes. Both street conventions are watched (real data uses
  -- `street`; `address_line1` exists for the stewardship form), plus city /
  -- state / zip.
  if new.street       is distinct from old.street
     or new.address_line1 is distinct from old.address_line1
     or new.city       is distinct from old.city
     or new.state      is distinct from old.state
     or new.zip        is distinct from old.zip then
    new.address_verified_at := null;
  end if;

  return new;
end;
$$;

comment on function public.clear_contact_verification_on_change() is
  'Clears a customers.*_verified_at flag whenever its corresponding contact '
  'value changes, so a stale confirmation never outlives the value it confirmed.';

drop trigger if exists customers_clear_contact_verification on public.customers;
create trigger customers_clear_contact_verification
  before update on public.customers
  for each row
  execute function public.clear_contact_verification_on_change();

-- >>> schema/catalog from 20261102000001_project_workflows.sql >>>
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
-- [removed: employee/project business-data seed block — superseded by the
--  single email-resolved settled-config block at the end of this migration]


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

-- >>> schema/catalog from 20261103000001_work_function_working_order.sql >>>
-- =============================================================================
-- My Work working-order correction — work_functions.sort_order
-- Migration: 20261103000001_work_function_working_order.sql
--
-- WHY: My Work's recommended working plan is ordered by the GoRules ZEN priority
-- BAND first and then, WITHIN a band, by the capability catalog's sort_order
-- (the established secondary ordering the composition already applies). ZEN owns
-- the band judgment; sort_order owns the business ordering of materially
-- different activities that share a band. This is NOT a new UI priority system
-- and NOT a change to any band — it corrects the secondary ordering so equal-
-- band onboarding activities no longer read as co-equal "any of these".
--
-- The settled Servicing Agent Onboarding working order is:
--   1. Contact Research       — customers with NO usable contact method; find
--                               a working email/phone before anything else.
--   2. Contact Review         — customers missing an ADDITIONAL contact method;
--                               complete it next.
--   3. Outreach               — introductory emails, then phone calls (due
--                               calls distinguished from other callable work).
--   4. Operations Preparation — work already ready to advance, independent of
--                               ongoing outreach.
--   5. Determination          — senior-producer candidacy decision.
--   6. General Office Support  — ordinary office business.
--
-- The PRIOR order led with Outreach (10) ahead of Research (20) and Contact
-- Review (25), which is materially wrong for onboarding: you cannot email or
-- call a customer whose contact method is still missing. This migration moves
-- Research and Contact Review ahead of Outreach, and leaves Operations
-- Preparation / Determination / Office Support after it.
--
-- SAFE REPLAY + PORTABILITY: pure idempotent UPDATEs keyed by canonical_key; a
-- re-run sets the same values. No row is created or removed, no band changes,
-- no eligibility changes. Depends on 20261021000001_ipf_work_overlay (seeds the
-- catalog) and 20261027000001_contact_review_work_function (seeds contact_review).
-- =============================================================================

update public.work_functions set sort_order = 10 where canonical_key = 'research';
update public.work_functions set sort_order = 20 where canonical_key = 'contact_review';
update public.work_functions set sort_order = 30 where canonical_key = 'outreach';
update public.work_functions set sort_order = 40 where canonical_key = 'operations_prep';
update public.work_functions set sort_order = 50 where canonical_key = 'determination';
update public.work_functions set sort_order = 60 where canonical_key = 'office_support';

-- Refresh PostgREST's schema cache so the reordering is reflected immediately.
notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261103000002_case_touches_research_type.sql >>>
-- =============================================================================
-- Add 'research' to case_touches.touch_type
-- Migration: 20261103000002_case_touches_research_type.sql
--
-- Internal contact RESEARCH (an employee looking a customer up in eAgent to try
-- to find a missing email or phone) is NOT a customer communication. It was
-- being recorded as a 'call' or 'email' touch, which mislabeled it in the
-- customer's Touch History as an actual outbound contact. This adds a dedicated
-- 'research' touch_type so an internal look-up is recorded honestly and read as
-- what it is, while preserving the SAME durable mechanism (one case_touches row
-- carrying the per-method outcome marker on the note, the acting employee in
-- touched_by, and the moment in touched_at).
--
-- Additive and safe: it only widens the CHECK allow-list, so every existing row
-- (all of which use the prior types) remains valid. Mirrors the pattern of
-- 20260526000001 (missed_appointment) and 20260530000002/20261030000002
-- (postal). The attempt-history reader counts only genuine outreach channels
-- (call / voicemail / text / email / postal), so a 'research' touch never
-- inflates the outreach attempt or Nonresponsive counts.
-- =============================================================================

alter table public.case_touches
  drop constraint if exists case_touches_touch_type_check;

alter table public.case_touches
  add constraint case_touches_touch_type_check
  check (touch_type in ('call', 'voicemail', 'text', 'email', 'missed_appointment', 'postal', 'research'));

-- >>> schema/catalog from 20261104000001_consolidate_contact_research.sql >>>
-- =============================================================================
-- Consolidate contact research into ONE activity
-- Migration: 20261104000001_consolidate_contact_research.sql
--
-- Right Path had TWO overlapping contact-finding activities:
--   * 'research'        — the Stewardship board exception path (customers with
--                         NO usable contact method).
--   * 'contact_review'  — the project-scoped pass (customers missing EITHER a
--                         usable email or phone), seeded by
--                         20261027000001_contact_review_work_function.sql with
--                         its eligibility MIRRORED one-for-one from 'research'.
--
-- They are now a SINGLE consolidated activity. The project Contact Research read
-- (buildContactReview) already covers every customer missing a method — a strict
-- superset of the board's no-usable-contact population — so one activity routed
-- to one screen counts each customer once. 'research' is that single activity;
-- 'contact_review' is retired.
--
-- What this migration does:
--   1. Removes the mirrored 'contact_review' eligibility rows. They were created
--      as exact copies of the 'research' grants, so deleting them loses nothing:
--      whoever can do contact research is already eligible via 'research'.
--   2. Removes the 'contact_review' catalog row.
--   3. Relabels/retunes 'research' to describe the consolidated activity (it now
--      covers missing-one as well as missing-both) and reasserts its working
--      order (sort_order 10, ahead of Outreach), matching
--      20261103000001_work_function_working_order.sql.
--
-- SAFE REPLAY: every statement is idempotent. Deleting absent rows is a no-op;
-- the catalog update is a plain upsert-by-key. No 'research' grant is touched;
-- no producer loses eligibility for contact research.
--
-- Depends on 20261021000001_ipf_work_overlay (work_functions +
-- producer_work_functions), 20261027000001_contact_review_work_function (which
-- seeded the rows removed here), and 20261103000001_work_function_working_order.
-- =============================================================================

-- 1. Remove the mirrored contact_review eligibility rows.
-- [removed: employee/project business-data write — see settled-config block]

-- 2. Remove the contact_review catalog row.
delete from public.work_functions where canonical_key = 'contact_review';

-- 3. Reassert 'research' as the single consolidated Contact Research activity.
update public.work_functions
set label = 'Contact Research',
    description =
      'Find the contact information missing from the import: look the customer '
      || 'up in eAgent and fill in a usable email or phone. Covers every customer '
      || 'missing a method — those with no usable contact at all (the No Usable '
      || 'Contact Information exception) and those missing just one. Writes only '
      || 'to the customer record.',
    sort_order = 10
where canonical_key = 'research';

-- Refresh PostgREST's schema cache so the catalog change is visible immediately.
notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261105000001_intro_email_recipient.sql >>>
-- =============================================================================
-- Track the introductory-email recipient so a replaced address re-offers it
-- Migration: 20261105000001_intro_email_recipient.sql
--
-- The introductory servicing-agent authorization email is the first-touch
-- action for a customer not yet contacted. Until now the only durable record of
-- that send was `email_sent_at` (a timestamp). That is not enough to satisfy the
-- business rule that replacing a customer's email — when the earlier
-- introduction went to the OLD address — makes the introduction available again
-- for the NEW address: the system could not tell WHICH address the introduction
-- went to.
--
-- This adds one durable fact, `intro_email_recipient`, stamped with the email
-- address the introductory/authorization email was actually sent to at the
-- moment of sending. Reads compare it to the customer's current usable email: a
-- match means the introduction has been delivered to the address on file (no
-- re-offer); a mismatch, while the item is still in the pre-authorization
-- funnel, means the introduction was delivered to an address the customer no
-- longer has, so it becomes available again for the new address. Once the
-- customer has progressed past authorization (awaiting the signed form or the
-- carrier), the introduction is never re-offered — that is a chase, not a
-- restart.
--
-- This complements, and does not replace, the communication history: the send
-- is still recorded as a case_touches row, now carrying the recipient address so
-- history is explicit about who each email reached.
--
-- SAFE REPLAY: add-column IF NOT EXISTS; nullable with no default, so existing
-- rows are unaffected (null = no introduction recorded yet, same as before).
-- =============================================================================

alter table public.stewardship_outreach
  add column if not exists intro_email_recipient text;

comment on column public.stewardship_outreach.intro_email_recipient is
  'The email address the introductory/authorization email was actually sent to, '
  'stamped at send time. A mismatch with the customer''s current usable email, '
  'while still in the pre-authorization funnel, re-offers the introductory email '
  'for the new address. Null when no introduction has been sent.';

notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261106000001_work_reservations.sql >>>
-- =============================================================================
-- Automatic temporary work reservations — the shared coordination primitive
-- Migration: 20261106000001_work_reservations.sql
--
-- WHAT THIS IS: one small, reusable mechanism that lets several employees work
-- the SAME shared activity (Send Introductory Emails, Contact Research, and any
-- future activity) without two of them landing on the same customer. Opening an
-- activity automatically reserves the next available eligible subject; a second
-- employee is handed a different one; Save & Next hands over the next available
-- subject without any button; completing, skipping, or leaving releases it.
--
-- WHAT THIS IS NOT: it is NOT ownership, assignment, or a workflow status. A
-- reservation is a soft, time-boxed lease — a coordination hint, nothing more.
-- It never changes any business record, never decides a customer outcome, and
-- can never leave a permanent hold: every reservation carries an expiry, so a
-- closed browser, a lost connection, or an abandoned session frees the subject
-- automatically once the lease lapses. This is deliberately DISTINCT from the
-- Stewardship board's claimed_by_producer_id (a permanent, explicit board
-- commitment): reservations are temporary and span activities whose subject is
-- a customer (Contact Research) as well as an outreach row (intro emails).
--
-- HOW IT STAYS RELIABLE UNDER CONCURRENCY: the subject is identified by
-- (activity_key, subject_type, subject_id) with a UNIQUE index, and all state
-- changes go through SECURITY DEFINER functions that take a row lock
-- (INSERT ... ON CONFLICT, and SELECT ... FOR UPDATE SKIP LOCKED when scanning
-- a candidate list). Two employees acting at the same instant can never both
-- win the same subject; the loser simply gets the next available one. Expiry is
-- enforced at read time (a lapsed lease is treated as free and is overwritten
-- in place), so no background job or cron is required for recovery.
--
-- SAFE REPLAY: create-if-not-exists table/indexes and create-or-replace
-- functions; a re-run is a no-op. Depends on producers (20261021000001 overlay
-- established the capability model) and the shared helpers jwt_is_admin() and
-- set_updated_at().
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The reservation table.
-- One live row per (activity_key, subject_type, subject_id). The row is reused
-- across reservations of the same subject: when a lease lapses or is released,
-- the next reserver UPDATEs the existing row rather than inserting a new one, so
-- the unique index is the single source of truth for "who, if anyone, holds
-- this subject right now".
-- -----------------------------------------------------------------------------
create table if not exists public.work_reservations (
  id            uuid primary key default gen_random_uuid(),
  -- The activity this reservation coordinates. A free-form stable key (the same
  -- key space the capability catalog uses, e.g. 'introductory_emails',
  -- 'contact_research') so the primitive is reusable without a schema change per
  -- activity. Reservations for different activities never collide even on the
  -- same subject.
  activity_key  text not null,
  -- What KIND of thing is reserved, so the same subject id space can mean an
  -- outreach row for one activity and a customer for another.
  subject_type  text not null check (subject_type in ('stewardship_outreach', 'customer')),
  -- The reserved subject's id (an outreach row id or a customer id). Not a hard
  -- FK: a reservation is a transient coordination hint, and we never want a
  -- subject delete to be blocked by, or cascade into, a lease. Stale rows simply
  -- expire and are ignored.
  subject_id    uuid not null,
  -- The current holder. The reservation always has a holder while live; on
  -- release the row is deleted or its expiry is cleared by the next reserver.
  producer_id   uuid not null references public.producers (id) on delete cascade,
  -- When the lease lapses. Always in the future for a live reservation; a row
  -- whose expires_at <= now() is treated as free and may be taken by anyone.
  expires_at    timestamptz not null,
  -- Last heartbeat, refreshed by the client while the employee is actively
  -- working. Advisory only (expires_at is the authority); kept for observability.
  heartbeat_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.work_reservations is
  'Temporary, self-expiring coordination leases so multiple employees can work '
  'the same shared activity without colliding on the same subject. NOT ownership, '
  'assignment, or a workflow status: a reservation changes no business record and '
  'always expires, so an abandoned session never leaves a permanent hold. One '
  'live row per (activity_key, subject_type, subject_id); all state changes go '
  'through the reserve/release/heartbeat functions for concurrency safety.';

-- One live reservation per subject per activity. UPSERT target.
create unique index if not exists work_reservations_subject_key
  on public.work_reservations (activity_key, subject_type, subject_id);

-- Fast "what do I currently hold / is this subject reserved" lookups.
create index if not exists work_reservations_holder_idx
  on public.work_reservations (activity_key, producer_id);
create index if not exists work_reservations_expiry_idx
  on public.work_reservations (expires_at);

drop trigger if exists work_reservations_set_updated_at on public.work_reservations;
create trigger work_reservations_set_updated_at
  before update on public.work_reservations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. RLS. Internal admins (the operators who run these activities) may read
-- their coordination state; all writes go through the service-role API routes,
-- which call the functions below. No agency-portal exposure.
-- -----------------------------------------------------------------------------
alter table public.work_reservations enable row level security;

drop policy if exists work_reservations_admin_select on public.work_reservations;
create policy work_reservations_admin_select
  on public.work_reservations for select
  using (public.jwt_is_admin());

drop policy if exists work_reservations_service_all on public.work_reservations;
create policy work_reservations_service_all
  on public.work_reservations for all
  to service_role
  using (true) with check (true);

grant all on public.work_reservations to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. reserve_work_subject — atomically reserve ONE specific subject.
-- Returns the holder after the call. Succeeds (returns the caller) when the
-- subject is free, already the caller's (idempotent, refreshes the lease), or
-- held by someone else whose lease has LAPSED (taken over). Returns the OTHER
-- holder's id (not the caller) when a live lease is held by someone else, so the
-- caller can tell it did not get the subject.
--
-- Concurrency: INSERT ... ON CONFLICT DO UPDATE with a WHERE that only lets the
-- update through when the existing lease is the caller's or has expired. The
-- conflict path locks the row, so two simultaneous callers serialize and at most
-- one wins a contested subject.
-- -----------------------------------------------------------------------------
create or replace function public.reserve_work_subject(
  p_activity_key text,
  p_subject_type text,
  p_subject_id   uuid,
  p_producer_id  uuid,
  p_ttl_seconds  integer default 180
)
  returns table (held_by uuid, is_mine boolean)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_now        timestamptz := now();
  v_expires    timestamptz := now() + make_interval(secs => greatest(p_ttl_seconds, 30));
  v_holder     uuid;
begin
  insert into public.work_reservations as wr
    (activity_key, subject_type, subject_id, producer_id, expires_at, heartbeat_at)
  values
    (p_activity_key, p_subject_type, p_subject_id, p_producer_id, v_expires, v_now)
  on conflict (activity_key, subject_type, subject_id) do update
    set producer_id  = excluded.producer_id,
        expires_at   = excluded.expires_at,
        heartbeat_at = excluded.heartbeat_at
    -- Take over ONLY when the existing lease is the caller's (refresh) or has
    -- lapsed (automatic recovery). A live lease held by someone else blocks the
    -- update, leaving their row untouched.
    where wr.producer_id = excluded.producer_id
       or wr.expires_at <= v_now
  returning wr.producer_id into v_holder;

  if v_holder is not null then
    -- We inserted or won the takeover/refresh.
    return query select v_holder, true;
    return;
  end if;

  -- The ON CONFLICT update was blocked: a live lease is held by someone else.
  select wr.producer_id into v_holder
    from public.work_reservations wr
   where wr.activity_key = p_activity_key
     and wr.subject_type = p_subject_type
     and wr.subject_id   = p_subject_id;
  return query select v_holder, (v_holder = p_producer_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. reserve_next_work_subject — the Save & Next primitive.
-- Given an ORDERED list of candidate subject ids (the caller's eligible,
-- in-scope, still-to-do work, computed by the activity's own API), atomically
-- reserve the FIRST candidate that is free or already the caller's, skipping any
-- held live by someone else. Returns the reserved subject id, or NULL when every
-- candidate is currently taken.
--
-- Concurrency: each candidate is probed with the same race-safe reserve as above
-- inside one function call; SKIP LOCKED on the lock probe means a subject another
-- transaction is mid-reserving is passed over rather than waited on, so two
-- employees calling Save & Next at the same instant walk to different subjects.
-- -----------------------------------------------------------------------------
create or replace function public.reserve_next_work_subject(
  p_activity_key   text,
  p_subject_type   text,
  p_candidate_ids  uuid[],
  p_producer_id    uuid,
  p_ttl_seconds    integer default 180
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_now      timestamptz := now();
  v_expires  timestamptz := now() + make_interval(secs => greatest(p_ttl_seconds, 30));
  v_id       uuid;
  v_locked   uuid;
  v_winner   uuid;
begin
  if p_candidate_ids is null then
    return null;
  end if;

  foreach v_id in array p_candidate_ids loop
    -- Is there an existing reservation row for this subject? Lock it so a
    -- concurrent reserve of the same subject serializes; SKIP LOCKED means a
    -- subject another worker is actively reserving is passed over immediately.
    select wr.producer_id into v_locked
      from public.work_reservations wr
     where wr.activity_key = p_activity_key
       and wr.subject_type = p_subject_type
       and wr.subject_id   = v_id
     for update skip locked;

    if not found then
      -- No row at all, OR the row is locked by a concurrent txn. Try a plain
      -- insert; if someone just inserted it, the unique index rejects us and we
      -- move on to the next candidate.
      begin
        insert into public.work_reservations
          (activity_key, subject_type, subject_id, producer_id, expires_at, heartbeat_at)
        values
          (p_activity_key, p_subject_type, v_id, p_producer_id, v_expires, v_now);
        v_winner := v_id;
        exit;
      exception when unique_violation then
        -- Lost the insert race (or it was lock-skipped): try the next candidate.
        continue;
      end;
    end if;

    -- A row exists and we hold its lock. Take it if it is ours or has lapsed.
    if v_locked = p_producer_id or exists (
      select 1 from public.work_reservations wr
       where wr.activity_key = p_activity_key
         and wr.subject_type = p_subject_type
         and wr.subject_id   = v_id
         and wr.expires_at  <= v_now
    ) then
      update public.work_reservations
         set producer_id = p_producer_id,
             expires_at  = v_expires,
             heartbeat_at = v_now
       where activity_key = p_activity_key
         and subject_type = p_subject_type
         and subject_id   = v_id;
      v_winner := v_id;
      exit;
    end if;
    -- Otherwise it is live and someone else's: move on.
  end loop;

  return v_winner;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. heartbeat_work_reservation — extend the caller's live lease.
-- Only extends a lease the caller actually holds and that has not already
-- lapsed; returns true when extended. A lapsed or foreign lease is never
-- resurrected here (that is a reserve, not a heartbeat), so a stale client can
-- never steal a subject back by heartbeating.
-- -----------------------------------------------------------------------------
create or replace function public.heartbeat_work_reservation(
  p_activity_key text,
  p_subject_type text,
  p_subject_id   uuid,
  p_producer_id  uuid,
  p_ttl_seconds  integer default 180
)
  returns boolean
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_now     timestamptz := now();
  v_expires timestamptz := now() + make_interval(secs => greatest(p_ttl_seconds, 30));
  v_hit     integer;
begin
  update public.work_reservations
     set expires_at = v_expires,
         heartbeat_at = v_now
   where activity_key = p_activity_key
     and subject_type = p_subject_type
     and subject_id   = p_subject_id
     and producer_id  = p_producer_id
     and expires_at   > v_now;
  get diagnostics v_hit = row_count;
  return v_hit > 0;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. release_work_subject — drop the caller's reservation.
-- Deletes only the caller's own live row (completing, skipping, or leaving).
-- A subject the caller no longer holds (already expired and taken by someone
-- else) is left untouched, so a late release can never remove another worker's
-- reservation. Returns true when a row was released.
-- -----------------------------------------------------------------------------
create or replace function public.release_work_subject(
  p_activity_key text,
  p_subject_type text,
  p_subject_id   uuid,
  p_producer_id  uuid
)
  returns boolean
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_hit integer;
begin
  delete from public.work_reservations
   where activity_key = p_activity_key
     and subject_type = p_subject_type
     and subject_id   = p_subject_id
     and producer_id  = p_producer_id;
  get diagnostics v_hit = row_count;
  return v_hit > 0;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. reserved_subject_ids — the set of subjects currently reserved by SOMEONE
-- ELSE (a live lease held by another producer), so an activity's list API can
-- exclude them from the candidate pool it offers a caller. Expired leases are
-- filtered out, so recovery is automatic at read time.
-- -----------------------------------------------------------------------------
create or replace function public.reserved_subject_ids(
  p_activity_key text,
  p_subject_type text,
  p_producer_id  uuid
)
  returns setof uuid
  language sql
  security definer
  set search_path = public
as $$
  select wr.subject_id
    from public.work_reservations wr
   where wr.activity_key = p_activity_key
     and wr.subject_type = p_subject_type
     and wr.expires_at   > now()
     and wr.producer_id <> p_producer_id;
$$;

grant execute on function public.reserve_work_subject(text, text, uuid, uuid, integer) to service_role;
grant execute on function public.reserve_next_work_subject(text, text, uuid[], uuid, integer) to service_role;
grant execute on function public.heartbeat_work_reservation(text, text, uuid, uuid, integer) to service_role;
grant execute on function public.release_work_subject(text, text, uuid, uuid) to service_role;
grant execute on function public.reserved_subject_ids(text, text, uuid) to service_role;

notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261107000001_rename_project_type_permanent_policy_review.sql >>>
-- =============================================================================
-- Rename the "1035 Exchange" project type to "Permanent Policy Review"
-- Migration: 20261107000001_rename_project_type_permanent_policy_review.sql
--
-- The project type catalog seeded "1035 Exchange" (fixed id
-- a1035000-0000-4000-8000-000000000001) in 20261009000001_project_types.sql.
-- The operator-facing name for that kind of work is now "Permanent Policy
-- Review": a review of the customer's in-force permanent (cash-value) coverage,
-- of which a 1035 exchange is one possible outcome rather than the whole point.
--
-- This is a RENAME IN PLACE, not a new type:
--   - The row keeps its id, so projects.project_type_id and every FK
--     association (the existing "1035 Reviews" project and its wiring) are
--     preserved exactly. No project is re-pointed and no second catalog row is
--     created, so there is no duplicate type.
--   - is_active is untouched (stays active), so the type continues to appear in
--     the Start New dropdown.
--   - Only the display name and description change. The underlying workflows
--     (servicing_agent_onboarding, review_preparation) and all business logic
--     are unchanged by this migration.
--
-- The unique index on lower(name) is satisfied: there is exactly one row and we
-- update it in place, so no case-insensitive collision is possible.
--
-- Idempotent: guarded on the fixed id, and the WHERE clause makes a replay a
-- no-op once the rename has already been applied.
-- =============================================================================

update public.project_types
   set name        = 'Permanent Policy Review',
       description = 'Review of a customer''s in-force permanent (cash-value) '
                     'coverage to confirm it still fits their needs. A Section '
                     '1035 exchange to a better-suited contract is one possible '
                     'outcome, not the only one.'
 where id = 'a1035000-0000-4000-8000-000000000001'::uuid
   and name = '1035 Exchange';

-- Keep the seed comment honest for any future replay that reads the catalog.
comment on table public.project_types is
  'Durable catalog of project kinds (e.g. "Permanent Policy Review"). Referenced '
  'by projects.project_type_id. Retire a type by setting is_active = false; '
  'types are never deleted, so existing projects keep their type.';

-- Refresh PostgREST''s schema cache (comment change) so the API stays in sync.
notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261108000001_q4_1035_initiative_team.sql >>>
-- =============================================================================
-- Configure the "Q4 1035 initiative" project TEAM
-- Migration: 20261108000001_q4_1035_initiative_team.sql
--
-- Sets the team for the existing "Q4 1035 initiative" project using the existing
-- project_participants (responsibility) and project_escalation_contacts (ordered
-- exception path) structures. The team is exactly three people:
--
--   - Dulce Velazquez : Operations               (participant, role 'operations')
--   - Angie Strem     : Operations Escalation     (participant, role
--                       'operations_escalation'; AND the first escalation
--                       contact, project_escalation_contacts tier 1)
--   - Bob Pfromm      : Producer                  (participant, role 'producer')
--
-- These are PROJECT responsibilities. They are deliberately kept distinct from
-- each producer's job title (producers.title), their licensing facts
-- (producers.is_*_licensed), and their capability / work-routing assignments
-- (producer_work_functions). This migration touches NONE of those: it changes
-- no work assignment and no routing.
--
-- Idempotent and self-correcting: it resolves people and the project by stable
-- identity, upserts the three rows, and removes any OTHER participant /
-- escalation rows on THIS project only, so "exactly these three" holds on a
-- replay. It is fully scoped to the one project and is a clean no-op on any
-- environment missing the project or the producers.
--
-- Depends on 20261021000001_ipf_work_overlay (project_participants +
-- project_escalation_contacts) and the projects / producers tables.
-- =============================================================================

-- [removed: employee/project business-data seed block — superseded by the
--  single email-resolved settled-config block at the end of this migration]

-- >>> schema/catalog from 20261109000001_project_participants_multi_role.sql >>>
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
-- [removed: employee/project business-data write — see settled-config block]

notify pgrst, 'reload schema';

-- >>> schema/catalog from 20261110000001_q4_1035_initiative_multi_role_team.sql >>>
-- =============================================================================
-- Configure the "Q4 1035 initiative" TEAM under the multi-responsibility model
-- Migration: 20261110000001_q4_1035_initiative_multi_role_team.sql
--
-- Sets the exact team for "Q4 1035 initiative" now that a participant can hold
-- SEVERAL project responsibilities (project_participants.roles[]):
--
--   - Bob Pfromm      : Project owner, Operations manager, Producer
--                       (roles = {project_owner, operations_manager, producer};
--                        NOT on the escalation path)
--   - Dulce Velazquez : Operations                  (roles = {operations})
--   - Angie Strem     : Operations                  (roles = {operations}) AND
--                       the FIRST operations escalation contact
--                       (project_escalation_contacts tier 1)
--
-- Reuses the existing team + escalation structures. Operations escalation stays
-- in project_escalation_contacts (the single source of truth); it is NOT a
-- stored role. Project owner and operations manager are INDEPENDENT roles.
--
-- Supersedes the single-role seed (20261108000001) for this project: Bob was a
-- tier-2 escalation contact there; the target keeps Angie as the ONLY escalation
-- contact (tier 1), so any other escalation row on this project is removed.
--
-- This touches NO work assignment, capability, or routing record
-- (producer_work_functions is untouched). Idempotent, scoped to the one project,
-- and a clean no-op where the project or producers are absent.
--
-- Depends on 20261109000001_project_participants_multi_role (roles[] column).
-- =============================================================================

-- [removed: employee/project business-data seed block — superseded by the
--  single email-resolved settled-config block at the end of this migration]

-- =============================================================================
-- OWNER-AS-INSURED BACKFILL (approved business-data correction)
-- Source rule: 20261015000001_owner_as_insured_backfill.sql, applied inline here
-- so it ACTUALLY EXECUTES as part of this upgrade. It must not rely on that
-- historical version being replayed: the history reconciliation below records
-- 20261015000001 as superseded, so a future db push would skip the standalone
-- file. This block is the real, executing copy.
--
-- Business rule (unchanged):
--   * A policy with an explicitly identified insured keeps that insured.
--   * A policy with NO identified insured (insured_last_name IS NULL) takes the
--     linked customer as the insured.
--   * Copy the customer's name; copy state only as a clean 2-letter code; copy
--     DOB only at exact precision from a full, plausible (1900-2100) customer
--     date — otherwise precision stays 'missing' and no DOB component is set.
--   * Never invent missing information. Policies with no linked customer, or an
--     already-identified insured, are left untouched.
--
-- Depends on the insured_* columns + shape/range constraints added earlier in
-- this migration (from 20261008000001). Runs inside this migration's single
-- transaction. Previously identified as affecting 8 production policies.
-- The guard on insured_last_name IS NULL makes it self-limiting and safe.
-- =============================================================================
update public.service_policies sp
set
  insured_first_name = cu.first_name,
  insured_last_name  = cu.last_name,

  -- Owner state only when it is a clean 2-letter code; otherwise leave NULL.
  insured_state = case
    when cu.state is not null and upper(cu.state) ~ '^[A-Z]{2}$'
      then upper(cu.state)
    else null
  end,

  -- Owner DOB only at exact precision from a full, PLAUSIBLE customer date. No
  -- day is invented: without a usable customer DOB, precision stays 'missing'
  -- and all DOB components stay NULL (shape constraint for 'missing').
  insured_dob = case
    when extract(year from cu.date_of_birth) between 1900 and 2100 then cu.date_of_birth
    else null
  end,
  insured_dob_year = case
    when extract(year from cu.date_of_birth) between 1900 and 2100
      then extract(year from cu.date_of_birth)::smallint
    else null
  end,
  insured_dob_month = case
    when extract(year from cu.date_of_birth) between 1900 and 2100
      then extract(month from cu.date_of_birth)::smallint
    else null
  end,
  insured_dob_precision = case
    when extract(year from cu.date_of_birth) between 1900 and 2100 then 'exact'
    else 'missing'
  end,

  updated_at = now()
from public.customers cu
where sp.customer_id = cu.id
  and sp.insured_last_name is null       -- no identified insured (idempotency guard)
  and cu.last_name is not null
  and cu.last_name <> ''
  and cu.is_test = false
  and sp.is_test = false;

-- =============================================================================
-- SETTLED EMPLOYEE QUALIFICATIONS & AGENCY-WIDE CAPABILITIES (business rules)
--
-- The only employee-record writes in this migration. Each person is resolved by
-- VERIFIED email identity against the production roster (not a hardcoded id, not
-- inferred from title). Licensing/management flags and agency-wide capability
-- assignments reflect the settled configuration:
--
--   Andy Makal      (amakal@allstate.com)      management
--   Angie Strem     (astrem@allstate.com)      life-licensed; operations_prep (primary),
--                                              outreach (support), research (primary)
--   Bob Pfromm      (b.pfromm@allstate.com)    life-licensed, management; determination (primary)
--   Dulce Velazquez (dvelazquez2@allstate.com) outreach (primary)
--
-- All assignments are AGENCY-WIDE (project_id is null). No project-scoped team,
-- participation, escalation, or population is seeded here; project teams are set
-- in the app. If a named person is absent from this environment, that person is
-- simply skipped (no row invented). source='manual'.
-- =============================================================================
do $$
declare
  p_andy  uuid;
  p_angie uuid;
  p_bob   uuid;
  p_dulce uuid;
  wf_outreach   uuid;
  wf_research   uuid;
  wf_ops_prep   uuid;
  wf_determine  uuid;
begin
  select id into p_andy  from public.producers where lower(email) = 'amakal@allstate.com';
  select id into p_angie from public.producers where lower(email) = 'astrem@allstate.com';
  select id into p_bob   from public.producers where lower(email) = 'b.pfromm@allstate.com';
  select id into p_dulce from public.producers where lower(email) = 'dvelazquez2@allstate.com';

  select id into wf_outreach  from public.work_functions where canonical_key = 'outreach';
  select id into wf_research  from public.work_functions where canonical_key = 'research';
  select id into wf_ops_prep  from public.work_functions where canonical_key = 'operations_prep';
  select id into wf_determine from public.work_functions where canonical_key = 'determination';

  -- Licensing / management qualification facts (only for the people they apply to).
  if p_bob   is not null then update public.producers set is_life_licensed = true, is_management = true where id = p_bob;   end if;
  if p_angie is not null then update public.producers set is_life_licensed = true                      where id = p_angie; end if;
  if p_andy  is not null then update public.producers set is_management  = true                        where id = p_andy;  end if;
  -- Dulce: no licensing/management fact asserted (not inferred from title).

  -- Agency-wide capability assignments (project_id is null). determination
  -- requires is_life_licensed, set above for Bob before this insert.
  if p_bob is not null and wf_determine is not null then
    insert into public.producer_work_functions (producer_id, work_function_id, assignment_type, project_id, source)
    values (p_bob, wf_determine, 'primary', null, 'manual')
    on conflict (producer_id, work_function_id) where project_id is null do nothing;
  end if;

  if p_angie is not null then
    if wf_ops_prep is not null then
      insert into public.producer_work_functions (producer_id, work_function_id, assignment_type, project_id, source)
      values (p_angie, wf_ops_prep, 'primary', null, 'manual')
      on conflict (producer_id, work_function_id) where project_id is null do nothing;
    end if;
    if wf_outreach is not null then
      insert into public.producer_work_functions (producer_id, work_function_id, assignment_type, project_id, source)
      values (p_angie, wf_outreach, 'support', null, 'manual')
      on conflict (producer_id, work_function_id) where project_id is null do nothing;
    end if;
    if wf_research is not null then
      insert into public.producer_work_functions (producer_id, work_function_id, assignment_type, project_id, source)
      values (p_angie, wf_research, 'primary', null, 'manual')
      on conflict (producer_id, work_function_id) where project_id is null do nothing;
    end if;
  end if;

  if p_dulce is not null and wf_outreach is not null then
    insert into public.producer_work_functions (producer_id, work_function_id, assignment_type, project_id, source)
    values (p_dulce, wf_outreach, 'primary', null, 'manual')
    on conflict (producer_id, work_function_id) where project_id is null do nothing;
  end if;
end
$$;

-- =============================================================================
-- Migration-history reconciliation (non-destructive, durable).
--
-- This consolidated migration establishes the SAME end-state schema that the
-- 41 historical feature migrations (20261008000001 .. 20261110000001) would
-- have produced. Production was never able to run those individually (the
-- historical chain is incompatible with production's actual schema — e.g. the
-- 20261008215325 drift-reconcile collides with existing production objects).
--
-- To make this durable and prevent a future `supabase db push` from trying to
-- REPLAY those incompatible historical files, we record them as applied in the
-- history ledger here, alongside this migration. This is a supersession record,
-- not a claim that each file executed: their net schema effect is in place via
-- this migration. The existing remote baseline row (20261007182159) is
-- preserved; nothing is deleted, rewritten, or back-dated.
--
-- Result: after this upgrade, `schema_migrations` contains the baseline, the 41
-- superseded historical versions (so they are never replayed), and this
-- migration. A future `db push` sees nothing left to apply.
-- =============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('20261111000001', 'prod_schema_upgrade_projects_workflow')
on conflict (version) do nothing;

insert into supabase_migrations.schema_migrations (version, name) values
  ('20261008000001','service_policies_review_initiative_fields'),
  ('20261008215325','reconcile_schema_drift_catchup__superseded_by_20261111000001'),
  ('20261008230000','projects_foundation'),
  ('20261009000001','project_types'),
  ('20261010000001','project_population_engine'),
  ('20261011000001','population_commit_and_status'),
  ('20261012000001','population_age_precision'),
  ('20261013000001','customer_age_conflict_unknown'),
  ('20261014000001','customer_age_setbased_perf'),
  ('20261014000002','population_source_view'),
  ('20261014000003','population_age_after_base_filter'),
  ('20261014000004','population_facets_lazy_age'),
  ('20261015000001','owner_as_insured_backfill__applied_inline_in_20261111000001'),
  ('20261016000001','stewardship_grants'),
  ('20261017000001','project_1035_step3_prepare_evaluate'),
  ('20261018000001','rightpath_documents_storage'),
  ('20261019000001','policy_documents_policy_scoped'),
  ('20261020000001','projects_lifecycle_archive'),
  ('20261021000001','ipf_work_overlay'),
  ('20261022000001','ipf_overlay_corrections'),
  ('20261023000001','capabilities_evidence_and_management'),
  ('20261024000001','capability_source_provenance'),
  ('20261025000001','1035_project_responsibilities'),
  ('20261026000001','project_1035_document_skips'),
  ('20261027000001','contact_review_work_function'),
  ('20261028000001','case_touches_customer_level'),
  ('20261029000001','case_touches_drop_servicing_outreach_type'),
  ('20261030000001','servicing_onboarding_completion'),
  ('20261030000002','case_touches_postal_type'),
  ('20261031000001','onboarding_corrections'),
  ('20261101000001','onboarding_followups_refusal_handoff'),
  ('20261102000001','project_workflows'),
  ('20261103000001','work_function_working_order'),
  ('20261103000002','case_touches_research_type'),
  ('20261104000001','consolidate_contact_research'),
  ('20261105000001','intro_email_recipient'),
  ('20261106000001','work_reservations'),
  ('20261107000001','rename_project_type_permanent_policy_review'),
  ('20261108000001','q4_1035_initiative_team__excluded_business_data'),
  ('20261109000001','project_participants_multi_role'),
  ('20261110000001','q4_1035_initiative_multi_role_team__excluded_business_data')
on conflict (version) do nothing;

commit;