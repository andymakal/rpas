-- =============================================================================
-- Project-scoped operational work-routing for Bob on the Q4 1035 Review project
-- Migration: 20261112000001_bob_operational_routing_q4_1035_review.sql
--
-- PROBLEM (verified against the live databases, not assumed):
--   My Work availability is gated ENTIRELY by capability work-routing
--   (producer_work_functions), never by a project Team responsibility
--   (project_participants.roles[]). Bob holds the operational project
--   responsibilities on the active Permanent Policy Review project ("Q4 1035
--   Review" in production) -- operations_manager / operations -- but his ONLY
--   routable producer_work_functions row is ('determination','primary'),
--   agency-wide. So he can make the producer determination but cannot perform
--   the operational work he is responsible for and expects Angie and Dulce to
--   perform: Outreach (introductory email + calling), Contact Research, and
--   Operations Preparation. Angie and Dulce already hold the routable rows that
--   let them work those activities.
--
-- CORRECTION (the smallest necessary, and deliberately narrow):
--   Give Bob PROJECT-SCOPED routable rows (assignment_type 'primary',
--   project_id = the operational project) for exactly the three operational
--   activities he is missing: outreach, research, operations_prep. This makes
--   those activities actionable for Bob in My Work for THIS project only.
--
-- WHY PROJECT-SCOPED, AND ONLY BOB:
--   * It grants no agency-wide capability -- the rows carry a project_id, so
--     eligibility applies only within the targeted project (isEligibleFor /
--     canActOnItem in src/lib/capabilities/work-functions.ts).
--   * It changes no other employee's responsibilities or routing: it touches
--     only Bob's producer_work_functions, and only for the activities he lacks.
--   * determination is left untouched (Bob already holds it agency-wide).
--
-- HOW THE TARGET PROJECT IS RESOLVED (data-keyed, environment-portable):
--   The project is NOT hardcoded by id or name (the name differs between
--   production -- "Q4 1035 Review" -- and the development clone). It is resolved
--   from DATA: every ACTIVE project that CONTAINS the review_preparation
--   workflow (the review surfaces the app itself resolves this way) AND on which
--   Bob holds an operational project responsibility (operations_manager or
--   operations). This self-targets exactly the project(s) Bob operates, in any
--   environment, and is a clean no-op where none match.
--
-- SAFETY:
--   Idempotent (ON CONFLICT on the project-scoped partial unique index
--   producer_work_functions_project_key). Re-runnable. source = 'manual' so the
--   corrective-cleanup migration never removes it. Creates nothing when Bob,
--   the activities, or a matching project are absent. No customer data touched;
--   preserves all project membership and existing routing.
--
-- Depends on: 20261021000001 (producer_work_functions + work_functions),
--             20261102000001 (project_workflows), and the project team rows.
-- =============================================================================

do $$
declare
  p_bob uuid := '55c0e564-35d1-4bcc-888d-8edaa4e2fdf7';
  v_proj uuid;
  v_wf uuid;
  v_activities text[] := array['outreach','research','operations_prep'];
  v_key text;
  v_count int := 0;
begin
  -- Bob must exist; otherwise a clean no-op.
  if not exists (select 1 from public.producers where id = p_bob) then
    raise notice 'Bob not found; skipping operational routing correction.';
    return;
  end if;

  -- Resolve the operational project(s) from data: active, contains the
  -- review_preparation workflow, and Bob holds an operational responsibility.
  for v_proj in
    select distinct p.id
    from public.projects p
    join public.project_workflows pw on pw.project_id = p.id
    join public.workflows w on w.id = pw.workflow_id and w.key = 'review_preparation'
    join public.project_participants pp
      on pp.project_id = p.id and pp.producer_id = p_bob
    where p.status = 'active'
      and (pp.roles && array['operations_manager','operations']::text[])
  loop
    foreach v_key in array v_activities
    loop
      select id into v_wf
      from public.work_functions
      where canonical_key = v_key and is_active
      limit 1;

      if v_wf is null then
        continue; -- activity not present in this environment's catalog
      end if;

      insert into public.producer_work_functions
        (producer_id, work_function_id, assignment_type, project_id, source)
      values (p_bob, v_wf, 'primary', v_proj, 'manual')
      on conflict (producer_id, work_function_id, project_id)
        where project_id is not null
        do update set assignment_type = 'primary', updated_at = now();

      v_count := v_count + 1;
    end loop;
  end loop;

  raise notice 'Bob operational routing: % project-activity rows ensured.', v_count;
end
$$;

notify pgrst, 'reload schema';
