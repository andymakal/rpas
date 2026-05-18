-- =============================================================================
-- Service Requests and Policy Reviews — DDL + RLS
-- Migration: 20260517000002_service_requests_and_policy_reviews.sql
--
-- Depends on:
--   20260515000001  (settings DDL — lookup tables)
--   20260515000002  (settings seed — service_request_types, request_statuses,
--                    review_statuses, opportunity_types, health_change_types)
--   20260516000001  (core entities DDL — agencies, customers, cases)
--   20260516000002  (RLS helpers — jwt_agency_id(), jwt_is_admin())
--
-- Context — legacy carrier policies:
--   Old Allstate life policies were issued under Allstate Life Insurance Company
--   or Allstate Assurance Company. Those books are now held by:
--     Everlake Life Insurance Company   (fka Allstate Life Insurance Company)
--     Everlake Assurance Company        (fka Allstate Assurance Company)
--     Lincoln Benefit Life Company      (unchanged — not rebranded to Lincoln Financial)
--   These will be selected via carrier_id on both tables.
--   Lincoln Financial is the current new-business carrier; Lincoln Benefit Life
--   is the legacy carrier for in-force policy servicing only.
--
-- Design notes:
--   - Both tables are admin-only (SML team). Agency dashboard users have no
--     direct access — this is internal servicing work.
--   - agency_id is denormalized on both tables for consistent query performance
--     (matches the pattern on cases).
--   - existing_product_name is free text because legacy Allstate Life products
--     predate the products catalog and may not have a matching row.
--   - service_requests.policy_review_id links to the review that spawned the
--     request (nullable — requests can be opened independently of a review).
--   - policy_reviews.resulting_case_id links to a new case if the review led
--     to new business (nullable — most reviews do not result in new cases).
-- =============================================================================


