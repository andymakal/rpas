-- =============================================================================
-- Population Builder — customer age: conflicting owner DOB => unknown
-- Migration: 20261013000001_customer_age_conflict_unknown.sql
--
-- Correction to project_customer_age (introduced in 20261012000001).
--
-- Previously, when a customer had no exact customers.date_of_birth, age was
-- derived from the owner_dob_approx of ONE policy chosen deterministically
-- (most recent, then highest year). That silently picks a winner when a
-- customer's linked policies disagree on the owner's birth year — i.e. it
-- guesses which DOB is correct. That is a data-integrity problem.
--
-- Corrected rule (no guessing):
--   1. exact customers.date_of_birth is authoritative when present.
--   2. otherwise look at ALL usable linked owner_dob_approx birth years:
--        * if they all agree on a single birth YEAR, derive the age at that
--          year's precision — using the birth MONTH only if every agreeing row
--          also shares the same month (otherwise year-only, no invented month).
--        * if the linked policies carry materially conflicting birth-year
--          information (more than one distinct year), Customer Age is UNKNOWN
--          (NULL) for population filtering — we do not pick a winner.
--
-- Only project_customer_age changes. Insured-age logic, the Clear behavior, and
-- every other engine function are untouched; the match/facet functions call
-- project_customer_age unchanged, so they inherit the correction.
--
-- PHI: still age only; no DOB/day exposed. Development only.
-- =============================================================================

create or replace function public.project_customer_age(p_customer_id uuid, p_dob date)
returns integer
language sql
stable
as $$
  select coalesce(
    -- 1. exact DOB is authoritative
    public.project_age_years(p_dob),
    -- 2. consensus across the customer's linked owner_dob_approx values
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
        -- no usable owner birth year at all
        when a.the_year is null then null
        -- materially conflicting birth years across linked policies => unknown
        when a.distinct_years > 1 then null
        -- single agreed year: use month only if all agreeing rows share one month
        else public.project_age_from_parts(
               a.the_year,
               case when a.distinct_months = 1 then a.the_month else null end)
      end
      from agg a
    )
  )
$$;

comment on function public.project_customer_age(uuid, date) is
  'Best-available-precision age for a customer with NO guessing on conflict: '
  'exact date_of_birth is authoritative; otherwise the customer''s linked '
  'owner_dob_approx values must agree on a single birth year (month used only '
  'if all agree), else Customer Age is NULL (unknown). Age only; no DOB exposed.';


notify pgrst, 'reload schema';
