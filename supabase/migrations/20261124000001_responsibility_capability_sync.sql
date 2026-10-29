-- =============================================================================
-- Responsibility -> capability sync: provenance value + data reconciliation
-- Migration: 20261124000001_responsibility_capability_sync.sql
--
-- WHY (verified against the live databases, not assumed):
--   Work availability (My Work, the shared stewardship queues, the due-call
--   populations) is gated ENTIRELY by capability work-routing
--   (producer_work_functions), never by a project Team responsibility
--   (project_participants.roles[]). So adding someone to a project Team with an
--   operations responsibility granted them NO ability to do that work, and a
--   person given the same responsibility as a colleague could be silently
--   excluded from the same work (the Eunice-vs-Dulce due-calls gap, previously
--   patched per-person in 20261123000001, and the Bob gap in 20261112000001).
--
--   The application now closes this gap at the source: the Team editor
--   reconciles project-scoped capability whenever a responsibility is assigned,
--   changed, or removed (src/lib/projects/capability-sync.ts, wired into
--   src/app/api/projects/[id]/team/route.ts). Every row that reconcile creates
--   carries a new provenance value, source = 'role_sync', so it can be managed
--   (and safely revoked) without ever disturbing an agency-wide, manual, or
--   migration-seeded assignment.
--
-- THIS MIGRATION does two things:
--   1. Extends producer_work_functions.source to allow 'role_sync'.
--   2. Reconciles the EXISTING data to the state the new code produces, by
--      ESTABLISHING any role-justified project-scoped capability that a current
--      active-project participant is missing. It is purely additive: it never
--      retags, modifies, or removes an existing row, so no access is lost and no
--      deliberate 'manual' grant is disturbed.
--
-- MAPPING (mirrors src/lib/projects/responsibility-capabilities.ts, grounded in
-- the 20261112000001 precedent and the work_functions activity definitions):
--   operations / operations_manager / outreach -> outreach, research, operations_prep
--   underwriting_support                        -> operations_prep, research
--   producer / senior_producer                  -> determination  (LICENSE-GATED)
--   project_owner                               -> (nothing)
--   office_support is never established from a responsibility.
--
-- SAFETY / NO DUPLICATES / NO LOSS:
--   * Additive only. A role-justified activity is inserted as a project-scoped
--     'primary' 'role_sync' row ONLY when the participant has NO existing row
--     for that (producer, activity, project) in ANY source, AND is not already
--     covered by a routable agency-wide row for that activity (which would make
--     a project row redundant). So Dulce's and Eunice's existing rows and their
--     agency-wide outreach are left exactly as-is, and nothing is duplicated.
--   * determination (life_licensed) is attempted only when the producer
--     affirmatively holds the license, so the enforce_work_function_qualification
--     trigger is honored, never bypassed and never forced into an error.
--   * Scoped to ACTIVE projects and real participants; environment-portable
--     (keyed on roles[] and work_functions.canonical_key, not on project
--     names/ids, which differ between production and the development clone).
--   * Idempotent and re-runnable (the insert is guarded by NOT EXISTS and the
--     project-scoped partial unique index).
--
-- Depends on: 20261021000001 (producer_work_functions + work_functions + trigger),
--             20261024000001 (source provenance column),
--             20261109000001 (project_participants.roles[]).
-- =============================================================================

-- 1. Allow the new provenance value. Drop and re-add the CHECK (name-stable).
alter table public.producer_work_functions
  drop constraint if exists producer_work_functions_source_check;
alter table public.producer_work_functions
  add constraint producer_work_functions_source_check
  check (source in ('migration_seed', 'manual', 'role_sync'));

comment on column public.producer_work_functions.source is
  'Provenance: ''migration_seed'' = created by a migration demonstration seed '
  '(eligible for migration cleanup); ''role_sync'' = established by the Team '
  'editor from a project responsibility (reconciled automatically, managed only '
  'by the responsibility->capability sync); ''manual'' (default) = created by a '
  'human or an evidence-based migration (never touched by cleanup or the sync).';

-- 2. Reconcile existing data: establish missing role-justified project-scoped
--    capability for current active-project participants. Purely additive.
do $$
declare
  r record;
  v_wf uuid;
  v_required text;
  v_has boolean;
  v_count int := 0;
  -- responsibility -> activities, mirroring the application mapping.
  v_map jsonb := jsonb_build_object(
    'operations',           jsonb_build_array('outreach','research','operations_prep'),
    'operations_manager',   jsonb_build_array('outreach','research','operations_prep'),
    'outreach',             jsonb_build_array('outreach','research','operations_prep'),
    'underwriting_support', jsonb_build_array('operations_prep','research'),
    'producer',             jsonb_build_array('determination'),
    'senior_producer',      jsonb_build_array('determination')
  );
begin
  -- One row per (participant, project, justified activity), de-duplicated.
  for r in
    select distinct
      pp.producer_id,
      pp.project_id,
      act.activity as canonical_key
    from public.project_participants pp
    join public.projects pr on pr.id = pp.project_id and pr.status = 'active'
    cross join lateral (
      -- expand this participant's roles[] into the activities they justify
      select distinct jsonb_array_elements_text(v_map -> role_key) as activity
      from unnest(coalesce(pp.roles, array[]::text[])) as role_key
      where v_map ? role_key
    ) act
  loop
    -- Resolve the activity to a catalog work_function (skip if absent here).
    select id, required_qualification into v_wf, v_required
      from public.work_functions
      where canonical_key = r.canonical_key and is_active
      limit 1;
    if v_wf is null then
      continue;
    end if;

    -- License gate: for a gated activity, only proceed when the producer
    -- affirmatively holds the required qualification (true; NULL/false fail),
    -- exactly as the trigger would enforce.
    if v_required is not null then
      select case v_required
               when 'life_licensed'            then is_life_licensed
               when 'securities_licensed'      then is_securities_licensed
               when 'registered_support_staff' then is_registered_support_staff
             end
        into v_has
        from public.producers where id = r.producer_id;
      if v_has is distinct from true then
        continue; -- not licensed; leave the gated activity unestablished
      end if;
    end if;

    -- Skip when a row already exists for this (producer, activity) on THIS
    -- project in ANY source (never duplicate or overwrite an explicit grant).
    if exists (
      select 1 from public.producer_work_functions
      where producer_id = r.producer_id
        and work_function_id = v_wf
        and project_id = r.project_id
    ) then
      continue;
    end if;

    -- Skip when a routable agency-wide row already covers the activity (a
    -- project-scoped grant would be redundant).
    if exists (
      select 1 from public.producer_work_functions
      where producer_id = r.producer_id
        and work_function_id = v_wf
        and project_id is null
        and assignment_type in ('primary','support')
    ) then
      continue;
    end if;

    -- Establish the project-scoped routable capability, owned by the sync.
    insert into public.producer_work_functions
      (producer_id, work_function_id, assignment_type, project_id, source)
    values (r.producer_id, v_wf, 'primary', r.project_id, 'role_sync')
    on conflict (producer_id, work_function_id, project_id)
      where project_id is not null
      do nothing;

    v_count := v_count + 1;
  end loop;

  raise notice 'Responsibility->capability reconcile: % project-scoped role_sync rows established.', v_count;
end
$$;

notify pgrst, 'reload schema';
