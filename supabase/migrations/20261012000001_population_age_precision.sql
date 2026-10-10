-- =============================================================================
-- Population Builder — age from best available DOB precision
-- Migration: 20261012000001_population_age_precision.sql
--
-- The Customer Age and Insured Age facets previously derived age ONLY from a
-- fully-populated exact-date column:
--   * customer_age used customers.date_of_birth (exact DATE) — populated for
--     only ~1,156 of 11,407 customers. For books like Cassidy, where the owner's
--     birth info was imported as a masked month/year (service_policies
--     .owner_dob_approx = 'MM/xx/YYYY') and deliberately NOT written to the exact
--     date column, almost every customer fell out, so the facet collapsed to a
--     single value (the "63–63" defect).
--   * insured_age used service_policies.insured_dob (exact DATE) — 0 populated —
--     while the real data is in insured_dob_year / insured_dob_month
--     (precision 'month_year').
--
-- This migration derives age from the BEST precision actually available, without
-- inventing missing birth information and without a persistent age column:
--
--   exact DOB  -> actual age
--   month/year -> age from year, decremented only if the birth MONTH has not yet
--                 arrived this calendar year (no day is invented)
--   year only  -> approximate age from the birth year (year difference)
--   none       -> unknown (NULL) — excluded from age filters and from bounds
--
-- Customer age source precedence (per customer):
--   1. customers.date_of_birth (exact)
--   2. the customer's policies' owner_dob_approx 'MM/xx/YYYY' (month+year). When
--      a customer's policies disagree on year, the most recent policy wins
--      (deterministic), then highest year, so one stable value is chosen.
--
-- Insured age source precedence (per policy):
--   1. insured_dob (exact)
--   2. insured_dob_year + insured_dob_month (month/year)
--   3. insured_dob_year only (year)
--
-- PHI: still returns AGE ONLY. No DOB, month, or day is exposed; the masked
-- owner_dob_approx is parsed server-side and only an integer age leaves these
-- functions.
--
-- Development only. Depends on 20261010000001 (the population engine).
-- =============================================================================


-- =============================================================================
-- Age from year (+ optional month), today-relative. No day is invented: when a
-- month is known we decrement only if that month has not yet occurred this year;
-- when only a year is known we use the plain year difference. Implausible ages
-- (outside 0..120) are treated as unknown so bad data cannot poison filters.
-- =============================================================================
create or replace function public.project_age_from_parts(p_year int, p_month int)
returns integer
language sql
immutable
as $$
  select case
    when p_year is null then null
    else (
      with a as (
        select
          (extract(year  from current_date)::int - p_year)
          - case
              when p_month is null then 0
              when extract(month from current_date)::int < p_month then 1
              else 0
            end as years
      )
      select case when a.years between 0 and 120 then a.years else null end from a
    )
  end
$$;

comment on function public.project_age_from_parts(int, int) is
  'Age from a birth year and optional birth month, today-relative. With a month, '
  'decrements only if that month has not yet occurred this year; with year only, '
  'uses the year difference. No day is invented. Returns NULL for implausible ages.';


-- =============================================================================
-- Parse a masked owner DOB 'MM/xx/YYYY' (or 'xx/xx/YYYY') into year / month.
-- Year is the trailing 4 digits; month is the leading 2 digits when numeric,
-- else NULL (year-only). Returns NULL year when no 4-digit year is present.
-- =============================================================================
create or replace function public.project_masked_dob_year(p_masked text)
returns integer
language sql
immutable
as $$
  select nullif(substring(p_masked from '([0-9]{4})\s*$'), '')::int
$$;

create or replace function public.project_masked_dob_month(p_masked text)
returns integer
language sql
immutable
as $$
  select case
    when p_masked is null then null
    when substring(p_masked from '^([0-9]{1,2})') ~ '^[0-9]{1,2}$'
      then nullif(substring(p_masked from '^([0-9]{1,2})'), '')::int
    else null
  end
$$;


-- =============================================================================
-- CUSTOMER AGE — best available precision for a customer.
-- 1. exact customers.date_of_birth
-- 2. else the customer's best masked owner DOB from their policies
--    (owner_dob_approx), choosing deterministically: most recent policy, then
--    highest year. Month used when present; otherwise year-only.
-- Takes the customer id + exact dob so callers that already joined customers
-- avoid a re-lookup for the exact case.
-- =============================================================================
create or replace function public.project_customer_age(p_customer_id uuid, p_dob date)
returns integer
language sql
stable
as $$
  select coalesce(
    -- 1. exact DOB
    public.project_age_years(p_dob),
    -- 2. masked owner month/year from the customer's policies
    (
      select public.project_age_from_parts(
               public.project_masked_dob_year(sp.owner_dob_approx),
               public.project_masked_dob_month(sp.owner_dob_approx))
      from public.service_policies sp
      where sp.customer_id = p_customer_id
        and sp.is_test = false
        and sp.owner_dob_approx is not null
        and public.project_masked_dob_year(sp.owner_dob_approx) is not null
      order by sp.updated_at desc nulls last,
               public.project_masked_dob_year(sp.owner_dob_approx) desc
      limit 1
    )
  )
