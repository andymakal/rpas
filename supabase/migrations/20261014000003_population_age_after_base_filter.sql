-- =============================================================================
-- Population Builder — compute customer age AFTER base filtering (perf)
-- Migration: 20261014000003_population_age_after_base_filter.sql
--
-- Regression repro (via the PostgREST RPC path the app uses): agency =
-- "Cassidy, Jerry", product type unrestricted, Issue Date on/before 2016-01-01.
-- EXPLAIN ANALYZE of the facets inner build showed the cost is NOT the small
-- result — it is that project_population_source LEFT JOINs
-- project_customer_age_map() (a whole-book set-returning function). That join
-- builds every customer's age — a GROUP BY over ~7,500 owner rows + a hash join
-- across all 11,407 customers — BEFORE the agency/date predicates reduce the
-- population to ~150 policies. Every unrelated filter change (e.g. Issue Date)
-- therefore recomputes customer age for the entire book.
--
-- Fix (the required architecture, smallest sufficient change):
--   1. The derived source view carries only cheap base-policy columns + the
--      normalized status and insured_age (both immutable scalars on the policy's
--      own columns). Customer age is NO LONGER joined in the view.
--   2. Customer age is computed only for the REDUCED working set, via
--      project_customer_age_for(uuid[]) which resolves ages for a bounded list
--      of customer ids (exact DOB authoritative; conflicting owner birth years
--      => NULL — unchanged semantics).
--   3. matches applies all base predicates first, then joins ages for just the
--      surviving customers, and only when a customer_age filter is present.
--   4. facets builds the base working set first (no age), computes discrete
--      lists and non-age bounds from it, and computes customer-age bounds by
--      resolving ages for only that set's distinct customers.
--
-- Age capability and data-integrity semantics are preserved; statement_timeout
-- is unchanged; customer age is still derived, never persisted.
--
-- Development only. Depends on 20261014000002 and the age helpers.
-- =============================================================================


-- =============================================================================
-- Derived source view WITHOUT customer_age (cheap base). Status + insured_age
-- are immutable scalars over each policy's own columns.
-- =============================================================================
-- Dropping customer_age from the view requires a drop+recreate (create or
-- replace cannot remove a column). Functions reference the view by name at
-- runtime, so there is no hard dependency blocking the drop.
drop view if exists public.project_population_source;
create view public.project_population_source
with (security_invoker = true) as
select
  sp.id                               as policy_id,
  sp.customer_id                      as customer_id,
  public.project_policy_status_class(sp.coverage_status) as normalized_status,
  (public.project_policy_status_class(sp.coverage_status) = 'active') as is_active,
  coalesce(sp.agency_id::text, '∅')   as agency,
  coalesce(sp.carrier, '∅')           as carrier,
  coalesce(sp.product_type, '∅')      as product_type,
  coalesce(sp.term_length, '∅')       as term_length,
  coalesce(sp.rate_class, '∅')        as rate_class,
  coalesce(cu.segment, '∅')           as segment,
  coalesce(sp.insured_state, '∅')     as insured_state,
  sp.face_amount                      as face_amount,
  sp.cash_value_amount                as cash_value_amount,
  sp.annual_premium                   as annual_premium,
  sp.issue_date                       as issue_date,
  sp.policy_termination_date          as policy_termination_date,
  sp.surrender_end_date               as surrender_end_date,
  public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month) as insured_age
from public.service_policies sp
join public.customers cu on cu.id = sp.customer_id
where sp.is_test = false
  and cu.is_test = false
  and sp.customer_id is not null;

comment on view public.project_population_source is
  'Derived population source (cheap base): one row per eligible policy with '
  'normalized_status/is_active and insured_age. Customer age is NOT joined here '
  '— it is resolved only for the reduced working set via '
  'project_customer_age_for() so unrelated filters do not recompute age for the '
  'whole book.';

grant select on public.project_population_source to service_role;


