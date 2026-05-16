-- =============================================================================
-- RPAS Settings Layer — Catalog & Lookup Table Definitions
-- Migration: 20260515000001_settings_ddl.sql
--
-- Phase 1 of 2 for the settings layer.
-- Phase 2 (20260515000002) seeds all lookup data.
-- Core entity tables (agencies, cases, customers, agents, intake_raw)
-- are Phase 2 migrations — do not add them here.
--
-- Design principles (Bob Pfromm IPF spec):
--   §4.2  Translation layer: internal codes → agency-readable active-voice labels
--   §2.2  Three-tier doctrine: tier drives which columns show vs. em-dash
--   §4.3  Computed values (GDC) are never stored — multipliers live here
--   §4.5  is_test filtering is a core entity concern, not a catalog concern
-- =============================================================================

-- =============================================================================
-- CARRIERS
-- The issuing insurance or financial company.
-- carrier_id on products is nullable: confirm before populating.
-- =============================================================================
create table if not exists public.carriers (
  id          uuid    primary key default gen_random_uuid(),
  name        text    not null,
  short_name  text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint carriers_name_unique unique (name)
);

comment on table public.carriers is
  'Issuing insurance and financial product carriers. '
  'Linked to products; nullable FK on products — only populate when confirmed.';

-- =============================================================================
-- PRODUCT TYPES
-- High-level classification used in the Won section PRODUCT column.
-- =============================================================================
create table if not exists public.product_types (
  id          uuid     primary key default gen_random_uuid(),
  name        text     not null,
  sort_order  smallint not null default 0,
  constraint product_types_name_unique unique (name)
);

-- =============================================================================
-- PRODUCTS
-- Full product catalog with GDC multipliers.
-- gdc_multiplier × annual_premium = raw GDC (computed at query time, never stored).
-- Age-banded products (annuities) share a base name; min_age/max_age differentiate them.
-- Life products embed age info in the name (e.g. "Full Pay Under 65") — use null bands.
-- =============================================================================
create table if not exists public.products (
  id              uuid         primary key default gen_random_uuid(),
  name            text         not null,
  carrier_id      uuid         references public.carriers (id) on delete set null,
  product_type_id uuid         references public.product_types (id) on delete set null,
  gdc_multiplier  numeric(8,4) not null,
  min_age         smallint,    -- null = no lower bound (life products, or unaged annuities)
  max_age         smallint,    -- null = no upper bound
  is_active       boolean      not null default true,
  notes           text,        -- internal notes; never shown to agency
  created_at      timestamptz  not null default now()
);

-- Unique constraint: use -1 sentinel for null so age-banded products
-- with the same base name are properly deduped.
create unique index if not exists products_name_age_unique
  on public.products (name, coalesce(min_age, -1), coalesce(max_age, -1));

comment on table public.products is
  'Product catalog with GDC multipliers. '
  'NEVER store computed GDC here — derive it at query time: gdc_multiplier × annual_premium. '
  'carrier_id is nullable; confirm before populating to avoid storing guesses. '
  'Age-banded annuity products share a name; life products encode age in the name.';

comment on column public.products.gdc_multiplier is
  'Raw GDC multiplier applied to annual premium. '
  'annuities use decimal fractions (e.g., 0.055 = 5.5%); '
  'life products use whole-number-ish values (e.g., 1.41 = 141% of annual premium — '
  'this is the Allstate Financial Services GDC schedule).';

-- =============================================================================
-- RATE CLASSES
-- Underwriting classification; stored on cases for field reference.
-- =============================================================================
create table if not exists public.rate_classes (
  id          uuid     primary key default gen_random_uuid(),
  name        text     not null,
  sort_order  smallint not null default 0,
  constraint rate_classes_name_unique unique (name)
);

-- =============================================================================
-- PREMIUM MODES
-- Payment frequency; stored on cases.
-- =============================================================================
create table if not exists public.premium_modes (
  id          uuid     primary key default gen_random_uuid(),
  name        text     not null,
  sort_order  smallint not null default 0,
  constraint premium_modes_name_unique unique (name)
);

-- =============================================================================
-- STAGE TRANSLATIONS  (IPF spec §4.2 — the critical translation layer)
--
-- Maps every internal case status value to an agency-readable active-voice label.
-- Rules that must never be violated:
--   1. internal_status is NEVER exposed to the agency at any point.
--   2. agency_label is ALWAYS active voice. ("Working on..." not "Awaiting...")
--   3. This catalog is GLOBAL — never per-agency, never per-tenant.
--   4. Fallback chain in application code: exact match → stage default → log warning.
--   5. tier gates column rendering: Tier 1 shows TOUCHES + LAST CONTACT;
--      Tier 2+ renders those columns as em-dash (—).
--   6. stale_threshold_days is Tier 1 only. NULL on Tier 2+ is enforced by check.
--
-- The one_state check ensures a status is at most one of: active, won, lost, snoozed.
-- =============================================================================
create table if not exists public.stage_translations (
  id                   uuid     primary key default gen_random_uuid(),
  internal_status      text     not null,
  agency_label         text     not null,
  tier                 smallint not null,
  stage_order          smallint not null,  -- higher = further along = sorts first on dashboard
  stale_threshold_days smallint,           -- Tier 1 only: days until stall clock icon fires
  is_active_case       boolean  not null default true,
  is_won               boolean  not null default false,
  is_lost              boolean  not null default false,
  is_snoozed           boolean  not null default false,
  created_at           timestamptz not null default now(),
  constraint stage_translations_status_unique unique (internal_status),
  constraint stage_tier_valid check (tier between 1 and 3),
  constraint stage_stale_tier1_only check (
    stale_threshold_days is null or tier = 1
  ),
  constraint stage_one_closed_state check (
    (is_won::int + is_lost::int + is_snoozed::int) <= 1
  )
);

