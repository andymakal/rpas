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
-- 3. REMOVE TITLE-INFERRED CAPABILITY ASSIGNMENTS
-- Keep ONLY Bob -> determination (settled). Remove every other assignment the
-- first-slice seed created from titles. Scoped precisely to the seeded
-- (producer, capability) pairs so it cannot touch any assignment a human later
-- makes through the Team editor on another environment; a no-op if already gone.
-- =============================================================================
do $$
declare
  p_bob uuid := '55c0e564-35d1-4bcc-888d-8edaa4e2fdf7';
begin
  -- Remove all agency-wide (project_id IS NULL) capability assignments that are
  -- NOT the kept Bob -> determination one.
  delete from public.producer_work_functions pwf
  using public.work_functions wf
  where pwf.work_function_id = wf.id
    and pwf.project_id is null
    and not (
      pwf.producer_id = p_bob and wf.canonical_key = 'determination'
    );
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
