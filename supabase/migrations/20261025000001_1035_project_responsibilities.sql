-- =============================================================================
-- 1035 project responsibilities — corrected participant descriptions
-- Migration: 20261025000001_1035_project_responsibilities.sql
--
-- Corrects the 1035 project PARTICIPANT responsibilities surfaced in My
-- Projects so each person's project responsibility reads accurately. These are
-- PROJECT RESPONSIBILITIES (project_participants.role + note), kept strictly
-- distinct from:
--   - job titles        (producers.title — untouched here)
--   - qualifications    (producers.is_* license facts — only Angie's life
--                        license is asserted below, as a FACT, not a role)
--   - routing/eligibility (producer_work_functions — DELIBERATELY untouched: a
--                        responsibility label never changes who work is routed
--                        to)
--
-- Settled responsibilities (acceptance decision):
--   Bob     Project Owner and Operations Manager   (role already 'owner')
--   Angie   Operations (life licensed)             (role 'operations';
--                                                    is_life_licensed = true)
--   Nikki   Underwriting Support (licensing unconfirmed)
--                                                   (role 'underwriting_support';
--                                                    licensing left NULL/unknown)
--   Gabe    Operations                             (role 'operations')
--   Dulce   Operations                             (role 'operations')
--   Ashley  Senior Producer                        (role already 'senior_producer')
--
-- Angie's life-license fact: Angie performs operations that touch life-licensed
-- work, and her life license is a settled, established FACT, so is_life_licensed
-- is set true. This is a qualification fact, not a project role; it is recorded
-- on producers, and My Projects shows it as a separate "(life licensed)"
-- annotation beside the Operations responsibility. Nikki's licensing is NOT
-- asserted (it is unconfirmed), so her fact stays NULL (unknown) and surfaces as
-- "(licensing unconfirmed)" for the underwriting-support responsibility.
--
-- IMPORTANT: no routing is changed. Gabe and Dulce keep their existing outreach
-- capability assignments (producer_work_functions); only their PROJECT
-- responsibility label changes to Operations. The two concepts are independent.
--
-- SAFE REPLAY + PRODUCTION PORTABILITY: every write is guarded on the real 1035
-- project and each producer existing, and only UPDATEs existing participation
-- rows (participants were seeded by 20261021000001). A run against an
-- environment without that project or those producers is a clean no-op.
--
-- Depends on 20261021000001_ipf_work_overlay (project_participants + role) and
-- 20261022000001_ipf_overlay_corrections (role column, Bob/Ashley/Angie roles).
-- =============================================================================
do $$
declare
  p_bob     uuid := '55c0e564-35d1-4bcc-888d-8edaa4e2fdf7';
  p_angie   uuid := '6fbce54f-5c02-4589-90b3-f4eb19248256';
  p_nikki   uuid := 'dcb3c1f9-a260-44ae-b02a-70fd000ea117';
  p_gabe    uuid := '7a8ffc03-a89a-4dfc-96d9-2cb552ca6036';
  p_dulce   uuid := 'afc210a6-9974-4459-95bf-87dee6274f30';
  p_ashley  uuid := '067ca02d-7618-4aea-84ad-9abaa5d166e0';
  proj_1035 uuid := '60d8ca7d-56fa-44e2-9cae-29a542d4eb48';
  has_proj  boolean;
begin
  -- Angie's life license is a settled qualification FACT (not a role). Set it
  -- only if she exists; leave every other producer's licensing untouched (an
  -- unestablished fact stays NULL = unknown).
  update public.producers set is_life_licensed = true
    where id = p_angie and is_life_licensed is distinct from true;

  select exists(select 1 from public.projects where id = proj_1035) into has_proj;
  if not has_proj then
    return; -- no 1035 project here: responsibility corrections are a no-op
  end if;

  -- Bob: Project Owner and Operations Manager. Reassert the settled owner
  -- responsibility (idempotent; already set by 20261022000001).
  update public.project_participants
    set role = 'owner',
        note = 'Project owner and operations manager'
    where project_id = proj_1035 and producer_id = p_bob;

  -- Angie: Operations. The life-license fact is a separate annotation, NOT part
  -- of the responsibility label, so the note stays plain Operations.
  update public.project_participants
    set role = 'operations',
        note = 'Operations'
    where project_id = proj_1035 and producer_id = p_angie;

  -- Nikki: Underwriting Support. Licensing is unconfirmed, so no license fact is
  -- asserted; the UI derives "(licensing unconfirmed)" from the NULL fact.
  update public.project_participants
    set role = 'underwriting_support',
        note = 'Underwriting support'
    where project_id = proj_1035 and producer_id = p_nikki;

  -- Gabe: Operations (project responsibility only; outreach ROUTING is unchanged).
  update public.project_participants
    set role = 'operations',
        note = 'Operations'
    where project_id = proj_1035 and producer_id = p_gabe;

  -- Dulce: Operations (project responsibility only; outreach ROUTING is unchanged).
  update public.project_participants
    set role = 'operations',
        note = 'Operations'
    where project_id = proj_1035 and producer_id = p_dulce;

  -- Ashley: Senior Producer (idempotent; already set by 20261022000001).
  update public.project_participants
    set role = 'senior_producer',
        note = 'Senior producer'
    where project_id = proj_1035 and producer_id = p_ashley;
end
$$;

-- Refresh PostgREST's schema cache (no new columns; keeps a replay uniform).
notify pgrst, 'reload schema';