-- =============================================================================
-- Customer age for a BOUNDED set of customers (the reduced working population).
-- Same semantics as project_customer_age_map but restricted to the given ids:
-- exact date_of_birth authoritative; else owner_dob_approx must agree on a
-- single birth year (month only if all agree); conflicting years => NULL.
-- =============================================================================
create or replace function public.project_customer_age_for(p_ids uuid[])
returns table (customer_id uuid, age integer)
language sql
stable
as $$
  with owner_consensus as (
    select
      sp.customer_id,
      count(distinct public.project_masked_dob_year(sp.owner_dob_approx))
        filter (where public.project_masked_dob_year(sp.owner_dob_approx) is not null) as distinct_years,
      min(public.project_masked_dob_year(sp.owner_dob_approx))
        filter (where public.project_masked_dob_year(sp.owner_dob_approx) is not null) as the_year,
      count(distinct public.project_masked_dob_month(sp.owner_dob_approx))
        filter (where public.project_masked_dob_month(sp.owner_dob_approx) is not null) as distinct_months,
      min(public.project_masked_dob_month(sp.owner_dob_approx))
        filter (where public.project_masked_dob_month(sp.owner_dob_approx) is not null) as the_month
    from public.service_policies sp
    where sp.is_test = false
      and sp.customer_id = any(p_ids)
      and sp.owner_dob_approx is not null
    group by sp.customer_id
  )
  select
    cu.id as customer_id,
    coalesce(
      public.project_age_years(cu.date_of_birth),
      case
        when oc.the_year is null then null
        when oc.distinct_years > 1 then null
        else public.project_age_from_parts(
               oc.the_year,
               case when oc.distinct_months = 1 then oc.the_month else null end)
      end
    ) as age
  from public.customers cu
  left join owner_consensus oc on oc.customer_id = cu.id
  where cu.id = any(p_ids)
    and cu.is_test = false
$$;

comment on function public.project_customer_age_for(uuid[]) is
  'Set-based customer age for a bounded list of customer ids (the reduced '
  'population). Exact DOB authoritative; conflicting owner birth years => NULL. '
  'Used so age is computed only for the filtered working set.';

grant execute on function public.project_customer_age_for(uuid[]) to service_role;


-- =============================================================================
-- MATCH — base predicates first; customer age resolved only for survivors and
-- only when a customer_age filter is present.
-- =============================================================================
create or replace function public.project_population_matches(c jsonb)
returns table (customer_id uuid, policy_id uuid)
language sql
stable
as $$
  with params as (
    select
      coalesce((c->>'activeOnly')::boolean, true) as active_only,
      coalesce(c->>'cashValue', 'any')             as cash_choice,
      c->'discrete' as d, c->'range' as r, c->'date' as dt,
      (c->'range'->'customer_age') is not null     as has_age_filter
  ),
  -- Everything EXCEPT the customer-age filter, from the cheap base view.
  base as (
    select s.customer_id, s.policy_id
    from public.project_population_source s
    cross join params p
    where (not p.active_only or s.is_active)
      and (
        p.cash_choice = 'any'
        or (p.cash_choice = 'has'  and coalesce(s.cash_value_amount, 0) > 0)
        or (p.cash_choice = 'none' and coalesce(s.cash_value_amount, 0) <= 0)
      )
      and (p.d->'agency' is null or jsonb_array_length(p.d->'agency') = 0
           or s.agency in (select jsonb_array_elements_text(p.d->'agency')))
      and (p.d->'carrier' is null or jsonb_array_length(p.d->'carrier') = 0
           or s.carrier in (select jsonb_array_elements_text(p.d->'carrier')))
      and (p.d->'product_type' is null or jsonb_array_length(p.d->'product_type') = 0
           or s.product_type in (select jsonb_array_elements_text(p.d->'product_type')))
      and (p.d->'term_length' is null or jsonb_array_length(p.d->'term_length') = 0
           or s.term_length in (select jsonb_array_elements_text(p.d->'term_length')))
      and (p.d->'rate_class' is null or jsonb_array_length(p.d->'rate_class') = 0
           or s.rate_class in (select jsonb_array_elements_text(p.d->'rate_class')))
      and (p.d->'customer_segment' is null or jsonb_array_length(p.d->'customer_segment') = 0
           or s.segment in (select jsonb_array_elements_text(p.d->'customer_segment')))
      and (p.d->'insured_state' is null or jsonb_array_length(p.d->'insured_state') = 0
           or s.insured_state in (select jsonb_array_elements_text(p.d->'insured_state')))
      and (p.r->'face_amount'->>'min' is null or s.face_amount >= (p.r->'face_amount'->>'min')::numeric)
      and (p.r->'face_amount'->>'max' is null or s.face_amount <= (p.r->'face_amount'->>'max')::numeric)
      and (p.r->'cash_value'->>'min' is null or s.cash_value_amount >= (p.r->'cash_value'->>'min')::numeric)
      and (p.r->'cash_value'->>'max' is null or s.cash_value_amount <= (p.r->'cash_value'->>'max')::numeric)
      and (p.r->'annual_premium'->>'min' is null or s.annual_premium >= (p.r->'annual_premium'->>'min')::numeric)
      and (p.r->'annual_premium'->>'max' is null or s.annual_premium <= (p.r->'annual_premium'->>'max')::numeric)
      and (p.r->'insured_age'->>'min' is null or (s.insured_age is not null and s.insured_age >= (p.r->'insured_age'->>'min')::int))
      and (p.r->'insured_age'->>'max' is null or (s.insured_age is not null and s.insured_age <= (p.r->'insured_age'->>'max')::int))
      and public.project_date_match(s.issue_date,              p.dt->'issue_date')
      and public.project_date_match(s.policy_termination_date, p.dt->'termination_date')
      and public.project_date_match(s.surrender_end_date,      p.dt->'surrender_end_date')
  ),
  -- Resolve age ONLY for the reduced set, ONLY when an age filter is present.
  age as (
    select a.customer_id, a.age
    from public.project_customer_age_for(
           (select array_agg(distinct b.customer_id) from base b)) a
    where (select has_age_filter from params)
  )
  select b.customer_id, b.policy_id
  from base b
  cross join params p
  left join age ag on ag.customer_id = b.customer_id
  where (not p.has_age_filter or (
           ag.age is not null
           and (p.r->'customer_age'->>'min' is null or ag.age >= (p.r->'customer_age'->>'min')::int)
           and (p.r->'customer_age'->>'max' is null or ag.age <= (p.r->'customer_age'->>'max')::int)
        ))
