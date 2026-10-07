-- =============================================================================
-- Reconcile live-but-undocumented drift on policy_reviews and service_requests
-- Migration: 20260927000001_reconcile_policy_reviews_drift.sql
--
-- The live database has columns on public.policy_reviews and
-- public.service_requests that were added out-of-band and are not produced by
-- the committed migration chain. The stewardship / producer pre-review feature
-- and the surrounding review surfaces read these columns, so the committed
-- schema must match live before new objects are built on top of it.
--
-- This migration is additive and idempotent (add column if not exists). It
-- matches the verified live column types, nullability, FK, and defaults exactly,
-- so it is a no-op in production (where these columns already exist) and
-- reproduces the real shape on a clean replay.
--
-- Scope: ONLY the drift that current code required by the pre-review / Review
-- flow depends on:
--   * policy_reviews: the eight pre-computed/scheduling/customer columns the
--     review detail + print surfaces and the pre-review link rely on.
--   * service_requests.customer_id: inserted and filtered on by
--     src/app/api/service-requests/route.ts and read by the Review flow's
--     related-service-requests query.
-- The extended service_policies drift columns are NOT touched here because no
-- code in this feature or the Review flow depends on them.
-- =============================================================================

-- Pre-computed scheduling / flag columns (set by the annual-reviews cron and
-- read by the review detail + print surfaces).
alter table public.policy_reviews
  add column if not exists scheduled_date       date;

alter table public.policy_reviews
  add column if not exists term_expiry_date     date;

alter table public.policy_reviews
  add column if not exists is_declining_ul      boolean not null default false;

alter table public.policy_reviews
  add column if not exists tobacco_reclass_flag boolean not null default false;

alter table public.policy_reviews
  add column if not exists beneficiary_missing  boolean not null default false;

alter table public.policy_reviews
  add column if not exists is_1035_eligible     boolean not null default false;

alter table public.policy_reviews
  add column if not exists cash_value_stale     boolean not null default false;

-- Customer-level link. Nullable, references customers(id). The feature treats a
-- review as customer-scoped; this column already exists in live use.
alter table public.policy_reviews
  add column if not exists customer_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'policy_reviews_customer_id_fkey'
  ) then
    alter table public.policy_reviews
      add constraint policy_reviews_customer_id_fkey
      foreign key (customer_id) references public.customers (id);
  end if;
end
$$;

create index if not exists policy_reviews_customer_idx
  on public.policy_reviews (customer_id)
  where customer_id is not null;


-- =============================================================================
-- service_requests.customer_id
-- Inserted and filtered on by src/app/api/service-requests/route.ts and read by
-- the Review flow's related-service-requests query. Nullable uuid with a FK to
-- customers(id) and no delete rule, matching the verified live definition. Live
-- has no index on this column, so none is added here.
-- =============================================================================
alter table public.service_requests
  add column if not exists customer_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'service_requests_customer_id_fkey'
  ) then
    alter table public.service_requests
      add constraint service_requests_customer_id_fkey
      foreign key (customer_id) references public.customers (id);
  end if;
end
$$;