comment on table public.stage_translations is
  'Agency-readable active-voice labels for every internal case status. '
  'Source: Bob Pfromm IPF spec §4.2. '
  'NEVER expose internal_status to the agency. '
  'NEVER add per-agency or per-tenant overrides — uniform language is a feature.';

comment on column public.stage_translations.tier is
  '1 = Potential (pre-application): show TOUCHES and LAST CONTACT. '
  '2 = Commitment (app sent → signature): em-dash on TOUCHES and LAST CONTACT. '
  '3 = Execution (carrier hands): em-dash on both; stall icon meaningless here.';

comment on column public.stage_translations.stale_threshold_days is
  'Tier 1 only. Days at current stage before the stall clock icon renders. '
  'Must be NULL on Tier 2 and Tier 3 stages (enforced by constraint).';

-- =============================================================================
-- LOST REASONS
-- Why a case was closed without placement.
-- agency_label is shown in the LOST REASON column on the Lost section.
-- =============================================================================
create table if not exists public.lost_reasons (
  id            uuid     primary key default gen_random_uuid(),
  internal_code text     not null,
  agency_label  text     not null,
  sort_order    smallint not null default 0,
  constraint lost_reasons_code_unique unique (internal_code)
);

comment on table public.lost_reasons is
  'Agency-readable labels for case loss reasons. '
  'internal_code is stored on the case; agency_label is rendered on the dashboard Lost section.';

-- =============================================================================
-- SNOOZE REASONS
-- Why a case is temporarily inactive.
-- agency_label shown in SNOOZE REASON column on the Snoozed section.
-- =============================================================================
create table if not exists public.snooze_reasons (
  id            uuid     primary key default gen_random_uuid(),
  internal_code text     not null,
  agency_label  text     not null,
  sort_order    smallint not null default 0,
  constraint snooze_reasons_code_unique unique (internal_code)
);

-- =============================================================================
-- SERVICE REQUEST TYPES
-- Category of a policy service request.
-- =============================================================================
create table if not exists public.service_request_types (
  id          uuid     primary key default gen_random_uuid(),
  name        text     not null,
  sort_order  smallint not null default 0,
  constraint service_request_types_name_unique unique (name)
);

-- =============================================================================
-- REQUEST STATUSES
-- Workflow status on an open service request.
-- =============================================================================
create table if not exists public.request_statuses (
  id          uuid     primary key default gen_random_uuid(),
  name        text     not null,
  sort_order  smallint not null default 0,
  constraint request_statuses_name_unique unique (name)
);

-- =============================================================================
-- PENDING REQUIREMENTS
-- Underwriting checklist items blocking a case in Tier 2.
-- =============================================================================
create table if not exists public.pending_requirements (
  id          uuid     primary key default gen_random_uuid(),
  name        text     not null,
  sort_order  smallint not null default 0,
  constraint pending_requirements_name_unique unique (name)
);

-- =============================================================================
-- OPPORTUNITY TYPES
-- Classification of the financial opportunity identified during a review.
-- =============================================================================
create table if not exists public.opportunity_types (
  id          uuid     primary key default gen_random_uuid(),
  name        text     not null,
  sort_order  smallint not null default 0,
  constraint opportunity_types_name_unique unique (name)
);

-- =============================================================================
-- REVIEW STATUSES
-- Current status of a scheduled or completed annual review.
-- =============================================================================
create table if not exists public.review_statuses (
  id          uuid     primary key default gen_random_uuid(),
  name        text     not null,
  sort_order  smallint not null default 0,
  constraint review_statuses_name_unique unique (name)
);

-- =============================================================================
-- HEALTH CHANGE TYPES
-- Classification of health changes discovered during a review.
-- =============================================================================
create table if not exists public.health_change_types (
  id          uuid     primary key default gen_random_uuid(),
  name        text     not null,
  sort_order  smallint not null default 0,
  constraint health_change_types_name_unique unique (name)
);

-- =============================================================================
-- SML TEAMS
-- The producers (SML reps) who manage individual agency relationships.
-- "SML Team" is the column name from the existing Sheets system.
-- These are internal-only — agency dashboard never references this table.
-- =============================================================================
create table if not exists public.sml_teams (
  id            uuid    primary key default gen_random_uuid(),
  code          text    not null,       -- SHOKALOOK, COLLINS, LANGDALE, etc.
  display_name  text    not null,       -- Human-readable: "Bob Shokalook"
  region        text,                   -- PA, NJ, VA, RI, AL, CT, NH — for geo-coded teams
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint sml_teams_code_unique unique (code)
);

comment on table public.sml_teams is
  'Producers (SML representatives) responsible for each agency partnership. '
  'Internal only — never exposed on the agency-facing dashboard. '
  'Each agency is assigned one sml_team_id in the agencies table.';
