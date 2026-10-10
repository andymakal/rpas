-- =============================================================================
-- Population Builder — set-based customer age (fix facets statement timeout)
-- Migration: 20261014000001_customer_age_setbased_perf.sql
--
-- Regression: after the precision-aware Customer Age change, the scalar
-- project_customer_age(customer_id, dob) runs a correlated subquery over
-- service_policies for EVERY row. project_population_facets evaluates it inside
-- min()/max() over the whole matched population (≈9,860 rows) and does so for
-- the range-bounds query, so the owner_dob_approx book is rescanned per row.
-- EXPLAIN ANALYZE showed the range-bounds aggregate ballooning from ~0.6s
-- (producing the rows) to ~5.9s purely from the per-row age subquery; the full
-- facets function (which also re-runs the match set several times) then exceeds
-- the statement timeout.
--
-- Fix (smallest safe correction, SAME semantics): compute each customer's age
-- ONCE, set-based, and reuse it — no per-row rescans.
--
--   project_customer_age_map()  -> table (customer_id uuid, age int)
--     * one GROUP BY over service_policies collapses each customer's usable
--       owner_dob_approx values into distinct_years / agreed year / agreed month
--       (month kept only if all agreeing rows share it) in a single pass.
--     * joined to customers so an exact date_of_birth stays authoritative, and
--       materially conflicting birth years (distinct_years > 1) resolve to NULL
--       (unknown) exactly as before — no winner is chosen.
--
-- project_population_matches and project_population_facets now LEFT JOIN this map
-- for the customer-age filter and bounds instead of calling the scalar per row.
-- Insured age is unchanged (it is an immutable scalar over the policy's own
-- columns, already cheap). The scalar project_customer_age(uuid,date) is kept as
-- the semantic reference / for any other caller, but is no longer on the hot path.
--
-- Development only. Depends on 20261012000001 / 20261013000001.
-- =============================================================================


-- =============================================================================
-- Set-based per-customer age. One pass over service_policies for the owner DOB
-- consensus, joined to customers for the authoritative exact DOB. Returns a row
-- only for customers that have at least one usable birth-year source; callers
-- LEFT JOIN, so a missing row == unknown age (NULL), same as before.
-- =============================================================================
create or replace function public.project_customer_age_map()
returns table (customer_id uuid, age integer)
language sql
stable
as $$
  with owner_consensus as (
    -- collapse each customer's usable masked owner DOB values in ONE pass
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
      and sp.customer_id is not null
      and sp.owner_dob_approx is not null
    group by sp.customer_id
  )
  select
    cu.id as customer_id,
    coalesce(
      -- 1. exact DOB authoritative
      public.project_age_years(cu.date_of_birth),
      -- 2. owner consensus: single agreed year (month only if all agree),
      --    conflicting years => NULL (unknown)
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
  where cu.is_test = false
    and (cu.date_of_birth is not null or oc.customer_id is not null)
$$;

comment on function public.project_customer_age_map() is
  'Set-based per-customer age (customer_id, age) computed in one pass. Exact '
  'date_of_birth is authoritative; otherwise the customer''s owner_dob_approx '
  'values must agree on a single birth year (month only if all agree), else age '
  'is NULL (unknown). Reused by the match/facet engine so customer age is not '
  'recomputed per row. Same semantics as project_customer_age, no guessing.';


-- =============================================================================
-- MATCH function — customer-age filter now via a LEFT JOIN to the age map.
-- Everything else (active predicate, cash, discrete, other ranges, insured age,
-- dates) is unchanged from 20261012000001.
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
  ),
  -- Only materialize the customer-age map when a customer_age filter is present.
  cage as (
    select m.customer_id, m.age
    from public.project_customer_age_map() m
    where (select (c->'range'->'customer_age') is not null)
  )
  select sp.customer_id, sp.id as policy_id
  from public.service_policies sp
  join public.customers cu on cu.id = sp.customer_id
  cross join params p
  left join cage on cage.customer_id = cu.id
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
    -- precision-aware customer age via the set-based map (unknown => excluded)
    and (p.r->'customer_age'->>'min' is null or (cage.age is not null and cage.age >= (p.r->'customer_age'->>'min')::int))
    and (p.r->'customer_age'->>'max' is null or (cage.age is not null and cage.age <= (p.r->'customer_age'->>'max')::int))
    -- precision-aware insured age (immutable scalar; cheap)
    and (p.r->'insured_age'->>'min' is null or public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month) >= (p.r->'insured_age'->>'min')::int)
    and (p.r->'insured_age'->>'max' is null or public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month) <= (p.r->'insured_age'->>'max')::int)
    and public.project_date_match(sp.issue_date,              p.dt->'issue_date')
    and public.project_date_match(sp.policy_termination_date, p.dt->'termination_date')
    and public.project_date_match(sp.surrender_end_date,      p.dt->'surrender_end_date')
