-- =============================================================================
-- RPAS: Customer Notes FK Columns + Data Migration
-- Migration: 20260711000002_customer_notes_fk_columns.sql
--
-- Depends on: 20260711000001_customer_notes.sql (must be applied first)
--
-- Changes:
--   1. Add nullable FK columns to customer_notes for each workflow entity
--   2. Migrate existing notes text blobs into customer_notes entries
--      (attributed to Andy Makal as "Imported Note")
-- =============================================================================


-- =============================================================================
-- STEP 1: Add FK columns
-- All three are nullable — a note may be attached to just a customer
-- (posted from the Customer Card) or to a specific entity.
-- =============================================================================
alter table public.customer_notes
  add column case_id              uuid references public.cases(id)            on delete set null,
  add column service_request_id   uuid references public.service_requests(id) on delete set null,
  add column policy_review_id     uuid references public.policy_reviews(id)   on delete set null;


-- =============================================================================
-- STEP 2: Indexes for fast per-entity note lookups
-- =============================================================================
create index customer_notes_case_idx
  on public.customer_notes (case_id)
  where case_id is not null;

create index customer_notes_service_request_idx
  on public.customer_notes (service_request_id)
  where service_request_id is not null;

create index customer_notes_policy_review_idx
  on public.customer_notes (policy_review_id)
  where policy_review_id is not null;


-- =============================================================================
-- STEP 3: Migrate cases.notes
-- author_id = Andy Makal (1a153da7-...), seeded in migration 20260711000001
-- =============================================================================
insert into public.customer_notes
  (customer_id, case_id, section, author_id, author_name, body, created_at)
select
  c.customer_id,
  c.id,
  'producer',
  '1a153da7-a0f8-4742-82c1-8a0ed5969268',
  'Imported Note',
  c.notes,
  coalesce(c.updated_at, c.created_at)
from public.cases c
where c.notes is not null
  and trim(c.notes) <> ''
  and c.customer_id is not null
  and c.is_test = false;


-- =============================================================================
-- STEP 4: Migrate service_requests.notes
-- customer_id derived via service_requests.policy_id → service_policies.customer_id
-- =============================================================================
insert into public.customer_notes
  (customer_id, service_request_id, section, author_id, author_name, body, created_at)
select
  sp.customer_id,
  sr.id,
  'producer',
  '1a153da7-a0f8-4742-82c1-8a0ed5969268',
  'Imported Note',
  sr.notes,
  coalesce(sr.updated_at, sr.created_at)
from public.service_requests sr
join public.service_policies sp on sp.id = sr.policy_id
where sr.notes is not null
  and trim(sr.notes) <> ''
  and sp.customer_id is not null
  and sr.is_test = false;


-- =============================================================================
-- STEP 5: Migrate policy_reviews.prep_notes
-- customer_id derived via policy_reviews.policy_id → service_policies.customer_id
-- =============================================================================
insert into public.customer_notes
  (customer_id, policy_review_id, section, author_id, author_name, body, created_at)
select
  sp.customer_id,
  pr.id,
  'producer',
  '1a153da7-a0f8-4742-82c1-8a0ed5969268',
  'Imported Note',
  pr.prep_notes,
  coalesce(pr.updated_at, pr.created_at)
from public.policy_reviews pr
join public.service_policies sp on sp.id = pr.policy_id
where pr.prep_notes is not null
  and trim(pr.prep_notes) <> ''
  and sp.customer_id is not null
  and pr.is_test = false;
