-- =============================================================================
-- RPAS Core Entity Tables — DDL
-- Migration: 20260516000001_core_entities_ddl.sql
--
-- Phase 2 of the RPAS schema. Depends on Phase 1 (20260515000001–3) being applied.
-- Creates: agencies, customers, agents, cases,
--          case_pending_requirements (junction), intake_raw.
--
-- Design principles carried forward from settings layer:
--   §4.2  internal_status is NEVER exposed to the agency — always translate via
--         stage_translations before rendering.
--   §2.2  tier is derived at query time from stage_translations, not stored here.
--   §4.3  GDC is computed at query time (annual_premium × product.gdc_multiplier).
--         Never store a computed GDC value on a case.
--   §4.5  is_test on every core entity; application MUST filter is_test = false
--         on all agency-facing views.
--
-- FK dependency order:
--   sml_teams          (Phase 1 — already exists)
--   agencies           ← sml_teams
--   customers          ← agencies
--   agents             ← agencies
--   cases              ← agencies, customers, agents, products, rate_classes,
--                         premium_modes, stage_translations, lost_reasons,
--                         snooze_reasons
--   case_pending_requirements ← cases, pending_requirements
--   intake_raw         ← agencies, cases
-- =============================================================================


-- =============================================================================
-- UPDATED_AT HELPER
-- Single reusable trigger function; each table gets its own trigger below.
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- =============================================================================
-- AGENCIES
-- The 87 Allstate P&C agency partners in the referral network.
--
-- slug:            URL-safe identifier used in dashboard routing
--                  (e.g., /dashboard/[slug]). Set once; treat as immutable
--                  once issued to the agency.
-- dashboard_token: Shared secret for agency dashboard authentication.
--                  Rotate via admin tool only — never expose in logs.
-- sml_team_id:     The SML producer responsible for this agency relationship.
--                  Nullable: allows onboarding before team assignment.
-- is_test:         Test agencies must never appear in production reporting.
-- =============================================================================
create table if not exists public.agencies (
  id               uuid    primary key default gen_random_uuid(),
  name             text    not null,
  slug             text    not null,
  dashboard_token  text    not null,
  sml_team_id      uuid    references public.sml_teams (id) on delete set null,
  is_active        boolean not null default true,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint agencies_slug_unique  unique (slug),
  constraint agencies_token_unique unique (dashboard_token)
);

comment on table public.agencies is
  '87 Allstate P&C agency partners in the referral network. '
  'slug is immutable once issued. dashboard_token must never appear in logs.';

comment on column public.agencies.slug is
  'URL-safe identifier for dashboard routing (/dashboard/[slug]). '
  'Treat as immutable once the agency has been given their link.';

comment on column public.agencies.dashboard_token is
  'Shared secret for agency dashboard access. Rotate via admin tool only.';

create index if not exists agencies_sml_team_id_idx on public.agencies (sml_team_id);
create index if not exists agencies_is_active_idx    on public.agencies (is_active) where is_active = true;


-- =============================================================================
-- CUSTOMERS
-- The insurance clients referred by agency partners to the SML financial
-- services team. One customer may have multiple cases over time.
--
-- date_of_birth:  Required for selecting the correct age-banded product
--                 row at application time (e.g., OptiBlend 7 FIA under 75
--                 vs. 75–79 band). Nullable: collect during intake if missing.
-- agency_id:      The referring P&C agency. A customer belongs to one agency.
-- =============================================================================
create table if not exists public.customers (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies (id),
  first_name     text not null,
  last_name      text not null,
  date_of_birth  date,
  email          text,
  phone          text,
  is_test        boolean not null default false,
  created_at     timestamptz not null default now()
);

comment on table public.customers is
  'Insurance clients referred by agency partners. '
  'date_of_birth is required for age-banded annuity product selection — '
  'collect at intake if not provided on the referral form.';

comment on column public.customers.date_of_birth is
  'Used to select the correct age-banded product row at application time. '
  'Age = floor(months between dob and application_date / 12).';

create index if not exists customers_agency_id_idx       on public.customers (agency_id);
create index if not exists customers_name_idx            on public.customers (agency_id, last_name, first_name);
create index if not exists customers_is_test_idx         on public.customers (is_test) where is_test = true;


-- =============================================================================
-- AGENTS
-- Individual Allstate P&C agents at each agency who initiate referrals.
-- Not to be confused with the SML Team (the financial services producer).
--
-- These are the people who fill in referral forms and whose agency_label
-- appears in the REFERRED BY column on the dashboard.
-- =============================================================================
create table if not exists public.agents (
  id          uuid    primary key default gen_random_uuid(),
  agency_id   uuid    not null references public.agencies (id),
  first_name  text    not null,
  last_name   text    not null,
  email       text,
  is_active   boolean not null default true,
  is_test     boolean not null default false,
  created_at  timestamptz not null default now()
);

comment on table public.agents is
  'Individual Allstate P&C agents who initiate referrals within each agency. '
  'Not the SML financial services producer (that is sml_teams).';