$$;


-- =============================================================================
-- FACETS — base working set first (no age), then resolve customer-age bounds
-- for only that set's distinct customers.
-- =============================================================================
create or replace function public.project_population_facets(c jsonb)
returns jsonb
language plpgsql
volatile
as $$
declare
  result jsonb := '{"discrete":{}}'::jsonb;
  discrete_facets text[] := array['agency','carrier','product_type','term_length','rate_class','customer_segment','insured_state'];
  col_of jsonb := jsonb_build_object(
    'agency','agency','carrier','carrier','product_type','product_type',
    'term_length','term_length','rate_class','rate_class',
    'customer_segment','segment','insured_state','insured_state');
  fid text;
  fcol text;
  other_pred text;
  all_pred text;
  vals jsonb;
  rng jsonb;
  matched_ids uuid[];
  age_min int;
  age_max int;
begin
  -- Working set with ALL base predicates applied EXCEPT the discrete facets and
  -- EXCEPT customer age, materialized ONCE from the cheap view (no age join).
  -- Discrete columns are kept so each facet's narrowed list is computed in
  -- memory by applying the OTHER discrete selections (no re-scan, no re-call of
  -- the match function). The coverage_status classification happens once here.
  create temp table _src on commit drop as
  select s.policy_id, s.customer_id, s.agency, s.carrier, s.product_type,
         s.term_length, s.rate_class, s.segment, s.insured_state,
         s.face_amount, s.cash_value_amount, s.annual_premium, s.insured_age
  from public.project_population_source s
  cross join (select
      coalesce((c->>'activeOnly')::boolean, true) as active_only,
      coalesce(c->>'cashValue', 'any')             as cash_choice,
      c->'range' as r, c->'date' as dt) p
  where (not p.active_only or s.is_active)
    and (
      p.cash_choice = 'any'
      or (p.cash_choice = 'has'  and coalesce(s.cash_value_amount, 0) > 0)
      or (p.cash_choice = 'none' and coalesce(s.cash_value_amount, 0) <= 0)
    )
    and (p.r->'face_amount'->>'min' is null or s.face_amount >= (p.r->'face_amount'->>'min')::numeric)
    and (p.r->'face_amount'->>'max' is null or s.face_amount <= (p.r->'face_amount'->>'max')::numeric)
    and (p.r->'cash_value'->>'min' is null or s.cash_value_amount >= (p.r->'cash_value'->>'min')::numeric)
    and (p.r->'cash_value'->>'max' is null or s.cash_value_amount <= (p.r->'cash_value'->>'max')::numeric)
    and (p.r->'annual_premium'->>'min' is null or s.annual_premium >= (p.r->'annual_premium'->>'min')::numeric)
    and (p.r->'annual_premium'->>'max' is null or s.annual_premium <= (p.r->'annual_premium'->>'max')::numeric)
    and (p.r->'insured_age'->>'min' is null or (s.insured_age is not null and s.insured_age >= (p.r->'insured_age'->>'min')::int))
    and (p.r->'insured_age'->>'max' is null or (s.insured_age is not null and s.insured_age <= (p.r->'insured_age'->>'max')::int))
    and public.project_date_match(s.issue_date,              p.dt->'issue_date')
    and public.project_date_match(s.policy_termination_date, p.dt->'termination_date')
    and public.project_date_match(s.surrender_end_date,      p.dt->'surrender_end_date');

  -- Customer-age FILTER (when present): resolve ages for only _src's customers,
  -- then narrow _src to the matching customers. Age is computed on the reduced
  -- set, never the whole book.
  if (c->'range'->'customer_age') is not null then
    delete from _src
    where customer_id not in (
      select a.customer_id
      from public.project_customer_age_for((select array_agg(distinct customer_id) from _src)) a
      where a.age is not null
        and (c->'range'->'customer_age'->>'min' is null or a.age >= (c->'range'->'customer_age'->>'min')::int)
        and (c->'range'->'customer_age'->>'max' is null or a.age <= (c->'range'->'customer_age'->>'max')::int)
    );
  end if;

  all_pred := public._pop_discrete_pred(c, null);

  -- Discrete facet value lists: each with its OWN selection removed (narrowing),
  -- computed in memory against _src. No age needed for these (customer counts).
  foreach fid in array discrete_facets loop
    fcol := col_of->>fid;
    other_pred := public._pop_discrete_pred(c, fid);
    execute format($f$
      select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v asc), '[]'::jsonb)
      from (
        select %I as v, count(distinct customer_id) as n
        from _src where %s group by %I
      ) q
    $f$, fcol, other_pred, fcol)
    into vals;
    result := jsonb_set(result, array['discrete', fid], coalesce(vals, '[]'::jsonb), true);
  end loop;

  -- Non-age bounds over the FULLY-filtered set (all discrete applied).
  execute format($f$
    select jsonb_build_object(
      'face_amount',    jsonb_build_object('min', min(face_amount),       'max', max(face_amount)),
      'cash_value',     jsonb_build_object('min', min(cash_value_amount), 'max', max(cash_value_amount)),
      'annual_premium', jsonb_build_object('min', min(annual_premium),    'max', max(annual_premium)),
      'insured_age',    jsonb_build_object(
                          'min', min(insured_age) filter (where insured_age is not null),
                          'max', max(insured_age) filter (where insured_age is not null))
    )
    from _src where %s
  $f$, all_pred)
  into rng;

  -- Customer-age bounds: resolve ages ONLY for the fully-filtered set's distinct
  -- customers (bounded — e.g. ~129 for Cassidy), never the whole book.
  execute format($f$ select array_agg(distinct customer_id) from _src where %s $f$, all_pred)
  into matched_ids;
  select min(a.age), max(a.age) into age_min, age_max
  from public.project_customer_age_for(matched_ids) a;

  rng := jsonb_set(rng, '{customer_age}', jsonb_build_object('min', age_min, 'max', age_max), true);

  result := jsonb_set(result, '{range}', coalesce(rng, '{}'::jsonb), true);

  drop table if exists _src;
  return result;
end
$$;


notify pgrst, 'reload schema';
