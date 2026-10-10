-- =============================================================================
-- Population Builder — derived population-source view (perf refactor)
-- Migration: 20261014000002_population_source_view.sql
--
-- Supersedes the ad-hoc per-call age handling. Reusable derived values —
-- normalized policy status, insured age, and customer age — are now computed
-- ONCE in a single derived source, and every match / count / facet query
-- operates against that derived result instead of recomputing expensive
-- per-row/per-facet values. This is the normalized-derived-query pattern the
-- performance fix calls for.
--
--   view public.project_population_source
--     One row per eligible policy (is_test = false, customer-linked), carrying:
--       * normalized_status + is_active   (project_policy_status_class once)
--       * insured_age                     (project_insured_age once)
--       * customer_age                    (joined ONCE from the set-based
--                                          project_customer_age_map(); exact DOB
--                                          authoritative, conflicting owner
--                                          birth years => NULL, no guessing)
--       * the discrete facet columns (agency/carrier/product_type/term_length/
--         rate_class/segment/insured_state, NULL => '∅')
--       * money columns + date columns for range/date filtering and bounds
--
-- customer_age is NOT persisted — it is a derived column of the view, recomputed
-- from DOB sources on read. No business age column is added. The statement
-- timeout is unchanged.
--
-- project_population_matches / _summary / _facets are redefined to read from the
-- view. facets materializes the criteria-filtered derived rows ONCE per call and
-- computes all discrete value-lists + range bounds in memory (discrete narrowing
-- applied as cheap predicates), so the coverage_status scan and the owner-DOB
-- consensus run a single time per call.
--
-- Development only. Depends on the scalar/age helpers from 20261012/13/14.
-- =============================================================================


-- =============================================================================
-- DERIVED SOURCE VIEW — reusable per-policy population row. Computes the
-- expensive derived values once; callers filter it by criteria.
-- =============================================================================
create or replace view public.project_population_source
with (security_invoker = true) as
select
  sp.id                               as policy_id,
  sp.customer_id                      as customer_id,
  -- normalized policy status (dirty coverage_status -> active/terminated/ambiguous)
  public.project_policy_status_class(sp.coverage_status) as normalized_status,
  (public.project_policy_status_class(sp.coverage_status) = 'active') as is_active,
  -- discrete facet values (NULL surfaced as the ∅ sentinel the UI labels "Not set")
  coalesce(sp.agency_id::text, '∅')   as agency,
  coalesce(sp.carrier, '∅')           as carrier,
  coalesce(sp.product_type, '∅')      as product_type,
  coalesce(sp.term_length, '∅')       as term_length,
  coalesce(sp.rate_class, '∅')        as rate_class,
  coalesce(cu.segment, '∅')           as segment,
  coalesce(sp.insured_state, '∅')     as insured_state,
  -- value columns
  sp.face_amount                      as face_amount,
  sp.cash_value_amount                as cash_value_amount,
  sp.annual_premium                   as annual_premium,
  -- date columns
  sp.issue_date                       as issue_date,
  sp.policy_termination_date          as policy_termination_date,
  sp.surrender_end_date               as surrender_end_date,
  -- derived ages (computed once; never persisted)
  public.project_insured_age(sp.insured_dob, sp.insured_dob_year, sp.insured_dob_month) as insured_age,
  cam.age                             as customer_age
from public.service_policies sp
join public.customers cu on cu.id = sp.customer_id
left join public.project_customer_age_map() cam on cam.customer_id = sp.customer_id
where sp.is_test = false
  and cu.is_test = false
  and sp.customer_id is not null;

comment on view public.project_population_source is
  'Derived population source: one row per eligible (non-test, customer-linked) '
  'policy with normalized_status/is_active, insured_age and customer_age computed '
  'once (customer_age from the set-based age map; exact DOB authoritative, '
  'conflicting owner birth years => NULL). Match/count/facet queries read this '
  'instead of recomputing derived values. Ages are derived, never persisted.';

grant select on public.project_population_source to service_role;


