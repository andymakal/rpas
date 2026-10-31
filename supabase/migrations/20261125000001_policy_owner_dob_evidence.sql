-- =============================================================================
-- Policy owner DOB — source EVIDENCE (not authoritative customer truth)
-- Migration: 20261125000001_policy_owner_dob_evidence.sql
--
-- A policy import often states a COMPLETE owner date of birth (day included).
-- The authoritative home for a person's DOB is the customer record, and the
-- policy's own owner_dob_approx column is deliberately day-less for PHI reasons
-- (see 20260525000001: "never store full DOB"). So when a policy's owner has
-- not yet been RELIABLY linked to a single customer, that complete owner DOB
-- had nowhere to live and was discarded.
--
-- This table preserves it as EVIDENCE from the source document — "the policy
-- import for policy N stated this owner, born on this date" — without creating
-- a second authoritative DOB:
--
--   * It is keyed to the policy_number (the source document), NOT to a customer,
--     so it never competes with the customer record as a source of truth.
--   * It records the owner identity AS STATED by the source, so an unlinked
--     owner's DOB is retained until the owner is confidently resolved.
--   * It is read ONLY to enrich the authoritative customer DOB when the owner's
--     identity is sufficiently established and the information is compatible;
--     nothing displays it as the customer's DOB.
--
-- Precision is stored as explicit components with a precision flag, exactly like
-- the insured DOB model (20261008000001): no day or month is ever fabricated.
-- Unlike owner_dob_approx this MAY carry a day, because it is provenance of what
-- a specific source document stated — not the masked display value — and it is
-- internal-only (RLS denies all; only the service role, used by the internal
-- admin import route, reads/writes it). It is never exposed to the agency
-- portal or to any customer-facing surface.
--
-- Additive and non-destructive. Development clone first.
-- =============================================================================

create table if not exists public.policy_owner_dob_evidence (
  id                uuid primary key default gen_random_uuid(),
  -- The source document this evidence came from. One current evidence row per
  -- policy; a re-import updates it in place (see the unique index below).
  policy_number     text not null,
  -- The owner identity AS STATED by the source, used to resolve the owner to a
  -- customer later. Stored lower-cased-insensitively as given; matching
  -- normalizes at read time.
  owner_first_name  text,
  owner_last_name   text,
  -- The owner DOB at the precision the source actually provided. A day is
  -- present ONLY at 'exact'. No component is ever invented.
  dob_year          smallint,
  dob_month         smallint,
  dob_day           smallint,
  dob_precision     text not null default 'missing',
  -- Provenance.
  source_file       text,
  observed_at       timestamptz not null default now()
);

comment on table public.policy_owner_dob_evidence is
  'Source EVIDENCE of a policy owner''s date of birth as stated by a policy '
  'import. Keyed to the policy (source document), never to a customer, so it is '
  'never a second authoritative DOB. Read only to enrich the authoritative '
  'customer DOB once the owner is confidently resolved and the info is '
  'compatible. Internal-only (RLS denies all; service role only). May carry a '
  'day because it is provenance, not the masked display value.';

comment on column public.policy_owner_dob_evidence.dob_precision is
  'How much of the owner DOB the source provided: ''exact'' (full date), '
  '''month_year'', ''year_only'', or ''missing''. No day/month is ever fabricated.';

-- Precision is one of the four allowed values.
alter table public.policy_owner_dob_evidence
  drop constraint if exists policy_owner_dob_evidence_precision_check;
alter table public.policy_owner_dob_evidence
  add constraint policy_owner_dob_evidence_precision_check
  check (dob_precision in ('exact', 'month_year', 'year_only', 'missing'));

-- The stored components must match the declared precision, so the evidence can
-- never claim more certainty than the source gave (mirrors the insured model).
alter table public.policy_owner_dob_evidence
  drop constraint if exists policy_owner_dob_evidence_shape_check;
alter table public.policy_owner_dob_evidence
  add constraint policy_owner_dob_evidence_shape_check
  check (
    case dob_precision
      when 'exact'      then dob_year is not null and dob_month is not null and dob_day is not null
      when 'month_year' then dob_year is not null and dob_month is not null and dob_day is null
      when 'year_only'  then dob_year is not null and dob_month is null and dob_day is null
      when 'missing'    then dob_year is null and dob_month is null and dob_day is null
    end
  );

alter table public.policy_owner_dob_evidence
  drop constraint if exists policy_owner_dob_evidence_month_range_check;
alter table public.policy_owner_dob_evidence
  add constraint policy_owner_dob_evidence_month_range_check
  check (dob_month is null or dob_month between 1 and 12);

alter table public.policy_owner_dob_evidence
  drop constraint if exists policy_owner_dob_evidence_year_range_check;
alter table public.policy_owner_dob_evidence
  add constraint policy_owner_dob_evidence_year_range_check
  check (dob_year is null or dob_year between 1900 and 2100);

-- One current evidence row per source document; a re-import upserts it.
create unique index if not exists policy_owner_dob_evidence_policy_number_key
  on public.policy_owner_dob_evidence (policy_number);

-- Resolve-by-identity lookups when reconciling evidence to a customer.
create index if not exists policy_owner_dob_evidence_owner_name_idx
  on public.policy_owner_dob_evidence (lower(owner_last_name), lower(owner_first_name));

-- Internal-only: deny all through RLS. The internal admin import route reaches
-- this via the service-role client, which bypasses RLS; agency (portal) users
-- and any client-side session must never see or write owner-DOB evidence.
alter table public.policy_owner_dob_evidence enable row level security;

notify pgrst, 'reload schema';