$$;

comment on function public.project_customer_age(uuid, date) is
  'Best-available-precision age for a customer: exact date_of_birth, else the '
  'month/year parsed from the customer''s owner_dob_approx (deterministic pick). '
  'Age only; no DOB exposed.';


-- =============================================================================
-- INSURED AGE — best available precision for a policy's insured.
-- 1. exact insured_dob
-- 2. else insured_dob_year + insured_dob_month (month/year)
-- 3. else insured_dob_year only (year)
-- =============================================================================
create or replace function public.project_insured_age(p_insured_dob date, p_year int, p_month int)
returns integer
language sql
immutable
as $$
  select coalesce(
    public.project_age_years(p_insured_dob),
    public.project_age_from_parts(p_year, p_month)
  )
$$;

comment on function public.project_insured_age(date, int, int) is
  'Best-available-precision age for a policy''s insured: exact insured_dob, else '
  'insured_dob_year (+month). Age only; no DOB exposed.';


-- =============================================================================
-- Redefine the MATCH function to use the precision-aware age for customer_age
-- and insured_age. Everything else is unchanged from 20261010000001.
-- =============================================================================
create or replace function public.project_population_matches(c jsonb)
returns table (customer_id uuid, policy_id uuid)
language sql
stable
as $$
  with params as (
    select
      coalesce((c->>'activeOnly')::boolean, true)       as active_only,
      coalesce(c->>'cashValue', 'any')                   as cash_choice,
      c->'discrete'                                       as d,
      c->'range'                                          as r,
      c->'date'                                           as dt
  )
  select sp.customer_id, sp.id as policy_id
  from public.service_policies sp
  join public.customers cu on cu.id = sp.customer_id
  cross join params p
  where sp.is_test = false
    and cu.is_test = false
    and sp.customer_id is not null
    and (not p.active_only or public.project_policy_is_active(sp.coverage_status))
    and (
      p.cash_choice = 'any'
      or (p.cash_choice = 'has'  and coalesce(sp.cash_value_amount, 0) > 0)
      or (p.cash_choice = 'none' and coalesce(sp.cash_value_amount, 0) <= 0)
    )
    and (p.d->'agency' is null or jsonb_array_length(p.d->'agency') = 0
         or sp.agency_id::text in (select jsonb_array_elements_text(p.d->'agency')))
    and (p.d->'carrier' is null or jsonb_array_length(p.d->'carrier') = 0
         or sp.carrier in (select jsonb_array_elements_text(p.d->'carrier')))
    and (p.d->'product_type' is null or jsonb_array_length(p.d->'product_type') = 0
         or coalesce(sp.product_type, '∅') in (select jsonb_array_elements_text(p.d->'product_type')))
    and (p.d->'term_length' is null or jsonb_array_length(p.d->'term_length') = 0
         or coalesce(sp.term_length, '∅') in (select jsonb_array_elements_text(p.d->'term_length')))
    and (p.d->'rate_class' is null or jsonb_array_length(p.d->'rate_class') = 0
         or coalesce(sp.rate_class, '∅') in (select jsonb_array_elements_text(p.d->'rate_class')))
    and (p.d->'customer_segment' is null or jsonb_array_length(p.d->'customer_segment') = 0
         or coalesce(cu.segment, '∅') in (select jsonb_array_elements_text(p.d->'customer_segment')))
    and (p.d->'insured_state' is null or jsonb_array_length(p.d->'insured_state') = 0
         or coalesce(sp.insured_state, '∅') in (select jsonb_array_elements_text(p.d->'insured_state')))
    and (p.r->'face_amount'->>'min' is null or sp.face_amount >= (p.r->'face_amount'->>'min')::numeric)
    and (p.r->'face_amount'->>'max' is null or sp.face_amount <= (p.r->'face_amount'->>'max')::numeric)
    and (p.r->'cash_value'->>'min' is null or sp.cash_value_amount >= (p.r->'cash_value'->>'min')::numeric)
    and (p.r->'cash_value'->>'max' is null or sp.cash_value_amount <= (p.r->'cash_value'->>'max')::numeric)
    and (p.r->'annual_premium'->>'min' is null or sp.annual_premium >= (p.r->'annual_premium'->>'min')::numeric)
    and (p.r->'annual_premium'->>'max' is null or sp.annual_premium <= (p.r->'annual_premium'->>'max')::numeric)
    -- precision-aware customer age (exact DOB, else masked owner month/year)
    and (p.r->'customer_age'->>'min' is null or public.project_customer_age(cu.id, cu.date_of_birth) >= (p.r->'customer_age'->>'min')::int)
    and (p.r->'customer_age'->>'max' is null or public.project_customer_age(cu.id, cu.date_of_birth) <= (p.r->'customer_age'->>'max')::int)
    -- precision-aware insured age (exact, else year+month, else year)
    and (p.r->'insured_age'->>'min' is null or public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month) >= (p.r->'insured_age'->>'min')::int)
    and (p.r->'insured_age'->>'max' is null or public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month) <= (p.r->'insured_age'->>'max')::int)
    and public.project_date_match(sp.issue_date,              p.dt->'issue_date')
    and public.project_date_match(sp.policy_termination_date, p.dt->'termination_date')
    and public.project_date_match(sp.surrender_end_date,      p.dt->'surrender_end_date')
