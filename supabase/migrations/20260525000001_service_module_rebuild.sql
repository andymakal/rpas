-- =============================================================================
-- Service Module Rebuild + Policy Reviews Schema
-- Migration: 20260525000001_service_module_rebuild.sql
--
-- Replaces the original service_requests and policy_reviews tables (which used
-- a customer/agency-centric FK design) with a simpler service_policies-centric
-- design that matches the actual service and review workflows.
--
-- New three-table model:
--   service_policies  — the legacy in-force policy record (central entity)
--   service_requests  — Abigail's service work on a policy (billing, bene, etc.)
--   policy_reviews    — Tyler/Lucas 5-minute proactive review calls
--
-- service_policies is the hub: both service_requests and policy_reviews hang off it.
-- This lets one policy accumulate multiple service events and review events over time
-- without duplicating data — consistent with the "data is additive" design rule.
-- =============================================================================


-- =============================================================================
-- STEP 1: Drop old tables
-- The original design required agency_id + customer_id NOT NULL on both tables,
-- which doesn't fit the service module (policies may come in before a customer
-- record exists).  CASCADE handles the FK from service_requests → policy_reviews.
-- =============================================================================
drop table if exists public.service_requests  cascade;
drop table if exists public.policy_reviews    cascade;


-- =============================================================================
-- STEP 2: service_policies
-- One row per legacy in-force policy.  Created when Abigail logs a service
-- request OR when the Consolidated Books CSV is imported in bulk.
-- =============================================================================
create table public.service_policies (
  id                    uuid primary key default gen_random_uuid(),

  -- core identifiers
  client_name           text not null,
  policy_number         text not null,
  carrier               text not null,
  product_type          text,          -- Term, UL, VUL, WL, PERM, FA, MVA …

  -- policy details
  issue_date            date,
  term_length           text,          -- e.g. "20 Year", "30 Year"
  face_amount           numeric(14,2),
  death_benefit_amount  numeric(14,2), -- Option 2 DB may exceed face_amount
  cash_value_amount     numeric(14,2),
  cash_value_as_of_date date,
  cost_basis            numeric(14,2),
  annual_premium        numeric(12,2),
  premium_mode          text,          -- Annual, Monthly, EFT Monthly …
  interest_rate         text,          -- credited rate for UL/WL

  -- underwriting
  rate_class            text,          -- Preferred Plus, Standard, Tobacco …
  riders                text,          -- free text, e.g. "WAIVER, CLTR"
  coverage_status       text not null default 'Active',

  -- people
  insured_first_name    text,
  insured_last_name     text,
  owner_phone           text,
  owner_dob_approx      text,          -- masked MM/xx/YYYY — no full DOB stored
  primary_beneficiary   text,
  writing_agent_name    text,

  -- servicing agent status (Everlake/LBL portal check)
  sa_status             text not null default 'unknown'
    check (sa_status in ('unknown', 'confirmed', 'not_on_file')),

  -- optional relationships
  agency_id             uuid references public.agencies(id)  on delete set null,
  agent_id              uuid references public.agents(id)    on delete set null,
  customer_id           uuid references public.customers(id) on delete set null,

  notes                 text,

  is_test               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.service_policies is
  'Legacy in-force policies brought into RPAS for service or review work. '
  'Central hub — service_requests and policy_reviews both reference this table. '
  'Populated via manual intake (Abigail) or bulk CSV import (Consolidated Books).';

comment on column public.service_policies.death_benefit_amount is
  'Current death benefit, which may exceed face_amount on Option 2 UL policies '
  'where cash value growth increases the total benefit.';

comment on column public.service_policies.owner_dob_approx is
  'Masked date of birth stored as MM/xx/YYYY — never store full DOB for PHI reasons.';

comment on column public.service_policies.writing_agent_name is
  'The original writing agent from the legacy Allstate/LBL book. '
  'Free text — this person is not necessarily in the agents table.';

create trigger service_policies_set_updated_at
  before update on public.service_policies
  for each row execute function public.set_updated_at();

create index if not exists service_policies_carrier_idx    on public.service_policies (carrier);
create index if not exists service_policies_agency_idx     on public.service_policies (agency_id) where agency_id is not null;
create index if not exists service_policies_rate_class_idx on public.service_policies (rate_class) where rate_class is not null;


-- =============================================================================
-- STEP 3: service_requests
-- Abigail's service work: billing issues, beneficiary changes, etc.
-- One policy may accumulate multiple requests over time.
-- =============================================================================
create table public.service_requests (
  id               uuid primary key default gen_random_uuid(),

  sr_number        text unique,         -- SR-YYYY-NNN (auto-assigned by API)
  policy_id        uuid not null references public.service_policies(id) on delete cascade,

  request_type     text not null,       -- Billing Issue, Beneficiary Change …
  workflow_status  text not null default 'open'
    check (workflow_status in (
      'open', 'sa_form_sent', 'form_sent_to_client',
      'form_sent_to_carrier', 'resolved', 'cannot_service'
    )),

  date_received    date not null default current_date,
  date_resolved    date,
  notes            text,

  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.service_requests is
  'Service requests logged against a service_policy. '
  'Abigail works these — billing, EFT, beneficiary, lapse, claims. '
  'sr_number auto-assigned as SR-YYYY-NNN by the API route.';

create trigger service_requests_set_updated_at
  before update on public.service_requests
  for each row execute function public.set_updated_at();

create index if not exists service_requests_policy_idx  on public.service_requests (policy_id);
create index if not exists service_requests_open_idx    on public.service_requests (workflow_status)
  where workflow_status not in ('resolved','cannot_service') and is_test = false;


-- =============================================================================
-- STEP 4: policy_reviews
-- Tyler / Lucas proactive 5-minute review calls.
-- Prep (10-15 min) happens on the detail screen before dialing.
-- Outcome is logged in ~30 sec after the call ends.
-- =============================================================================
create table public.policy_reviews (
  id                           uuid primary key default gen_random_uuid(),

  review_number                text unique,   -- RV-YYYY-NNN (auto-assigned by API)
  policy_id                    uuid not null references public.service_policies(id) on delete cascade,

  -- derived from service_policies.product_type — stored for fast filtering
  review_type                  text
    check (review_type in ('term', 'permanent_ul', 'permanent_wl')),

  assigned_to                  text,          -- 'Tyler', 'Lucas', etc.
  status                       text not null default 'prep'
    check (status in ('prep', 'complete', 'no_contact')),

  -- outcome — logged at the end of the call
  outcome                      text
    check (outcome in (
      'excellent', 'service_needed', 'opportunity_found',
      'no_contact', 'not_interested'
    )),

  -- tobacco reclassification section (cross-cutting on any policy type)
  tobacco_asked                boolean not null default false,
  still_using_tobacco          boolean,       -- null until asked
  tobacco_product              text,          -- e.g. 'Cigars only', 'None'

  -- beneficiary confirmed verbally on the call
  primary_beneficiary_confirmed text,

  -- completion timestamps
  call_completed_at            timestamptz,
  prep_notes                   text,

  -- post-call deliverable
  pdf_url                      text,

  -- if review led to new business, link the case
  resulting_case_id            uuid references public.cases(id) on delete set null,

  is_test                      boolean not null default false,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

comment on table public.policy_reviews is
  'Proactive 5-minute policy reviews conducted by producers (Tyler, Lucas). '
  'Detail page drives prep (call script + flags) and outcome logging. '
  'May result in: no change (excellent), a service request, or a new case.';

comment on column public.policy_reviews.review_type is
  'term | permanent_ul | permanent_wl — derived from service_policies.product_type '
  'and stored here so the queue can be filtered without a join.';

comment on column public.policy_reviews.tobacco_asked is
  'Was the client asked about current tobacco use on this call? '
  'Key metric for the tobacco reclassification summer campaign.';

create trigger policy_reviews_set_updated_at
  before update on public.policy_reviews
  for each row execute function public.set_updated_at();

create index if not exists policy_reviews_policy_idx       on public.policy_reviews (policy_id);
create index if not exists policy_reviews_assigned_idx     on public.policy_reviews (assigned_to) where assigned_to is not null;
create index if not exists policy_reviews_status_idx       on public.policy_reviews (status) where is_test = false;
create index if not exists policy_reviews_tobacco_idx      on public.policy_reviews (tobacco_asked) where is_test = false;
create index if not exists policy_reviews_resulting_case   on public.policy_reviews (resulting_case_id) where resulting_case_id is not null;


-- =============================================================================
-- STEP 5: Row Level Security
-- All three tables are admin-only writes.  Agency dashboard users get read-only
-- access to their own agency's records for transparency (they can see service
-- work is being done for their clients without being able to modify it).
-- =============================================================================
alter table public.service_policies  enable row level security;
alter table public.service_requests  enable row level security;
alter table public.policy_reviews    enable row level security;

-- service_policies: admin full access; agency users read their own
create policy service_policies_select
  on public.service_policies for select to authenticated
  using (
    public.jwt_is_admin()
    or (agency_id = public.jwt_agency_id() and is_test = false)
  );

create policy service_policies_all
  on public.service_policies for all to service_role
  using (true) with check (true);

-- service_requests: admin full access; agency users read via policy join
create policy service_requests_select
  on public.service_requests for select to authenticated
  using (
    public.jwt_is_admin()
    or exists (
      select 1 from public.service_policies sp
      where sp.id = policy_id
        and sp.agency_id = public.jwt_agency_id()
        and sp.is_test = false
    )
  );

create policy service_requests_all
  on public.service_requests for all to service_role
  using (true) with check (true);

-- policy_reviews: admin full access; agency users read via policy join
create policy policy_reviews_select
  on public.policy_reviews for select to authenticated
  using (
    public.jwt_is_admin()
    or exists (
      select 1 from public.service_policies sp
      where sp.id = policy_id
        and sp.agency_id = public.jwt_agency_id()
        and sp.is_test = false
    )
  );

create policy policy_reviews_all
  on public.policy_reviews for all to service_role
  using (true) with check (true);