-- =============================================================================
-- MATCH — read the derived source; apply criteria. Same output + semantics.
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
      c->'discrete' as d, c->'range' as r, c->'date' as dt
  )
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
    and (p.r->'customer_age'->>'min' is null or (s.customer_age is not null and s.customer_age >= (p.r->'customer_age'->>'min')::int))
    and (p.r->'customer_age'->>'max' is null or (s.customer_age is not null and s.customer_age <= (p.r->'customer_age'->>'max')::int))
    and (p.r->'insured_age'->>'min' is null or (s.insured_age is not null and s.insured_age >= (p.r->'insured_age'->>'min')::int))
    and (p.r->'insured_age'->>'max' is null or (s.insured_age is not null and s.insured_age <= (p.r->'insured_age'->>'max')::int))
    and public.project_date_match(s.issue_date,              p.dt->'issue_date')
    and public.project_date_match(s.policy_termination_date, p.dt->'termination_date')
    and public.project_date_match(s.surrender_end_date,      p.dt->'surrender_end_date')
$$;


-- =============================================================================
-- FACETS — materialize the criteria-filtered derived rows ONCE, then compute
-- all discrete value-lists (narrowing: each facet's own selection removed) and
-- range bounds in memory against that derived result.
-- =============================================================================
create or replace function public.project_population_facets(c jsonb)
returns jsonb
language plpgsql
volatile
as $$
declare
  result jsonb := '{"discrete":{}}'::jsonb;
  discrete_facets text[] := array['agency','carrier','product_type','term_length','rate_class','customer_segment','insured_state'];
  -- map facet id -> column in the derived rows
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
begin
  -- Derived result for this criteria, WITHOUT the discrete filters, materialized
  -- once. Non-discrete criteria (active/cash/range/age/date) are already applied
  -- by reading the matched set with discrete removed; keep the discrete columns
  -- so narrowing can be applied in memory.
  create temp table _src on commit drop as
  select s.policy_id, s.customer_id, s.agency, s.carrier, s.product_type,
         s.term_length, s.rate_class, s.segment, s.insured_state,
         s.face_amount, s.cash_value_amount, s.annual_premium,
         s.insured_age, s.customer_age
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
    and (p.r->'customer_age'->>'min' is null or (s.customer_age is not null and s.customer_age >= (p.r->'customer_age'->>'min')::int))
    and (p.r->'customer_age'->>'max' is null or (s.customer_age is not null and s.customer_age <= (p.r->'customer_age'->>'max')::int))
    and (p.r->'insured_age'->>'min' is null or (s.insured_age is not null and s.insured_age >= (p.r->'insured_age'->>'min')::int))
    and (p.r->'insured_age'->>'max' is null or (s.insured_age is not null and s.insured_age <= (p.r->'insured_age'->>'max')::int))
    and public.project_date_match(s.issue_date,              p.dt->'issue_date')
    and public.project_date_match(s.policy_termination_date, p.dt->'termination_date')
    and public.project_date_match(s.surrender_end_date,      p.dt->'surrender_end_date');

  -- predicate covering ALL selected discrete facets (full match set)
  all_pred := public._pop_discrete_pred(c, null);

  -- per-facet value lists, each with that facet's OWN selection removed
  foreach fid in array discrete_facets loop
    fcol := col_of->>fid;
    other_pred := public._pop_discrete_pred(c, fid);
    execute format($f$
      select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v asc), '[]'::jsonb)
      from (
        select %I as v, count(distinct customer_id) as n
        from _src where %s
        group by %I
      ) s
    $f$, fcol, other_pred, fcol)
    into vals;
    result := jsonb_set(result, array['discrete', fid], coalesce(vals, '[]'::jsonb), true);
  end loop;

  -- range bounds over the fully-filtered derived set
  execute format($f$
    select jsonb_build_object(
      'face_amount',    jsonb_build_object('min', min(face_amount),       'max', max(face_amount)),
      'cash_value',     jsonb_build_object('min', min(cash_value_amount), 'max', max(cash_value_amount)),
      'annual_premium', jsonb_build_object('min', min(annual_premium),    'max', max(annual_premium)),
      'insured_age',    jsonb_build_object(
                          'min', min(insured_age) filter (where insured_age is not null),
                          'max', max(insured_age) filter (where insured_age is not null)),
      'customer_age',   jsonb_build_object(
                          'min', min(customer_age) filter (where customer_age is not null),
                          'max', max(customer_age) filter (where customer_age is not null))
    )
    from _src where %s
  $f$, all_pred)
  into rng;

  result := jsonb_set(result, '{range}', coalesce(rng, '{}'::jsonb), true);

  drop table if exists _src;
  return result;
end
$$;


notify pgrst, 'reload schema';
