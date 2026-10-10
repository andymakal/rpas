-- =============================================================================
-- Population Builder corrections — atomic commit + honest active classification
-- Migration: 20261011000001_population_commit_and_status.sql
--
-- Two corrections to the population engine (20261010000001):
--
-- 1. ATOMIC COMMIT. Committing a population touches three tables (project_runs,
--    project_customers, project_matches). The API route did these as separate
--    statements, so a failure partway could leave a run with no / partial
--    population. project_population_commit() performs all three in a single
--    plpgsql function body, which runs in one transaction and rolls back
--    entirely on any error — no partial run/population can survive a failure.
--
-- 2. HONEST ACTIVE CLASSIFICATION. The previous active test used a broad regex
--    that silently excluded in-force statuses — notably "Paid-Up" (caught by a
--    paid-up pattern) — and lumped genuinely ambiguous statuses in with
--    "inactive". coverage_status is dirty free text; its real distinct values on
--    the book are classified explicitly here into three classes:
--
--      terminated — clearly ended: terminated / lapse / surrender / death /
--                   deceased / expired / matured / annuitized / "paid up from a
--                   death claim" / pending. EXCLUDED from an active population.
--      active     — clearly in force: active / inforce / issued / premium waived
--                   / Paid-Up (a paid-up policy is still in force). ELIGIBLE.
--      ambiguous  — cannot be determined from this field alone. Includes the
--                   Non-Forfeiture (NFO) elections (Extended Term Insurance,
--                   Reduced Paid-Up) and carrier product/annuity codes that are
--                   not lifecycle statuses at all ("PROTECTEDPAY SEC CORE SGL",
--                   "i4LIFE GIB", "LINC 2.0 MR"). These are NOT asserted to be
--                   in force. For an active-only population they are excluded,
--                   but surfaced via project_population_ambiguous_statuses so the
--                   exclusion is reported, never silent, and never invented.
--
--    "active only" now means status class = 'active'. project_policy_is_active
--    is redefined accordingly so the whole engine (matches / summary / facets)
--    inherits the corrected classification unchanged.
--
-- Development only. Depends on 20261010000001 and the projects foundation.
-- =============================================================================


-- =============================================================================
-- 1. STATUS CLASSIFIER — explicit three-way classification of coverage_status.
-- Order matters: a death-claim "paid up" is terminated and must be tested before
-- the in-force "paid-up". Anything not matched by a clear rule is 'ambiguous'
-- rather than being assumed active or inactive.
-- =============================================================================
create or replace function public.project_policy_status_class(p_coverage_status text)
returns text
language sql
immutable
as $$
  select case
    -- Unknown / blank status: treat as ambiguous (cannot assert in force).
    when p_coverage_status is null or btrim(p_coverage_status) = '' then 'ambiguous'

    -- Clearly terminated / ended. Death-claim "paid up" is caught here first.
    when p_coverage_status ~* 'death|deceased' then 'terminated'
    when p_coverage_status ~* 'terminat|lapse|surrender|expired|matured|annuitiz' then 'terminated'
    when p_coverage_status ~* '^\s*pending\s*$' then 'terminated'

    -- Genuinely ambiguous: non-forfeiture elections and carrier product codes
    -- that are not lifecycle statuses. Cannot be safely called in force.
    when p_coverage_status ~* 'non-?for|\bNFO\b|\bRPU\b' then 'ambiguous'
    when p_coverage_status ~* 'protectedpay|i4life|linc\s|gib|sgl' then 'ambiguous'

    -- Clearly in force (including Paid-Up, which remains in force).
    when p_coverage_status ~* 'active|inforce|in force|issued|premium waived|paid.?up' then 'active'

    -- Anything else is not clearly determinable.
    else 'ambiguous'
  end
$$;

comment on function public.project_policy_status_class(text) is
  'Explicit three-way classification of the dirty coverage_status free text: '
  'terminated / active / ambiguous. Paid-Up is active (still in force); '
  'death-claim paid-up is terminated; NFO elections and carrier product codes '
  'are ambiguous (not asserted in force). Used by the active-only population.';


-- =============================================================================
-- 2. ACTIVE PREDICATE — redefined on the classifier. active-only = class 'active'
-- so ambiguous statuses are NOT counted as active, and Paid-Up IS.
-- =============================================================================
create or replace function public.project_policy_is_active(p_coverage_status text)
returns boolean
language sql
immutable
as $$
  select public.project_policy_status_class(p_coverage_status) = 'active'
$$;

comment on function public.project_policy_is_active(text) is
  'True only for the clearly in-force (active) status class. Ambiguous statuses '
  '(e.g. NFO elections) are excluded from an active-only population and reported '
  'separately via project_population_ambiguous_statuses, never silently treated '
  'as active.';


