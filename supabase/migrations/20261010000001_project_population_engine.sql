-- =============================================================================
-- Project Population Builder — server-side query engine
-- Migration: 20261010000001_project_population_engine.sql
--
-- The administrative Population Builder is a faceted filter over the real
-- service_policies book (joined to customers / agencies). Faceted filtering
-- needs real SQL aggregation that the PostgREST client cannot express well:
--   * matching policy count and DISTINCT customer count for the current criteria
--   * per-facet available values WITH counts, where each facet's list reflects
--     all the OTHER active filters (classic faceted narrowing)
--   * the matched (customer, policy) set to commit into a run
--
-- So the logic lives in SQL as a small set of functions keyed off a single
-- criteria jsonb (the exact snapshot persisted in project_runs.criteria):
--
--   project_population_filter_sql()  — internal: not a function, documented
--                                      shape of the criteria jsonb (see below).
--   project_population_matches(c)    — returns (customer_id, policy_id) rows that
--                                      match the criteria. The one authoritative
--                                      definition of the active predicate and
--                                      every facet filter; everything else is
--                                      built on top of it.
--   project_population_summary(c)    — policy_count + distinct customer_count.
--   project_population_facets(c)     — jsonb: for each discrete facet, the
--                                      available values + counts computed with
--                                      the OTHER facets applied; for each range
--                                      facet, the data min/max over the current
--                                      population.
--
-- CRITERIA JSONB SHAPE (mirrors src/lib/projects/population-criteria.ts):
--   {
--     "activeOnly": true,                      -- default true when absent
--     "cashValue": "any" | "has" | "none",
--     "discrete": { "<facet>": ["v1","v2"] },  -- OR within a facet
--     "range":    { "<facet>": {"min":n,"max":n} },
--     "date":     { "<facet>": {"mode":"before|after|between","from":"","to":""} }
--   }
-- Facets AND together. Discrete facets: agency, carrier, product_type,
-- term_length, rate_class, customer_segment, insured_state. Range facets:
-- face_amount, cash_value, annual_premium, customer_age, insured_age. Date
-- facets: issue_date, termination_date, surrender_end_date.
--
-- PHI: age facets operate on age derived from DOB; no DOB is returned anywhere.
--
-- Depends on: service_policies, customers, agencies, project_runs/customers/
--             matches (projects foundation). SECURITY DEFINER so the internal
--             admin API (service-role) and the engine share one definition;
--             execute granted to service_role only.
-- =============================================================================


-- =============================================================================
-- Active-policy predicate
-- coverage_status is dirty free text ("Active (Inforce)", "Active", "active",
-- "Issued", ...). "Active" means NOT matching any terminated / closed pattern.
-- Centralized here so every function shares one definition.
-- =============================================================================
create or replace function public.project_policy_is_active(p_coverage_status text)
returns boolean
language sql
immutable
as $$
  select p_coverage_status is null
      or p_coverage_status !~* '(terminat|lapse|surrender|death|deceased|expired|matured|annuitized|non-?for|paid.?up|claim|conversion|pending)'
$$;

comment on function public.project_policy_is_active(text) is
  'Normalized active-policy test over the dirty coverage_status free text: '
  'active = not matching a terminated/closed pattern.';


-- =============================================================================
-- Age helper — whole years from a date to today. NULL-safe. Never returns DOB.
-- =============================================================================
create or replace function public.project_age_years(p_dob date)
returns integer
language sql
immutable
as $$
  -- Whole years from DOB to today. Ages outside a plausible human range are
  -- treated as unknown (NULL) so bad DOB data (e.g. year 0001 placeholders)
  -- cannot poison age filters or slider bounds. Never returns the DOB itself.
  select case
    when p_dob is null then null
    else (
      case
        when extract(year from age(current_date, p_dob))::int between 0 and 120
          then extract(year from age(current_date, p_dob))::int
        else null
      end
    )
  end
$$;


-- =============================================================================
-- Date facet matcher — before / after / between (inclusive). NULL spec => pass.
-- A policy whose date column is NULL never matches an active date filter.
-- Defined before the match function that uses it (SQL bodies are validated at
-- creation time, so referenced functions must already exist).
-- =============================================================================
create or replace function public.project_date_match(p_value date, p_spec jsonb)
returns boolean
language sql
immutable
as $$
  select case
    when p_spec is null then true
    when (p_spec->>'from') is null and (p_spec->>'to') is null then true
    when p_value is null then false
    when p_spec->>'mode' = 'before'  then p_value <= (p_spec->>'to')::date
    when p_spec->>'mode' = 'after'   then p_value >= (p_spec->>'from')::date
    when p_spec->>'mode' = 'between' then
         (p_spec->>'from' is null or p_value >= (p_spec->>'from')::date)
     and (p_spec->>'to'   is null or p_value <= (p_spec->>'to')::date)
    else true
  end
$$;


