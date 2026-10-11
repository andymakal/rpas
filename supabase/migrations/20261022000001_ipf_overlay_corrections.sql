-- =============================================================================
-- IPF overlay corrections — management authority, project ownership, and
-- removal of title-inferred capabilities
-- Migration: 20261022000001_ipf_overlay_corrections.sql
--
-- Corrects material issues in 20261021000001_ipf_work_overlay:
--
--   1. MANAGEMENT AUTHORITY. Today's Focus is management direction, but the
--      internal auth model has a single 'admin' role shared by all internal
--      staff, so it cannot distinguish management from line staff. Add the
--      evidenced producers.is_management responsibility fact (nullable, like the
--      qualification flags — a settled responsibility, NOT a job title) and set
--      it true only where management is a settled decision.
--
--   2. PROJECT OWNERSHIP / RESPONSIBILITY, kept DISTINCT from participation and
--      escalation. Add project_participants.role so a participant's project
--      responsibility (owner, operations manager, senior producer, ...) is
--      explicit. Ownership and operations-management are responsibilities on the
--      participation row; the escalation path stays its own ordered table.
--
--   3. REMOVE TITLE-INFERRED CAPABILITIES. The first-slice seed assigned
--      outreach / research / operations_prep / office_support from job titles
--      alone. Capabilities must come from actual evidence or a settled decision,
--      not a title, so those assignments are removed. The ONLY capability kept
--      is Bob -> determination, which is a SETTLED decision codified in the 1035
--      workflow (src/lib/projects/review-1035.ts: the determination is "Bob's
--      turn"); his is_life_licensed fact is required by that responsibility.
--      The capability catalog and the schema are unchanged; capabilities are now
--      simply unassigned until management assigns them (the Team editor is the
--      future home for that), which is the honest state.
--
--   4. STAFFING / ACCOUNTABILITY (settled decisions):
--        * Bob owns the 1035 project AND serves as operations manager.
--        * Angie is the FIRST operational escalation contact (unchanged).
--        * Ashley is a SENIOR PRODUCER, not the 1035 operations manager (the
--          prior seed mislabeled her "Operations manager").
--
-- SAFE REPLAY + PRODUCTION PORTABILITY: every step is idempotent and guarded.
-- Columns use ADD COLUMN IF NOT EXISTS. Capability removal is scoped to the
-- exact (producer, capability) pairs the prior seed created and is a no-op if
-- they are already gone. Staffing updates are guarded on the real 1035 project
-- existing, and on each producer existing, so a replay against production (which
-- may not yet have that project or those producers) is a clean no-op rather than
-- an error. Nothing here depends on the prior seed having run.
--
-- Already applied to development; this reconciles the corrections with the live
-- development schema. Depends on 20261021000001_ipf_work_overlay.
-- =============================================================================


-- =============================================================================
-- 1. MANAGEMENT RESPONSIBILITY FACT ON PRODUCERS
-- Nullable, no default: NULL/unknown and false both mean "not authorized as
-- management"; only an affirmative true authorizes setting Today's Focus. This
-- is a settled responsibility fact, not a title.
-- =============================================================================
alter table public.producers
  add column if not exists is_management boolean;

comment on column public.producers.is_management is
  'Management responsibility fact: whether this team member is authorized to set '
  'management direction (Today''s Focus). NULL/unknown and false both mean not '
  'authorized; only true authorizes. A settled responsibility, not a job title.';


-- =============================================================================
-- 2. PROJECT PARTICIPATION ROLE
-- An explicit, optional project responsibility on the participation row, kept
-- distinct from the escalation path. Open text (not a hard enum) so new project
-- types can describe their own responsibilities without a schema change; the
-- values used today are 'owner', 'operations_manager', 'senior_producer',
-- 'operations', 'outreach'.
-- =============================================================================
alter table public.project_participants
  add column if not exists role text;

comment on column public.project_participants.role is
  'Optional project responsibility for this participant (e.g. owner, '
  'operations_manager, senior_producer, operations, outreach). Distinct from the '
  'escalation path (project_escalation_contacts) and from capability eligibility '
  '(producer_work_functions). Participation/ownership does not imply performing '
  'every activity.';


-- =============================================================================
-- 3. REMOVE TITLE-INFERRED CAPABILITY ASSIGNMENTS (provably seed-origin only)
-- The first-slice seed created a set of agency-wide capability assignments from
-- job titles. Those must be removed, but a corrective migration must NEVER
-- delete an assignment that did NOT come from its own seed (a human assignment
-- via the Team editor, or an evidence-based assignment from a later migration),
-- and must never silently change an assignment_type.
--
-- Provenance is therefore the gate: this removes a row ONLY when it is both a
-- known title-inferred (producer, capability) pair AND marked
-- source = 'migration_seed'. Any row a human/other migration created carries
-- source = 'manual' (the column default) and is left completely untouched —
-- even for the very same (producer, capability) pair and whatever its
-- assignment_type. On a fresh replay, section 8 of 20261021000001 now seeds only
-- Bob -> determination (also 'migration_seed', and deliberately excluded below),
-- so there are no title-inferred seed rows to remove and this is a clean no-op;
-- it also no-ops in any environment that never ran the historical seed or whose
-- producers differ.
--
-- (The source column itself is added by 20261021000001 for a fresh replay, and
-- backfilled on the already-applied development database by
-- 20261024000001_capability_source_provenance so this guard has a column to
-- read. If the column is somehow absent, this block is skipped rather than
-- failing.)
-- =============================================================================
do $$
declare
  -- the exact title-inferred seeded pairs (producer id, canonical_key),
  -- excluding the kept Bob -> determination row.
  seeded constant text[][] := array[
    -- Gabe (7a8ffc03)
    ['7a8ffc03-a89a-4dfc-96d9-2cb552ca6036', 'outreach'],
    ['7a8ffc03-a89a-4dfc-96d9-2cb552ca6036', 'office_support'],
    -- Dulce (afc210a6)
    ['afc210a6-9974-4459-95bf-87dee6274f30', 'outreach'],
    ['afc210a6-9974-4459-95bf-87dee6274f30', 'office_support'],
    -- Nikki (dcb3c1f9)
    ['dcb3c1f9-a260-44ae-b02a-70fd000ea117', 'outreach'],
    ['dcb3c1f9-a260-44ae-b02a-70fd000ea117', 'research'],
    ['dcb3c1f9-a260-44ae-b02a-70fd000ea117', 'operations_prep'],
    -- Angie (6fbce54f)
    ['6fbce54f-5c02-4589-90b3-f4eb19248256', 'outreach'],
    ['6fbce54f-5c02-4589-90b3-f4eb19248256', 'research'],
    ['6fbce54f-5c02-4589-90b3-f4eb19248256', 'operations_prep'],
    -- Ashley (067ca02d)
    ['067ca02d-7618-4aea-84ad-9abaa5d166e0', 'operations_prep'],
    ['067ca02d-7618-4aea-84ad-9abaa5d166e0', 'office_support'],
    -- Tyler (280f5f81)
    ['280f5f81-939c-4b29-b73c-97cf05f4411d', 'office_support']
  ];
  pair text[];
  has_source boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'producer_work_functions'
      and column_name = 'source'
  ) into has_source;

  if not has_source then
    -- No provenance column: we cannot prove origin, so we must NOT delete
    -- anything (deleting blind is exactly the destructive behavior being fixed).
    return;
  end if;

  foreach pair slice 1 in array seeded loop
    delete from public.producer_work_functions pwf
    using public.work_functions wf
    where pwf.work_function_id = wf.id
      and pwf.project_id is null
      and pwf.producer_id = pair[1]::uuid
      and wf.canonical_key = pair[2]
      -- PROVENANCE GATE: only ever remove a row this migration chain seeded.
      and pwf.source = 'migration_seed';
  end loop;