$$;


-- =============================================================================
-- FACETS — customer-age range bounds now come from the age map joined to the
-- matched customers (one map build), not a per-row scalar. Discrete facets and
-- the other range/insured bounds are unchanged from 20261012000001.
-- =============================================================================
-- =============================================================================
-- Helper: build an in-memory SQL predicate over the _pop temp table for the
-- selected discrete facets in a criteria jsonb, optionally EXCLUDING one facet
-- (used so a facet's own value list reflects the other filters but not itself).
-- Values are quoted safely with quote_literal. Returns 'true' when nothing is
-- selected. The column names match the _pop columns built in the facets fn.
-- =============================================================================
create or replace function public._pop_discrete_pred(c jsonb, p_exclude text)
returns text
language plpgsql
immutable
as $$
declare
  map jsonb := jsonb_build_object(
    'agency','agency','carrier','carrier','product_type','product_type',
    'term_length','term_length','rate_class','rate_class',
    'customer_segment','segment','insured_state','insured_state');
  fid text;
  fcol text;
  arr jsonb;
  vals text;
  clauses text[] := array[]::text[];
begin
  if c->'discrete' is null then return 'true'; end if;
  for fid in select jsonb_object_keys(c->'discrete') loop
    if p_exclude is not null and fid = p_exclude then continue; end if;
    if not (map ? fid) then continue; end if;
    arr := c->'discrete'->fid;
    if arr is null or jsonb_array_length(arr) = 0 then continue; end if;
    fcol := map->>fid;
    select string_agg(quote_literal(x), ',') into vals
    from jsonb_array_elements_text(arr) as t(x);
    clauses := clauses || format('(%I in (%s))', fcol, vals);
  end loop;
  if array_length(clauses, 1) is null then return 'true'; end if;
  return array_to_string(clauses, ' and ');
end
$$;


-- The facets function previously called project_population_matches up to 9
-- times (one per discrete facet + range bounds + customer-age), each re-running
-- the full match scan whose coverage_status regex seq scan dominates (~0.4s).
-- That repetition — compounded by the per-row customer-age subquery — is what
-- pushed the call over the statement timeout.
--
-- This version does the expensive work exactly ONCE. It materializes a base set
-- of policies that pass EVERYTHING EXCEPT the discrete facets (active predicate,
-- cash, all range/age/date filters), with the facet columns and precomputed
-- customer age attached. The regex scan and the age map build then happen a
-- single time; every discrete facet value-list and every range bound is computed
-- in memory over that small set (≤ the active book), applying the OTHER discrete
-- selections as cheap predicates. Narrowing semantics are identical: each facet's
-- list reflects all other active filters with its own selection removed.
--
-- VOLATILE: materializes a temp table (CREATE TABLE AS), not allowed in a
-- STABLE/IMMUTABLE function. Called directly by the API, so VOLATILE is safe.
create or replace function public.project_population_facets(c jsonb)
returns jsonb
language plpgsql
volatile
as $$
declare
  result jsonb := '{"discrete":{}}'::jsonb;
  -- facet id -> the column in _pop holding that facet's value (NULL => '∅')
  discrete_facets text[][] := array[
    ['agency',           'agency'],
    ['carrier',          'carrier'],
    ['product_type',     'product_type'],
    ['term_length',      'term_length'],
    ['rate_class',       'rate_class'],
    ['customer_segment', 'segment'],
    ['insured_state',    'insured_state']
  ];
  i int;
  fid text;
  fcol text;
  -- the set of OTHER discrete predicates (every selected facet except fid)
  other_pred text;
  vals jsonb;
  rng jsonb;
  cust_age jsonb;
  all_pred text;
begin
  -- One pass: active + non-discrete filters applied, facet columns + customer
  -- age (set-based map) attached. The expensive coverage_status regex scan and
  -- the owner-DOB consensus happen once here.
  create temp table _pop on commit drop as
  select
    sp.id                             as policy_id,
    sp.customer_id                    as customer_id,
    coalesce(sp.agency_id::text, '∅') as agency,
    coalesce(sp.carrier, '∅')         as carrier,
    coalesce(sp.product_type, '∅')    as product_type,
    coalesce(sp.term_length, '∅')     as term_length,
    coalesce(sp.rate_class, '∅')      as rate_class,
    coalesce(cu.segment, '∅')         as segment,
    coalesce(sp.insured_state, '∅')   as insured_state,
    sp.face_amount                    as face_amount,
    sp.cash_value_amount              as cash_value_amount,
    sp.annual_premium                 as annual_premium,
    am.age                            as customer_age,
    public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month) as insured_age
  from public.service_policies sp
  join public.customers cu on cu.id = sp.customer_id
  left join public.project_customer_age_map() am on am.customer_id = sp.customer_id
  cross join (select
      coalesce((c->>'activeOnly')::boolean, true) as active_only,
      coalesce(c->>'cashValue', 'any')             as cash_choice,
      c->'range' as r, c->'date' as dt) p
  where sp.is_test = false
    and cu.is_test = false
    and sp.customer_id is not null
    and (not p.active_only or public.project_policy_is_active(sp.coverage_status))
    and (
      p.cash_choice = 'any'
      or (p.cash_choice = 'has'  and coalesce(sp.cash_value_amount, 0) > 0)
      or (p.cash_choice = 'none' and coalesce(sp.cash_value_amount, 0) <= 0)
    )
    and (p.r->'face_amount'->>'min' is null or sp.face_amount >= (p.r->'face_amount'->>'min')::numeric)
    and (p.r->'face_amount'->>'max' is null or sp.face_amount <= (p.r->'face_amount'->>'max')::numeric)
    and (p.r->'cash_value'->>'min' is null or sp.cash_value_amount >= (p.r->'cash_value'->>'min')::numeric)
    and (p.r->'cash_value'->>'max' is null or sp.cash_value_amount <= (p.r->'cash_value'->>'max')::numeric)
    and (p.r->'annual_premium'->>'min' is null or sp.annual_premium >= (p.r->'annual_premium'->>'min')::numeric)
    and (p.r->'annual_premium'->>'max' is null or sp.annual_premium <= (p.r->'annual_premium'->>'max')::numeric)
    and (p.r->'customer_age'->>'min' is null or (am.age is not null and am.age >= (p.r->'customer_age'->>'min')::int))
    and (p.r->'customer_age'->>'max' is null or (am.age is not null and am.age <= (p.r->'customer_age'->>'max')::int))
    and (p.r->'insured_age'->>'min' is null or public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month) >= (p.r->'insured_age'->>'min')::int)
    and (p.r->'insured_age'->>'max' is null or public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month) <= (p.r->'insured_age'->>'max')::int)
    and public.project_date_match(sp.issue_date,              p.dt->'issue_date')
    and public.project_date_match(sp.policy_termination_date, p.dt->'termination_date')
    and public.project_date_match(sp.surrender_end_date,      p.dt->'surrender_end_date');

  -- Build the in-memory predicate for ALL selected discrete facets (used for the
  -- bounds / full match), and a per-facet predicate that excludes one facet.
  all_pred := public._pop_discrete_pred(c, null);

  for i in 1 .. array_length(discrete_facets, 1) loop
    fid  := discrete_facets[i][1];
    fcol := discrete_facets[i][2];
    other_pred := public._pop_discrete_pred(c, fid);  -- all selected facets EXCEPT fid

    execute format($f$
      select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v asc), '[]'::jsonb)
      from (
        select %I as v, count(distinct customer_id) as n
        from _pop
        where %s
        group by %I
      ) s
    $f$, fcol, other_pred, fcol)
    into vals;

    result := jsonb_set(result, array['discrete', fid], coalesce(vals, '[]'::jsonb), true);
  end loop;

  -- Bounds over the fully-filtered set (all discrete selections applied).
  execute format($f$
    select jsonb_build_object(
      'face_amount',    jsonb_build_object('min', min(face_amount),       'max', max(face_amount)),
      'cash_value',     jsonb_build_object('min', min(cash_value_amount), 'max', max(cash_value_amount)),
      'annual_premium', jsonb_build_object('min', min(annual_premium),    'max', max(annual_premium)),
      'insured_age',    jsonb_build_object('min', min(insured_age),       'max', max(insured_age)),
      'customer_age',   jsonb_build_object(
                          'min', min(customer_age) filter (where customer_age is not null),
                          'max', max(customer_age) filter (where customer_age is not null))
    )
    from _pop where %s
  $f$, all_pred)
  into rng;

  result := jsonb_set(result, '{range}', coalesce(rng, '{}'::jsonb), true);

  drop table if exists _pop;
  return result;
end
$$;


grant execute on function public.project_customer_age_map() to service_role;
grant execute on function public._pop_discrete_pred(jsonb, text) to service_role;

notify pgrst, 'reload schema';
