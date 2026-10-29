-- =============================================================================
-- Give Eunice equivalent access to Dulce on the "Q4 1035 initiative" project
-- Migration: 20261123000001_eunice_q4_1035_initiative_access.sql
--
-- PROBLEM (verified against the live development database, not assumed):
--   Eunice Velez was intended to be added to the Q4 1035 project with the same
--   standing as Dulce Velazquez, but she cannot see the available work -- in
--   particular the DUE CALLS (ready-to-call items, call_reason 'no-response')
--   are missing from both her Available Work list and the All view, while Dulce
--   sees them. Inspection of the live data showed WHY:
--
--     * Dulce holds a ROUTABLE capability row ('outreach','primary') AGENCY-WIDE
--       (project_id null) plus project-scoped 'research' / 'operations_prep'.
--     * Eunice holds NO producer_work_functions rows at all, and NO
--       project_participants row on any project.
--
--   Work availability (Available Work / My Work / the gated call populations
--   such as "calls-due") is gated ENTIRELY by capability work-routing
--   (producer_work_functions), never by a project Team responsibility
--   (project_participants.roles[]) -- see src/lib/capabilities/work-functions.ts
--   (canActOnItem / isEligibleFor / classifyCapability) and the population gate
--   in src/app/api/stewardship/route.ts. The unscoped board lists rows to
--   everyone, but due calls reach a worker only through the capability-gated
--   population path, so a producer with no routable 'outreach' assignment gets
--   an empty due-calls list even though the work exists. This is the same class
--   of gap corrected for Bob in 20261112000001; here the subject is Eunice and
--   the target is the Q4 1035 initiative project.
--
-- CORRECTION (smallest necessary, deliberately narrow and project-scoped):
--   1. Add Eunice as a project participant on "Q4 1035 initiative" with the
--      SAME responsibility set Dulce holds there (roles = {operations}), so her
--      Team standing genuinely matches Dulce's.
--   2. Give Eunice PROJECT-SCOPED routable rows (assignment_type 'primary',
--      project_id = the Q4 1035 initiative) for the operational activities that
--      gate the available work on this project: outreach, research,
--      operations_prep. 'outreach' is the one that surfaces the due calls.
--
-- WHY PROJECT-SCOPED (not agency-wide like Dulce's 'outreach'):
--   The requirement is that equivalent project assignment yields the same
--   ELIGIBLE work on THIS project WITHOUT exposing work from other projects and
--   WITHOUT weakening authorization. A project-scoped row does exactly that:
--   eligibility applies only within the Q4 1035 initiative (canActOnItem tests
--   the item's own project set), so Eunice sees this project's due calls and no
--   other project's work. Authorization is unchanged -- she receives a real
--   routable assignment, the same gate Dulce passes, not a relaxed check.
--   Scoping to this project rather than mirroring Dulce's broader agency-wide
--   'outreach' is the more conservative grant and fully satisfies the ask.
--
-- SAFETY:
--   Idempotent. The participant upsert is ON CONFLICT (project_id, producer_id);
--   the capability upserts are ON CONFLICT on the project-scoped partial unique
--   index producer_work_functions_project_key. source = 'manual' so the
--   corrective-cleanup migration never removes the rows. Creates nothing when
--   Eunice, the activities, or the project are absent (clean no-op). Touches no
--   customer data and no other employee's rows; preserves all existing
--   membership and routing.
--
-- Depends on: 20261021000001 (producer_work_functions + work_functions),
--             20261109000001 (project_participants.roles[]),
--             20261110000001 (Q4 1035 initiative team).
-- =============================================================================

do $$
declare
  p_eunice uuid := '653614ba-1b01-4608-a4de-83b6f2459518';
  proj_q4  uuid;
  v_activities text[] := array['outreach','research','operations_prep'];
  v_key text;
  v_wf uuid;
  v_count int := 0;
begin
  -- Eunice must exist; otherwise a clean no-op.
  if not exists (select 1 from public.producers where id = p_eunice) then
    raise notice 'Eunice not found; skipping access correction.';
    return;
  end if;

  -- Resolve the project by name (the development clone uses this exact name).
  select id into proj_q4
  from public.projects
  where lower(name) = lower('Q4 1035 initiative')
  limit 1;

  if proj_q4 is null then
    raise notice 'Q4 1035 initiative project not found; skipping access correction.';
    return;
  end if;

  -- ── 1. Team participation: same responsibility set as Dulce ({operations}) ──
  insert into public.project_participants (project_id, producer_id, roles, role, note)
  values (proj_q4, p_eunice, array['operations'], null, 'Operations')
  on conflict (project_id, producer_id)
    do update set roles = excluded.roles, role = null, note = excluded.note;

  -- ── 2. Project-scoped routable capability for the operational activities ────
  -- 'outreach' is the activity that surfaces the due calls; 'research' and
  -- 'operations_prep' complete the operational remit Dulce works on this project.
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
    values (p_eunice, v_wf, 'primary', proj_q4, 'manual')
    on conflict (producer_id, work_function_id, project_id)
      where project_id is not null
      do update set assignment_type = 'primary', updated_at = now();

    v_count := v_count + 1;
  end loop;

  raise notice 'Eunice Q4 1035 access: participant ensured and % capability rows ensured.', v_count;
end
$$;

notify pgrst, 'reload schema';