$$;


-- =============================================================================
-- Redefine FACETS so the customer_age / insured_age range BOUNDS use the same
-- precision-aware ages. Discrete facets are unchanged from 20261010000001.
-- =============================================================================
create or replace function public.project_population_facets(c jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  result jsonb := '{"discrete":{}}'::jsonb;
  discrete_facets text[][] := array[
    ['agency',           'sp.agency_id::text'],
    ['carrier',          'sp.carrier'],
    ['product_type',     'sp.product_type'],
    ['term_length',      'sp.term_length'],
    ['rate_class',       'sp.rate_class'],
    ['customer_segment', 'cu.segment'],
    ['insured_state',    'sp.insured_state']
  ];
  i int;
  fid text;
  fexpr text;
  c_wo jsonb;
  vals jsonb;
  rng jsonb;
begin
  for i in 1 .. array_length(discrete_facets, 1) loop
    fid   := discrete_facets[i][1];
    fexpr := discrete_facets[i][2];

    c_wo := c;
    if c_wo ? 'discrete' then
      c_wo := jsonb_set(c_wo, '{discrete}', (c_wo->'discrete') - fid);
    end if;

    execute format($f$
      select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v asc), '[]'::jsonb)
      from (
        select %s as v, count(distinct sp.customer_id) as n
        from public.service_policies sp
        join public.customers cu on cu.id = sp.customer_id
        join public.project_population_matches($1) m on m.policy_id = sp.id
        group by %s
      ) s
    $f$, fexpr, fexpr)
    into vals
    using c_wo;

    result := jsonb_set(result, array['discrete', fid], coalesce(vals, '[]'::jsonb), true);
  end loop;

  -- Range bounds over the current matched population, using precision-aware ages.
  select jsonb_build_object(
    'face_amount',    jsonb_build_object('min', min(sp.face_amount),       'max', max(sp.face_amount)),
    'cash_value',     jsonb_build_object('min', min(sp.cash_value_amount), 'max', max(sp.cash_value_amount)),
    'annual_premium', jsonb_build_object('min', min(sp.annual_premium),    'max', max(sp.annual_premium)),
    'customer_age',   jsonb_build_object(
                        'min', min(public.project_customer_age(cu.id, cu.date_of_birth)),
                        'max', max(public.project_customer_age(cu.id, cu.date_of_birth))),
    'insured_age',    jsonb_build_object(
                        'min', min(public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month)),
                        'max', max(public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month)))
  )
  into rng
  from public.service_policies sp
  join public.customers cu on cu.id = sp.customer_id
  join public.project_population_matches(c) m on m.policy_id = sp.id;

  result := jsonb_set(result, '{range}', coalesce(rng, '{}'::jsonb), true);

  return result;
end
$$;


-- =============================================================================
-- EXECUTE grants for the new helper functions (service_role runs the engine).
-- =============================================================================
grant execute on function public.project_age_from_parts(int, int)        to service_role;
grant execute on function public.project_masked_dob_year(text)            to service_role;
grant execute on function public.project_masked_dob_month(text)           to service_role;
grant execute on function public.project_customer_age(uuid, date)         to service_role;
grant execute on function public.project_insured_age(date, int, int)      to service_role;


notify pgrst, 'reload schema';
