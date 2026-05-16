-- =============================================================================
-- RPAS: GDC Records, Lead Source, Partner Numbers
-- Migration: 20260516000005_gdc_and_lead_source.sql
--
-- Changes:
--   1. cases.agency_id   → nullable (Allstate.com leads start unassigned)
--   2. customers.agency_id → nullable (same reason)
--   3. cases.lead_source  → new column: agency_referral | allstate_web | self_generated
--   4. agencies.allstate_partner_number → new column (matches Primary Partner Number
--      in Allstate compensation report, always begins with "A0")
--   5. import_batches     → tracks each weekly import run
--   6. gdc_records        → actual Production Credit rows from Allstate comp report
-- =============================================================================


-- =============================================================================
-- 1. MAKE agency_id NULLABLE ON CASES AND CUSTOMERS
-- Allstate.com leads have no partner agency at intake; assigned later when
-- the application appears on the Pending Report.
-- RLS is unaffected: null agency_id never satisfies agency_id = jwt_agency_id().
-- =============================================================================
alter table public.cases     alter column agency_id drop not null;
alter table public.customers alter column agency_id drop not null;


-- =============================================================================
-- 2. LEAD SOURCE ON CASES
-- agency_referral  : submitted by an LSP at a partner P&C agency
-- allstate_web     : came through Allstate.com; agency assigned at app-submitted stage
-- self_generated   : Makal-sourced, no partner agency
-- =============================================================================
alter table public.cases
  add column lead_source text not null default 'agency_referral'
  constraint cases_lead_source_valid
    check (lead_source in ('agency_referral', 'allstate_web', 'self_generated'));


-- =============================================================================
-- 3. ALLSTATE PARTNER NUMBER ON AGENCIES
-- The "Primary Partner Number" from the Allstate compensation report.
-- Always begins with "A0". Unique per agency. Nullable until populated.
-- Used to match compensation report rows to agency records during GDC import.
-- =============================================================================
alter table public.agencies
  add column allstate_partner_number text unique;


-- =============================================================================
-- 4. IMPORT BATCHES
-- One row per import run. Tracks file name, type, match counts.
-- Lets us audit what was imported and roll back by batch if needed.
-- =============================================================================
create table public.import_batches (
  id             uuid        primary key default gen_random_uuid(),
  import_type    text        not null
                   constraint import_batches_type_valid
                   check (import_type in ('compensation', 'lead_manager', 'allstate_web')),
  filename       text,
  row_count      int,
  matched_count  int,
  unmatched_count int,
  notes          text,
  imported_at    timestamptz not null default now()
);

alter table public.import_batches enable row level security;

create policy import_batches_admin_only
  on public.import_batches
  for select to authenticated
  using (public.jwt_is_admin());


-- =============================================================================
-- 5. GDC RECORDS
-- One row per line from the Allstate "AF NB Policy Details" sheet.
-- production_credit = Allstate's term for GDC; can be negative (chargebacks).
-- raw_row stores the full source row for auditability.
-- agency_id is nullable: unmatched rows are stored for manual review.
-- =============================================================================
create table public.gdc_records (
  id                     uuid         primary key default gen_random_uuid(),
  import_batch_id        uuid         not null references public.import_batches(id) on delete cascade,
  agency_id              uuid         references public.agencies(id) on delete set null,

  -- Fields from Allstate compensation report
  policy_number          text,
  insured_name           text,
  product                text,
  production_credit      numeric(12, 2) not null,   -- GDC; negative = chargeback
  app_date               date,
  process_date           date,
  transaction_description text,                      -- PAYMENT, PAYMENT REV, etc.
  split_pct              text,                       -- SHR or percentage
  allstate_partner_number text,                      -- Primary Partner Number from report

  -- Full source row for audit / re-processing
  raw_row                jsonb        not null,

  created_at             timestamptz  not null default now()
);

create index gdc_records_agency_id_idx       on public.gdc_records (agency_id);
create index gdc_records_batch_idx           on public.gdc_records (import_batch_id);
create index gdc_records_policy_number_idx   on public.gdc_records (policy_number);
create index gdc_records_partner_number_idx  on public.gdc_records (allstate_partner_number);

alter table public.gdc_records enable row level security;

-- Portal reads GDC via service_role (admin client), so agencies don't need
-- direct SELECT access. Admin users can query for internal reporting.
create policy gdc_records_admin_only
  on public.gdc_records
  for select to authenticated
  using (public.jwt_is_admin());
