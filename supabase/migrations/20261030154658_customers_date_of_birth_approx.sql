-- =============================================================================
-- Customer DOB — preserve a PARTIAL date of birth without inventing a day
-- Migration: 20261030154658_customers_date_of_birth_approx.sql
--
-- The Customer Contact Card now lets an operator enter a date of birth by
-- separate month / day / year, leaving unknown parts blank. The exact-date
-- column customers.date_of_birth is all-or-nothing (a SQL `date` cannot hold a
-- year-only or month+year value), so a partial DOB had nowhere to live and was
-- lost. This adds a nullable masked column that preserves the partial date at
-- the precision actually known, WITHOUT fabricating a day and WITHOUT touching
-- the exact column.
--
--   customers.date_of_birth         date   — the EXACT DOB (all three parts).
--                                            Authoritative when present.
--   customers.date_of_birth_approx  text   — a partial DOB when the exact date
--                                            is NOT fully known. Masked form,
--                                            reusing the established
--                                            service_policies.owner_dob_approx
--                                            convention already parsed by the
--                                            age engine:
--                                              'MM/xx/YYYY'  month + year known
--                                              'xx/xx/YYYY'  year only
--                                            The DAY is ALWAYS 'xx' — a day is
--                                            never stored here, so this column
--                                            cannot expose a full DOB.
--
-- Precedence (never downgrade a known exact DOB):
--   An exact date_of_birth and a date_of_birth_approx are mutually exclusive in
--   practice — the write path stores the exact column when all three parts are
--   known and the approx column only for a genuinely partial date, and clears
--   the other. The age derivation below reads the exact column first regardless,
--   so even if both were somehow present the exact value wins and the partial
--   one can never make age LESS precise.
--
-- PHI: the masked column holds no day. The age functions still return AGE ONLY;
-- no DOB, month, or day leaves them. Development clone only.
--
-- Depends on 20261012000001 / 20261013000001 (the precision-aware age engine).
-- =============================================================================

alter table public.customers
  add column if not exists date_of_birth_approx text;

comment on column public.customers.date_of_birth_approx is
  'Partial date of birth, used ONLY when the exact date_of_birth is not fully '
  'known. Masked ''MM/xx/YYYY'' (month+year) or ''xx/xx/YYYY'' (year only), '
  'mirroring service_policies.owner_dob_approx. The day is never stored (always '
  '''xx''). Exact date_of_birth always takes precedence for age; this never '
  'downgrades a known exact DOB.';

-- Guard the shape so a full date can never be written here (no numeric day) and
-- a 4-digit year is always present. Month is the leading 1-2 digits or 'xx';
-- the middle (day) component must be non-numeric so no day is ever captured.
alter table public.customers
  drop constraint if exists customers_date_of_birth_approx_shape;

alter table public.customers
  add constraint customers_date_of_birth_approx_shape
  check (
    date_of_birth_approx is null
    or date_of_birth_approx ~ '^([0-9]{1,2}|xx)/xx/[0-9]{4}$'
  );

-- =============================================================================
-- Fold the customer's OWN partial DOB into the age precedence, between the
-- exact date and the linked-policy consensus. This supersedes the body of
-- project_customer_age from 20261013000001 (conflicting owner DOB => unknown),
-- preserving that policy-consensus rule verbatim as the final fallback and only
-- inserting the customer's own date_of_birth_approx ahead of it.
--
--   1. exact customers.date_of_birth                      (authoritative)
--   2. customers.date_of_birth_approx  (month+year, else year-only; no day)
--   3. consensus across the customer's linked owner_dob_approx values
--        (all agree on one year -> that year, month only if all share it;
--         conflicting years -> UNKNOWN / NULL; no guessing)
-- =============================================================================
create or replace function public.project_customer_age(p_customer_id uuid, p_dob date)
returns integer
language sql
stable
as $$
  select coalesce(
    -- 1. exact DOB is authoritative
    public.project_age_years(p_dob),
    -- 2. the customer's OWN partial DOB (masked month/year; no day invented)
    (
      select public.project_age_from_parts(
               public.project_masked_dob_year(c.date_of_birth_approx),
               public.project_masked_dob_month(c.date_of_birth_approx))
      from public.customers c
      where c.id = p_customer_id
        and c.date_of_birth_approx is not null
        and public.project_masked_dob_year(c.date_of_birth_approx) is not null
    ),
    -- 3. consensus across the customer's linked owner_dob_approx values
    (
      with parts as (
        select
          public.project_masked_dob_year(sp.owner_dob_approx)  as yr,
          public.project_masked_dob_month(sp.owner_dob_approx) as mo
        from public.service_policies sp
        where sp.customer_id = p_customer_id
          and sp.is_test = false
          and sp.owner_dob_approx is not null
          and public.project_masked_dob_year(sp.owner_dob_approx) is not null
      ),
      agg as (
        select
          count(distinct yr)                           as distinct_years,
          min(yr)                                      as the_year,
          count(distinct mo) filter (where mo is not null) as distinct_months,
          min(mo) filter (where mo is not null)        as the_month
        from parts
      )
      select case
        when a.the_year is null then null
        when a.distinct_years > 1 then null
        else public.project_age_from_parts(
               a.the_year,
               case when a.distinct_months = 1 then a.the_month else null end)
      end
      from agg a
    )
  )
$$;

comment on function public.project_customer_age(uuid, date) is
  'Best-available-precision age for a customer with NO guessing: exact '
  'date_of_birth is authoritative; else the customer''s own date_of_birth_approx '
  '(month/year, no day); else the customer''s linked owner_dob_approx values must '
  'agree on a single birth year (month used only if all agree), else UNKNOWN '
  '(NULL). Age only; no DOB exposed.';

notify pgrst, 'reload schema';
