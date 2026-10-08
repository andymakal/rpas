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
