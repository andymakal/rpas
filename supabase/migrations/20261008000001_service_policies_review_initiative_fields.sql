-- =============================================================================
-- Policy fields needed for Review Initiatives
-- Migration: 20261008000001_service_policies_review_initiative_fields.sql
--
-- Review Initiatives need three facts about the insured/policy that
-- service_policies does not yet carry:
--
--   1. Insured date of birth, at whatever precision the source actually knew.
--      Legacy books record DOB inconsistently: some rows have a full date,
--      some only month + year, some only a year, and some nothing at all.
--      We must NEVER invent a day (or a month) we were not given, so the DOB
--      is stored as explicit components plus a precision flag rather than
--      forced into a single `date` with a fabricated day.
--
--   2. Insured state (US state the insured resides in) — drives state-specific
--      review eligibility and sequencing.
--
--   3. Policy termination date — the date the policy actually terminated
--      (lapse, surrender, death, maturity). Distinct from the annuity
--      `surrender_end_date` (end of the surrender-charge period), which is a
--      product mechanic, not a termination event.
--
-- This is additive and non-destructive: all new columns are nullable and the
-- DOB precision defaults to 'missing', so existing rows remain valid.
-- The pre-existing masked `owner_dob_approx` column is left untouched; it masks
-- the OWNER's DOB for display, whereas these columns carry the INSURED's DOB
-- for review logic.
-- =============================================================================

-- ── Insured date of birth, stored by precision (no invented day) ─────────────
alter table public.service_policies
  add column if not exists insured_dob          date,
  add column if not exists insured_dob_year      smallint,
  add column if not exists insured_dob_month     smallint,
  add column if not exists insured_dob_precision text not null default 'missing';

comment on column public.service_policies.insured_dob is
  'Full insured date of birth. Populated ONLY when insured_dob_precision = '
  '''exact''. Null for every lower precision so no day is ever fabricated.';

comment on column public.service_policies.insured_dob_year is
  'Insured birth year. Present whenever precision is exact, month_year, or '
  'year_only; null when missing.';

comment on column public.service_policies.insured_dob_month is
  'Insured birth month (1-12). Present whenever precision is exact or '
  'month_year; null for year_only and missing. A day is never stored at this '
  'precision — only insured_dob (exact) carries a day.';

comment on column public.service_policies.insured_dob_precision is
  'How much of the insured DOB is actually known: '
  '''exact'' (full date in insured_dob), '
  '''month_year'' (year + month only), '
  '''year_only'' (year only), '
  '''missing'' (nothing). Lets review logic degrade gracefully without '
  'guessing a day or month that was never provided.';

-- Precision is one of the four allowed values.
alter table public.service_policies
  drop constraint if exists service_policies_insured_dob_precision_check;
alter table public.service_policies
  add constraint service_policies_insured_dob_precision_check
  check (insured_dob_precision in ('exact', 'month_year', 'year_only', 'missing'));

-- The stored components must match the declared precision. This is what
-- guarantees we never claim more certainty than we have (e.g. an 'exact'
-- precision with no full date, or a 'year_only' precision carrying a month).
alter table public.service_policies
  drop constraint if exists service_policies_insured_dob_shape_check;
alter table public.service_policies
  add constraint service_policies_insured_dob_shape_check
  check (
    case insured_dob_precision
      when 'exact' then
        insured_dob is not null
        and insured_dob_year  is not null
        and insured_dob_month is not null
      when 'month_year' then
        insured_dob is null
        and insured_dob_year  is not null
        and insured_dob_month is not null
      when 'year_only' then
        insured_dob is null
        and insured_dob_year  is not null
        and insured_dob_month is null
      when 'missing' then
        insured_dob is null
        and insured_dob_year  is null
        and insured_dob_month is null
    end
  );

-- Sanity bounds on the partial components (defensive; app validates too).
alter table public.service_policies
  drop constraint if exists service_policies_insured_dob_month_range_check;
alter table public.service_policies
  add constraint service_policies_insured_dob_month_range_check
  check (insured_dob_month is null or insured_dob_month between 1 and 12);

alter table public.service_policies
  drop constraint if exists service_policies_insured_dob_year_range_check;
alter table public.service_policies
  add constraint service_policies_insured_dob_year_range_check
  check (insured_dob_year is null or insured_dob_year between 1900 and 2100);

-- ── Insured state ────────────────────────────────────────────────────────────
alter table public.service_policies
  add column if not exists insured_state text;

comment on column public.service_policies.insured_state is
  'US state the insured resides in (e.g. ''PA''). Drives state-specific Review '
  'Initiative eligibility and sequencing. Matches the plain-text state '
  'convention used on customers.state.';

-- ── Policy termination date ────────────────────────────────────────────────
alter table public.service_policies
  add column if not exists policy_termination_date date;

comment on column public.service_policies.policy_termination_date is
  'Date the policy actually terminated (lapse, surrender, death, maturity). '
  'Null while in force. Distinct from the annuity surrender_end_date, which is '
  'the end of the surrender-charge period, not a termination event.';

-- Review Initiatives filter heavily on who is still in force and on birth year
-- cohorts, so index the fields they scan.
create index if not exists service_policies_insured_state_idx
  on public.service_policies (insured_state)
  where insured_state is not null and is_test = false;

create index if not exists service_policies_insured_dob_year_idx
  on public.service_policies (insured_dob_year)
  where insured_dob_year is not null and is_test = false;

create index if not exists service_policies_termination_date_idx
  on public.service_policies (policy_termination_date)
  where policy_termination_date is not null;