-- =============================================================================
-- CORE: matched (customer_id, policy_id) rows for a criteria jsonb.
-- is_test = false is always enforced. Only policies linked to a customer are
-- eligible for a population (a project adds customers), so customer_id not null.
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
    -- default population: active policies only
    and (not p.active_only or public.project_policy_is_active(sp.coverage_status))
    -- cash value quick choice
    and (
      p.cash_choice = 'any'
      or (p.cash_choice = 'has'  and coalesce(sp.cash_value_amount, 0) > 0)
      or (p.cash_choice = 'none' and coalesce(sp.cash_value_amount, 0) <= 0)
    )
    -- ── discrete facets (OR within, AND across). Absent/empty => no filter.
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
    -- ── range facets (inclusive, open-ended bounds allowed)
    and (p.r->'face_amount'->>'min' is null or sp.face_amount >= (p.r->'face_amount'->>'min')::numeric)
    and (p.r->'face_amount'->>'max' is null or sp.face_amount <= (p.r->'face_amount'->>'max')::numeric)
    and (p.r->'cash_value'->>'min' is null or sp.cash_value_amount >= (p.r->'cash_value'->>'min')::numeric)
    and (p.r->'cash_value'->>'max' is null or sp.cash_value_amount <= (p.r->'cash_value'->>'max')::numeric)
    and (p.r->'annual_premium'->>'min' is null or sp.annual_premium >= (p.r->'annual_premium'->>'min')::numeric)
    and (p.r->'annual_premium'->>'max' is null or sp.annual_premium <= (p.r->'annual_premium'->>'max')::numeric)
    and (p.r->'customer_age'->>'min' is null or public.project_age_years(cu.date_of_birth) >= (p.r->'customer_age'->>'min')::int)
    and (p.r->'customer_age'->>'max' is null or public.project_age_years(cu.date_of_birth) <= (p.r->'customer_age'->>'max')::int)
    and (p.r->'insured_age'->>'min' is null or public.project_age_years(sp.insured_dob) >= (p.r->'insured_age'->>'min')::int)
    and (p.r->'insured_age'->>'max' is null or public.project_age_years(sp.insured_dob) <= (p.r->'insured_age'->>'max')::int)
    -- ── date facets (before / after / between, inclusive)
    and public.project_date_match(sp.issue_date,              p.dt->'issue_date')
    and public.project_date_match(sp.policy_termination_date, p.dt->'termination_date')
    and public.project_date_match(sp.surrender_end_date,      p.dt->'surrender_end_date')
$$;

comment on function public.project_population_matches(jsonb) is
  'Authoritative (customer_id, policy_id) match set for a population criteria '
  'jsonb. is_test=false enforced; only customer-linked policies are eligible.';


-- =============================================================================
-- SUMMARY — matching policy count + distinct customer count.
-- =============================================================================
create or replace function public.project_population_summary(c jsonb)
returns table (policy_count bigint, customer_count bigint)
language sql
stable
as $$
  select count(*)::bigint, count(distinct m.customer_id)::bigint
  from public.project_population_matches(c) m
$$;


-- =============================================================================
-- FACETS — for a given criteria, return each discrete facet's available values
-- with counts (DISTINCT customers per value), each computed with that facet's
-- own selection REMOVED (so a user can still see/expand sibling values) but all
-- other facets applied. Range facets return the data min/max over the full
-- matched population. Count semantics are customer-based to match the headline.
-- =============================================================================
create or replace function public.project_population_facets(c jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  -- seed with an empty discrete object so jsonb_set can place each facet leaf
  -- (jsonb_set does not create intermediate parent keys).
  result jsonb := '{"discrete":{}}'::jsonb;
  facet record;
  -- discrete facets: id, backing expression over sp/cu
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
  -- Discrete facets: strip the facet's own selection, then count by value.
  for i in 1 .. array_length(discrete_facets, 1) loop
    fid   := discrete_facets[i][1];
    fexpr := discrete_facets[i][2];

    -- criteria with this facet's discrete selection removed
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

  -- Range facets: data bounds over the current matched population (full criteria).
  select jsonb_build_object(
    'face_amount',    jsonb_build_object('min', min(sp.face_amount),       'max', max(sp.face_amount)),
    'cash_value',     jsonb_build_object('min', min(sp.cash_value_amount), 'max', max(sp.cash_value_amount)),
    'annual_premium', jsonb_build_object('min', min(sp.annual_premium),    'max', max(sp.annual_premium)),
    'customer_age',   jsonb_build_object('min', min(public.project_age_years(cu.date_of_birth)), 'max', max(public.project_age_years(cu.date_of_birth))),
    'insured_age',    jsonb_build_object('min', min(public.project_age_years(sp.insured_dob)),    'max', max(public.project_age_years(sp.insured_dob)))
  )
  into rng
  from public.service_policies sp
  join public.customers cu on cu.id = sp.customer_id
  join public.project_population_matches(c) m on m.policy_id = sp.id;

  result := jsonb_set(result, '{range}', coalesce(rng, '{}'::jsonb), true);

  return result;
end
$$;

comment on function public.project_population_facets(jsonb) is
  'Faceted narrowing: per-discrete-facet available values + distinct-customer '
  'counts (that facet''s own selection removed, others applied) and range-facet '
  'data bounds for the current population.';


-- =============================================================================
-- EXECUTE grants — engine is called by the internal admin API via service_role.
-- =============================================================================
grant execute on function public.project_policy_is_active(text)       to service_role;
grant execute on function public.project_age_years(date)              to service_role;
grant execute on function public.project_date_match(date, jsonb)      to service_role;
grant execute on function public.project_population_matches(jsonb)    to service_role;
grant execute on function public.project_population_summary(jsonb)    to service_role;
grant execute on function public.project_population_facets(jsonb)     to service_role;


notify pgrst, 'reload schema';