end
$$;


-- =============================================================================
-- 4. STAFFING / ACCOUNTABILITY — settled decisions
-- Guarded on the real 1035 project and each producer existing, so a replay in an
-- environment without them is a clean no-op.
-- =============================================================================
do $$
declare
  p_bob     uuid := '55c0e564-35d1-4bcc-888d-8edaa4e2fdf7';
  p_angie   uuid := '6fbce54f-5c02-4589-90b3-f4eb19248256';
  p_ashley  uuid := '067ca02d-7618-4aea-84ad-9abaa5d166e0';
  proj_1035 uuid := '60d8ca7d-56fa-44e2-9cae-29a542d4eb48';
  has_proj  boolean;
begin
  -- Management authority: Bob is the operations manager (settled). Only set the
  -- flag for a producer that actually exists.
  update public.producers set is_management = true
    where id = p_bob and exists (select 1 from public.producers where id = p_bob);

  select exists(select 1 from public.projects where id = proj_1035) into has_proj;
  if not has_proj then
    return; -- no 1035 project in this environment: staffing seed is a no-op
  end if;

  -- Bob owns the 1035 project and is its operations manager. Ensure he is a
  -- participant and carries the owner + operations_manager responsibility.
  if exists (select 1 from public.producers where id = p_bob) then
    insert into public.project_participants (project_id, producer_id, role, note)
    values (proj_1035, p_bob, 'owner',
            'Project owner and operations manager; makes the candidacy determination')
    on conflict (project_id, producer_id) do update
      set role = 'owner',
          note = 'Project owner and operations manager; makes the candidacy determination';
  end if;

  -- Ashley is a SENIOR PRODUCER, not the operations manager. Correct the prior
  -- mislabel; keep her as a participant with the accurate responsibility.
  if exists (select 1 from public.producers where id = p_ashley) then
    update public.project_participants
      set role = 'senior_producer',
          note = 'Senior producer'
      where project_id = proj_1035 and producer_id = p_ashley;
  end if;

  -- Angie remains the FIRST operational escalation contact and an operations
  -- participant. (Escalation itself is in project_escalation_contacts, seeded by
  -- the prior migration as tier 1 = Angie, tier 2 = Bob; left unchanged.)
  if exists (select 1 from public.producers where id = p_angie) then
    update public.project_participants
      set role = 'operations'
      where project_id = proj_1035 and producer_id = p_angie and role is null;
  end if;
end
$$;


-- Refresh PostgREST's schema cache so the new columns are visible via the API.
notify pgrst, 'reload schema';
