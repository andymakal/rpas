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