-- =============================================================================
-- 3. AMBIGUOUS-STATUS REPORT — surface the statuses that an active-only
-- population excludes because they cannot be determined. This makes the
-- exclusion explicit and auditable. It evaluates against the non-status part of
-- the criteria (is_test, customer link) so the report reflects the book being
-- filtered, independent of the activeOnly flag itself.
-- =============================================================================
create or replace function public.project_population_ambiguous_statuses()
returns table (coverage_status text, policy_count bigint)
language sql
stable
as $$
  select sp.coverage_status, count(*)::bigint
  from public.service_policies sp
  join public.customers cu on cu.id = sp.customer_id
  where sp.is_test = false
    and cu.is_test = false
    and sp.customer_id is not null
    and public.project_policy_status_class(sp.coverage_status) = 'ambiguous'
  group by sp.coverage_status
  order by count(*) desc
$$;

comment on function public.project_population_ambiguous_statuses() is
  'Coverage statuses (with policy counts) that an active-only population excludes '
  'because they cannot be safely classified as in force or terminated. Reported '
  'rather than silently decided.';


-- =============================================================================
-- 4. ATOMIC COMMIT — create run + add new customers + record all matches in one
-- transaction. plpgsql function bodies execute in a single transaction, so any
-- error (including a constraint violation partway) rolls the whole thing back:
-- no orphan run, no partial population, no partial matches.
--
-- Semantics preserved from the route:
--   * run_number = next ordinal for the project
--   * only customers NOT already in project_customers are added (existing
--     members preserved; nothing removed)
--   * every triggering policy recorded in project_matches with evidence
-- Returns a single-row summary.
-- =============================================================================
create or replace function public.project_population_commit(
  p_project_id uuid,
  p_criteria   jsonb,
  p_user       uuid
)
returns table (
  run_id            uuid,
  run_number        integer,
  matched_policies  bigint,
  matched_customers bigint,
  added_customers   bigint,
  already_in_project bigint
)
language plpgsql
as $$
declare
  v_run_id      uuid;
  v_run_number  integer;
  v_now         timestamptz := now();
  v_matched_pol bigint;
  v_matched_cust bigint;
  v_added       bigint;
begin
  -- Guard: project must exist.
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project % not found', p_project_id using errcode = 'P0002';
  end if;

  -- Materialize the match set once so every step is consistent.
  create temp table _commit_matches on commit drop as
  select m.customer_id, m.policy_id
  from public.project_population_matches(p_criteria) m;

  select count(*), count(distinct customer_id)
    into v_matched_pol, v_matched_cust
  from _commit_matches;

  -- Refuse to create an empty run.
  if v_matched_pol = 0 then
    raise exception 'Population is empty' using errcode = 'P0001';
  end if;

  -- Next run number. Qualify the column: the RETURNS TABLE OUT parameter
  -- run_number would otherwise shadow project_runs.run_number here.
  select coalesce(max(pr.run_number), 0) + 1 into v_run_number
  from public.project_runs pr where pr.project_id = p_project_id;

  -- 1. Create the run.
  insert into public.project_runs (
    project_id, run_number, criteria, started_at, started_by, completed_at, completed_by
  )
  values (
    p_project_id, v_run_number, p_criteria, v_now, p_user, v_now, p_user
  )
  returning id into v_run_id;

  -- 2. Add only customers not already in the project.
  with new_customers as (
    select distinct cm.customer_id
    from _commit_matches cm
    where not exists (
      select 1 from public.project_customers pc
      where pc.project_id = p_project_id and pc.customer_id = cm.customer_id
    )
  ), ins as (
    insert into public.project_customers (project_id, customer_id, added_by_run_id)
    select p_project_id, nc.customer_id, v_run_id from new_customers nc
    returning 1
  )
  select count(*) into v_added from ins;

  -- 3. Record every triggering policy as a match with evidence.
  insert into public.project_matches (run_id, customer_id, policy_id, reason, evidence)
  select
    v_run_id, cm.customer_id, cm.policy_id,
    'Qualified by population criteria',
    jsonb_build_object('run_number', v_run_number, 'criteria', p_criteria, 'qualified_policy_id', cm.policy_id)
  from _commit_matches cm;

  return query select
    v_run_id, v_run_number, v_matched_pol, v_matched_cust, v_added,
    (v_matched_cust - v_added);
end
$$;

comment on function public.project_population_commit(uuid, jsonb, uuid) is
  'Atomically create a project_run, add only not-already-present customers, and '
  'record every triggering policy as a match with evidence — all in one '
  'transaction. Any failure rolls back the entire commit (no partial run or '
  'population). Raises P0001 for an empty population, P0002 for a missing project.';


-- =============================================================================
-- 5. EXECUTE grants — called by the internal admin API via service_role.
-- =============================================================================
grant execute on function public.project_policy_status_class(text)        to service_role;
grant execute on function public.project_population_ambiguous_statuses()   to service_role;
grant execute on function public.project_population_commit(uuid, jsonb, uuid) to service_role;


notify pgrst, 'reload schema';
