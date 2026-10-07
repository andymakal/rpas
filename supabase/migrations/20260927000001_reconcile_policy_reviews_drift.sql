-- =============================================================================
-- Reconcile live-but-undocumented drift on policy_reviews
-- Migration: 20260927000001_reconcile_policy_reviews_drift.sql
--
-- The live database has eight columns on public.policy_reviews that were added
-- out-of-band and are not produced by the committed migration chain. The
-- stewardship / producer pre-review feature (next migration) links to
-- policy_reviews and the surrounding review surfaces read these columns, so the
-- committed schema must match live before new objects are built on top of it.
--
-- This migration is additive and idempotent (add column if not exists). It
-- matches the verified live column types, nullability, and defaults exactly, so
-- it is a no-op in production (where these columns already exist) and reproduces
-- the real policy_reviews shape on a clean replay.
--
-- Scope: ONLY the policy_reviews columns this feature depends on. This is not a
-- full database drift reconciliation. service_requests.customer_id and the
-- extended service_policies columns are also live drift but are not touched by
-- the pre-review schema, so they are intentionally left out of this migration.
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
