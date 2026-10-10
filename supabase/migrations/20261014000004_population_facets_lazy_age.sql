-- =============================================================================
-- Population Builder — lazy / on-demand age in facets
-- Migration: 20261014000004_population_facets_lazy_age.sql
--
-- Even after computing age only for the matched set, project_population_facets
-- STILL resolved customer-age (and insured-age) bounds on every call — e.g.
-- Cassidy + Issue Date <= 2016 computed owner-DOB consensus for the matched
-- customers just to render the screen, although the user had not opened or
-- applied an age facet. That DOB work is the remaining cost.
--
-- This makes age strictly on-demand. project_population_facets gains an
-- age_facets text[] parameter naming the age facets whose bounds the caller
-- actually needs (because the user OPENED them). Age bounds are computed ONLY
-- when that facet is requested OR its criterion is applied. With no age facet
-- open and no age criterion, the function does ZERO DOB/age work: the base
-- working set carries no age columns, and the age-bounds / age-resolution steps
-- are skipped entirely.
--
-- Unchanged: base filtering (agency/carrier/product_type/issue_date/term_length/
-- amounts/cash/dates) never touches age; the customer-age FILTER (when a
-- criterion is applied) still narrows the set via project_customer_age_for; DOB
-- precision/data-integrity rules are intact (exact DOB authoritative; month/year
-- and year-only supported without inventing a day; conflicting owner birth years
-- => NULL). No statement_timeout change, no persisted age.
--
-- A 1-arg overload is kept (delegates with no age facets requested) so existing
-- callers keep working. Development only.
-- =============================================================================

create or replace function public.project_population_facets(c jsonb, age_facets text[])
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
  has_customer_age_crit boolean := (c->'range'->'customer_age') is not null;
  has_insured_age_crit  boolean := (c->'range'->'insured_age') is not null;
  want_customer_age boolean := has_customer_age_crit or ('customer_age' = any(coalesce(age_facets, '{}')));
  want_insured_age  boolean := has_insured_age_crit  or ('insured_age'  = any(coalesce(age_facets, '{}')));
begin
  -- Base working set: ALL base-policy predicates EXCEPT the discrete facets.
  -- No age columns and no age predicates here unless an age CRITERION is applied
  -- (handled below). Base filtering never touches DOB/age logic.
  create temp table _src on commit drop as
  select s.policy_id, s.customer_id, s.agency, s.carrier, s.product_type,
         s.term_length, s.rate_class, s.segment, s.insured_state,
         s.face_amount, s.cash_value_amount, s.annual_premium,
         s.insured_age
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
    and public.project_date_match(s.issue_date,              p.dt->'issue_date')
    and public.project_date_match(s.policy_termination_date, p.dt->'termination_date')
    and public.project_date_match(s.surrender_end_date,      p.dt->'surrender_end_date');

  -- Insured-age FILTER (only when the criterion is applied). insured_age is a
  -- cheap policy-local scalar from the view; apply it directly.
  if has_insured_age_crit then
    delete from _src
    where not (
      insured_age is not null
      and (c->'range'->'insured_age'->>'min' is null or insured_age >= (c->'range'->'insured_age'->>'min')::int)
      and (c->'range'->'insured_age'->>'max' is null or insured_age <= (c->'range'->'insured_age'->>'max')::int)
    );
  end if;

  -- Customer-age FILTER (only when the criterion is applied). Resolve ages for
  -- just _src's customers (bounded), then narrow.
  if has_customer_age_crit then
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

  -- Discrete facet value lists (customer counts; no age work).
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

  -- Non-age bounds over the fully-filtered set (cheap, policy-local columns).
  execute format($f$
    select jsonb_build_object(
      'face_amount',    jsonb_build_object('min', min(face_amount),       'max', max(face_amount)),
      'cash_value',     jsonb_build_object('min', min(cash_value_amount), 'max', max(cash_value_amount)),
      'annual_premium', jsonb_build_object('min', min(annual_premium),    'max', max(annual_premium))
    )
    from _src where %s
  $f$, all_pred)
  into rng;

  -- Insured-age bounds: ONLY when the facet is opened or its criterion applied.
  if want_insured_age then
    execute format($f$
      select jsonb_build_object(
        'min', min(insured_age) filter (where insured_age is not null),
        'max', max(insured_age) filter (where insured_age is not null))
      from _src where %s
    $f$, all_pred)
    into vals;
    rng := jsonb_set(rng, '{insured_age}', coalesce(vals, jsonb_build_object('min', null, 'max', null)), true);
  end if;

  -- Customer-age bounds: ONLY when the facet is opened or its criterion applied.
  -- Resolve ages for just the matched set's distinct customers.
  if want_customer_age then
    execute format($f$ select array_agg(distinct customer_id) from _src where %s $f$, all_pred)
    into matched_ids;
    select min(a.age), max(a.age) into age_min, age_max
    from public.project_customer_age_for(matched_ids) a;
    rng := jsonb_set(rng, '{customer_age}', jsonb_build_object('min', age_min, 'max', age_max), true);
  end if;

  result := jsonb_set(result, '{range}', coalesce(rng, '{}'::jsonb), true);

  drop table if exists _src;
  return result;
end
$$;


-- Backward-compatible 1-arg overload: no age facets requested. Age bounds are
-- then produced only if an age criterion is applied.
create or replace function public.project_population_facets(c jsonb)
returns jsonb
language sql
volatile
as $$
  select public.project_population_facets(c, '{}'::text[])
$$;


grant execute on function public.project_population_facets(jsonb, text[]) to service_role;
grant execute on function public.project_population_facets(jsonb)         to service_role;

notify pgrst, 'reload schema';