create index if not exists agents_agency_id_idx  on public.agents (agency_id);
create index if not exists agents_active_idx     on public.agents (agency_id, is_active) where is_active = true;


-- =============================================================================
-- STATUS_ENTERED_AT TRIGGER FUNCTION
-- Resets status_entered_at only when internal_status actually changes.
-- The stall clock = now() - status_entered_at, compared to
-- stage_translations.stale_threshold_days (Tier 1 only).
-- =============================================================================
create or replace function public.cases_track_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.internal_status <> old.internal_status then
    new.status_entered_at = now();
  end if;
  return new;
end;
$$;


-- =============================================================================
-- CASES
-- The central pipeline entity. A case tracks one insurance opportunity
-- for one customer from referral through placement (or loss/snooze).
--
-- Pipeline flow: Tier 1 (Potential) → Tier 2 (Commitment) → Tier 3 (Execution)
-- Tier is derived at query time: join to stage_translations on internal_status.
--
-- Column rendering by tier (IPF spec §2.2):
--   Tier 1: TOUCHES and LAST CONTACT render normally.
--   Tier 2: both columns render as em-dash (—).
--   Tier 3: both columns render as em-dash (—).
--   is_won / is_lost / is_snoozed: derived from stage_translations, not stored.
--
-- GDC computation (never stored):
--   gdc = annual_premium × products.gdc_multiplier
--   Performed at query time. product_id must be resolved to the age-banded row
--   that matches the customer's age at application date.
--
-- agency_id is denormalized here (also derivable via customer) for query
-- performance — every dashboard query is agency-scoped.
-- =============================================================================
create table if not exists public.cases (
  id                  uuid     primary key default gen_random_uuid(),

  -- ownership
  agency_id           uuid     not null references public.agencies (id),
  customer_id         uuid     not null references public.customers (id),
  agent_id            uuid     references public.agents (id) on delete set null,

  -- pipeline status
  -- FK into stage_translations.internal_status (text unique key).
  -- NEVER render this value on the agency dashboard — always look up agency_label.
  internal_status     text     not null
                               references public.stage_translations (internal_status),
  status_entered_at   timestamptz not null default now(),
  -- ^ Reset by trigger on status change. Used by stall clock (Tier 1 only):
  --   floor(extract(epoch from (now() - status_entered_at)) / 86400)
  --   > stage_translations.stale_threshold_days → render clock icon.

  -- Tier 1: appointment scheduling
  -- When set, application appends " for {date}" to "Working on appointment":
  -- "Working on appointment for Apr 30" (date only — spec §3.4 discrimination test).
  appointment_date    date,

  -- Tier 1: engagement tracking
  -- Em-dashed on Tier 2 and Tier 3 — application enforces, not a DB constraint.
  touches             smallint    not null default 0,
  last_contact_at     timestamptz,

  -- product / financial details (nullable until known at application stage)
  -- product_id must resolve to the age-banded row matching client age at application.
  product_id          uuid        references public.products (id) on delete set null,
  annual_premium      numeric(12, 2),   -- base for GDC calc; never store computed GDC
  face_amount         numeric(14, 2),   -- life insurance face amount
  rate_class_id       uuid        references public.rate_classes (id) on delete set null,
  premium_mode_id     uuid        references public.premium_modes (id) on delete set null,

  -- closed: lost
  -- Set lost_reason_id when is_lost = true (derived from stage_translations).
  -- agency_label from lost_reasons is shown in the Lost section LOST REASON column.
  lost_reason_id      uuid        references public.lost_reasons (id) on delete set null,

  -- closed: snoozed
  -- Set both fields when is_snoozed = true (derived from stage_translations).
  snooze_reason_id    uuid        references public.snooze_reasons (id) on delete set null,
  snooze_until        date,

  -- Tier 3 / Won: policy details
  policy_number       text,
  placed_at           timestamptz,

  -- metadata
  notes               text,        -- internal notes; never shown on agency dashboard
  is_test             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.cases is
  'Core pipeline entity. Tracks one insurance opportunity from referral to placement. '
  'Tier is derived via stage_translations — never hardcode tier logic in application. '
  'GDC is NEVER stored — compute as annual_premium × products.gdc_multiplier at query time. '
  'is_won, is_lost, is_snoozed are derived from stage_translations.internal_status — '
  'do not duplicate those booleans here.';

comment on column public.cases.internal_status is
  'FK into stage_translations.internal_status. '
  'NEVER render this value on the agency dashboard. Always look up agency_label.';

comment on column public.cases.status_entered_at is
  'Reset by trigger on every internal_status change. '
  'Stall clock (Tier 1 only): compare floor((now()-status_entered_at)/1 day) '
  'to stage_translations.stale_threshold_days.';

comment on column public.cases.appointment_date is
  'Tier 1 only. When set, append " for {date}" to the Working on appointment label. '
  'Show date only — never time (spec §3.4 discrimination test).';

comment on column public.cases.touches is
  'Count of customer contacts made by SML team. Em-dashed on Tier 2+.';

comment on column public.cases.annual_premium is
  'Raw annual premium used to compute GDC at query time. '
  'GDC = annual_premium × products.gdc_multiplier. Never store the result.';

comment on column public.cases.product_id is
  'Must resolve to the age-banded products row matching customer age at application. '
  'Use customers.date_of_birth and the application date to determine the correct band.';

-- Trigger: maintain updated_at
create trigger cases_set_updated_at
  before update on public.cases
  for each row execute function public.set_updated_at();

-- Trigger: reset status_entered_at on status change (stall clock)
create trigger cases_track_status_change
  before update on public.cases
  for each row execute function public.cases_track_status_change();

-- Indexes: dashboard query patterns
-- Primary access pattern: all active/snoozed/lost cases for an agency (filtered by is_test)
create index if not exists cases_agency_status_idx
  on public.cases (agency_id, internal_status)
  where is_test = false;

-- Customer lookup (case history for a client)
create index if not exists cases_customer_id_idx
  on public.cases (customer_id);

-- Agent referral attribution
create index if not exists cases_agent_id_idx
  on public.cases (agent_id)
  where agent_id is not null;

-- Snoozed cases coming due (background job or dashboard snooze section)
create index if not exists cases_snooze_until_idx
  on public.cases (snooze_until)
  where snooze_until is not null;

-- Test data isolation
create index if not exists cases_is_test_idx
  on public.cases (is_test) where is_test = true;


-- =============================================================================
-- CASE PENDING REQUIREMENTS
-- Junction table: one case may have multiple underwriting checklist items
-- blocking it in Tier 2 (Commitment). Items are individually resolvable.
--
-- Rendering: shown as a checklist in the Pending Requirements column.
-- An item with resolved_at set is struck through (or hidden, per spec).
-- =============================================================================
create table if not exists public.case_pending_requirements (
  id                     uuid primary key default gen_random_uuid(),
  case_id                uuid not null references public.cases (id) on delete cascade,
  pending_requirement_id uuid not null references public.pending_requirements (id),
  resolved_at            timestamptz,   -- null = still blocking; set when cleared
  created_at             timestamptz not null default now(),
  constraint case_pending_req_unique unique (case_id, pending_requirement_id)
);

comment on table public.case_pending_requirements is
  'Underwriting checklist items blocking a Tier 2 case. '
  'resolved_at null means the item is still open. '
  'Cascade-deletes when the parent case is deleted.';

create index if not exists case_pending_req_case_id_idx
  on public.case_pending_requirements (case_id);

create index if not exists case_pending_req_unresolved_idx
  on public.case_pending_requirements (case_id)
  where resolved_at is null;


-- =============================================================================
-- INTAKE_RAW
-- Raw referral submissions before normalization into customers + cases.
-- Captures the form payload exactly as received.
--
-- source:       Origin of the intake record.
--               'form'         — agency referral form submission
--               'csv_import'   — batch import from Sheets or CSV upload
--               'sheets_sync'  — automated sync from Google Sheets system
-- raw_data:     Full payload as JSONB. Schema varies by source and form version.
--               Expected fields (not enforced here): first_name, last_name,
--               phone, email, date_of_birth, product_interest, referring_agent,
--               notes.
-- case_id:      Set when the intake record has been reviewed and converted into
--               a proper case. Null = unprocessed (pending review queue).
-- processed_at: Timestamp of processing. Null = not yet processed.
--               An intake record with processed_at set but case_id null
--               indicates a record that was reviewed and intentionally discarded.
-- =============================================================================
create table if not exists public.intake_raw (
  id            uuid    primary key default gen_random_uuid(),
  agency_id     uuid    references public.agencies (id) on delete set null,
  source        text    not null default 'form'
                        check (source in ('form', 'csv_import', 'sheets_sync')),
  raw_data      jsonb   not null,
  case_id       uuid    references public.cases (id) on delete set null,
  processed_at  timestamptz,
  is_test       boolean not null default false,
  created_at    timestamptz not null default now()
);

comment on table public.intake_raw is
  'Raw referral submissions before normalization. '
  'case_id null = unprocessed (in review queue). '
  'processed_at set + case_id null = reviewed and intentionally discarded. '
  'raw_data schema varies by source — do not rely on field presence without null-checking.';

comment on column public.intake_raw.raw_data is
  'Full form payload as submitted. Expected keys (not required): '
  'first_name, last_name, phone, email, date_of_birth, product_interest, '
  'referring_agent, notes. Key set varies by form version and source system.';

-- Unprocessed queue: the most common intake dashboard query
create index if not exists intake_raw_unprocessed_idx
  on public.intake_raw (agency_id, created_at desc)
  where processed_at is null and is_test = false;

-- Lookup by linked case (traceability)
create index if not exists intake_raw_case_id_idx
  on public.intake_raw (case_id)
  where case_id is not null;

-- GIN index for raw_data querying (search by submitted field values)
create index if not exists intake_raw_data_gin_idx
  on public.intake_raw using gin (raw_data);