-- =============================================================================
-- SERVICE REQUESTS
-- Tracks formal requests submitted to a carrier on behalf of an existing client.
-- Examples: beneficiary changes, EFT updates, policy loans, surrenders.
--
-- Workflow:
--   New → Form Sent to Client → Form Sent to Carrier
--       → Pending Client Response | Awaiting Carrier
--       → Resolved | Converted to Review
-- =============================================================================
create table if not exists public.service_requests (
  id                  uuid primary key default gen_random_uuid(),

  -- ownership (denormalized for query performance)
  agency_id           uuid        not null references public.agencies  (id),
  customer_id         uuid        not null references public.customers (id),

  -- the existing policy being serviced
  carrier_id          uuid        references public.carriers              (id) on delete set null,
  policy_number       text,
  existing_product_name text,     -- free text — legacy products may not be in our catalog

  -- request details
  request_type_id     uuid        references public.service_request_types (id) on delete set null,
  status_id           uuid        references public.request_statuses       (id) on delete set null,

  -- traceability — set when this request was opened as a result of a policy review
  policy_review_id    uuid        references public.policy_reviews         (id) on delete set null,

  -- resolution
  resolved_at         timestamptz,
  notes               text,

  is_test             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.service_requests is
  'Formal requests to carriers on behalf of existing policyholders. '
  'Admin (SML team) only — agencies do not see this table. '
  'carrier_id covers legacy carriers: Everlake Life, Everlake Assurance, Lincoln Benefit Life, etc.';

comment on column public.service_requests.carrier_id is
  'The carrier currently holding the existing policy. '
  'For legacy Allstate Life books: use Everlake Life Insurance Company or '
  'Everlake Assurance Company. Lincoln Benefit Life Company is unchanged.';

comment on column public.service_requests.existing_product_name is
  'Free-text product name for legacy policies not in the products catalog. '
  'If the product IS in our catalog, leave null and rely on carrier + policy_number.';

comment on column public.service_requests.policy_review_id is
  'Set when this request was generated from a policy review '
  '(review_status = ''Complete — Service Request'').';

create trigger service_requests_set_updated_at
  before update on public.service_requests
  for each row execute function public.set_updated_at();

create index if not exists service_requests_agency_idx
  on public.service_requests (agency_id)
  where is_test = false;

create index if not exists service_requests_customer_idx
  on public.service_requests (customer_id);

create index if not exists service_requests_open_idx
  on public.service_requests (agency_id, created_at desc)
  where resolved_at is null and is_test = false;

create index if not exists service_requests_review_idx
  on public.service_requests (policy_review_id)
  where policy_review_id is not null;


-- =============================================================================
-- POLICY REVIEWS
-- Annual (or event-triggered) reviews of an existing client's in-force policy.
-- Identifies health changes, conversion opportunities, rate improvements, etc.
--
-- Workflow:
--   Scheduled → In Progress → Complete — No Changes
--                           | Complete — Service Request (→ opens service_request)
--                           | Quoted — Follow Up
--                           | New Policy — Additional / Replacement  (→ opens case)
--                           | Completed — Opportunity Identified
--                           | Client Declined
-- =============================================================================
create table if not exists public.policy_reviews (
  id                    uuid primary key default gen_random_uuid(),

  -- ownership (denormalized for query performance)
  agency_id             uuid        not null references public.agencies  (id),
  customer_id           uuid        not null references public.customers (id),

  -- the existing policy being reviewed
  carrier_id            uuid        references public.carriers           (id) on delete set null,
  policy_number         text,
  existing_product_name text,       -- free text — legacy products may not be in our catalog
  annual_premium        numeric(12, 2),
  face_amount           numeric(14, 2),

  -- review outcomes
  review_status_id      uuid        references public.review_statuses    (id) on delete set null,
  health_change_type_id uuid        references public.health_change_types (id) on delete set null,
  opportunity_type_id   uuid        references public.opportunity_types   (id) on delete set null,

  -- if the review led to new business, link the resulting case
  resulting_case_id     uuid        references public.cases              (id) on delete set null,

  -- review completion
  reviewed_at           timestamptz,
  notes                 text,

  is_test               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.policy_reviews is
  'Annual or event-triggered reviews of existing client policies. '
  'Admin (SML team) only — agencies do not see this table directly. '
  'Identifies health changes, conversion or replacement opportunities. '
  'A review may generate a service_request (via service_requests.policy_review_id) '
  'or new business (via resulting_case_id).';

comment on column public.policy_reviews.carrier_id is
  'The carrier currently holding the in-force policy. '
  'For legacy Allstate Life books: Everlake Life Insurance Company or '
  'Everlake Assurance Company. Lincoln Benefit Life Company is unchanged.';

comment on column public.policy_reviews.existing_product_name is
  'Free-text product name for legacy policies not in the products catalog.';

comment on column public.policy_reviews.resulting_case_id is
  'Set when this review directly led to new business. '
  'Links to the new case opened for the additional or replacement policy.';

create trigger policy_reviews_set_updated_at
  before update on public.policy_reviews
  for each row execute function public.set_updated_at();

create index if not exists policy_reviews_agency_idx
  on public.policy_reviews (agency_id)
  where is_test = false;

create index if not exists policy_reviews_customer_idx
  on public.policy_reviews (customer_id);

create index if not exists policy_reviews_open_idx
  on public.policy_reviews (agency_id, created_at desc)
  where reviewed_at is null and is_test = false;

create index if not exists policy_reviews_resulting_case_idx
  on public.policy_reviews (resulting_case_id)
  where resulting_case_id is not null;


-- =============================================================================
-- ROW LEVEL SECURITY
-- Agency users get read-only SELECT on their own agency's records.
-- This drives a transparency panel on the agency dashboard so agencies can
-- see that service requests and policy reviews are being worked on for their
-- clients, without being able to create or edit them.
-- All writes go through service_role (server-side API routes).
-- =============================================================================
alter table public.service_requests enable row level security;
alter table public.policy_reviews   enable row level security;

create policy service_requests_select
  on public.service_requests
  for select
  to authenticated
  using (
    public.jwt_is_admin()
    or (
      agency_id = public.jwt_agency_id()
      and is_test = false
    )
  );

create policy policy_reviews_select
  on public.policy_reviews
  for select
  to authenticated
  using (
    public.jwt_is_admin()
    or (
      agency_id = public.jwt_agency_id()
      and is_test = false
    )
  );


-- =============================================================================
-- FORWARD REFERENCE NOTE
-- service_requests.policy_review_id references policy_reviews.id.
-- Because policy_reviews is created first in this file, the FK is valid.
-- If you ever split these into separate migrations, policy_reviews must run first.
-- =============================================================================
