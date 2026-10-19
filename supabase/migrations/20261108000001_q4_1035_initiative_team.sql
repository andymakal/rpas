-- =============================================================================
-- Configure the "Q4 1035 initiative" project TEAM
-- Migration: 20261108000001_q4_1035_initiative_team.sql
--
-- Sets the team for the existing "Q4 1035 initiative" project using the existing
-- project_participants (responsibility) and project_escalation_contacts (ordered
-- exception path) structures. The team is exactly three people:
--
--   - Dulce Velazquez : Operations               (participant, role 'operations')
--   - Angie Strem     : Operations Escalation     (participant, role
--                       'operations_escalation'; AND the first escalation
--                       contact, project_escalation_contacts tier 1)
--   - Bob Pfromm      : Producer                  (participant, role 'producer')
--
-- These are PROJECT responsibilities. They are deliberately kept distinct from
-- each producer's job title (producers.title), their licensing facts
-- (producers.is_*_licensed), and their capability / work-routing assignments
-- (producer_work_functions). This migration touches NONE of those: it changes
-- no work assignment and no routing.
--
-- Idempotent and self-correcting: it resolves people and the project by stable
-- identity, upserts the three rows, and removes any OTHER participant /
-- escalation rows on THIS project only, so "exactly these three" holds on a
-- replay. It is fully scoped to the one project and is a clean no-op on any
-- environment missing the project or the producers.
--
-- Depends on 20261021000001_ipf_work_overlay (project_participants +
-- project_escalation_contacts) and the projects / producers tables.
-- =============================================================================

do $$
declare
  proj_q4  uuid;
  p_dulce  uuid := 'afc210a6-9974-4459-95bf-87dee6274f30';
  p_angie  uuid := '6fbce54f-5c02-4589-90b3-f4eb19248256';
  p_bob    uuid := '55c0e564-35d1-4bcc-888d-8edaa4e2fdf7';
begin
  -- Resolve the project by name (case-insensitive). If it is not present on this
  -- environment, do nothing.
  select id into proj_q4
  from public.projects
  where lower(name) = lower('Q4 1035 initiative')
  limit 1;

  if proj_q4 is null then
    raise notice 'Q4 1035 initiative project not found; skipping team configuration.';
    return;
  end if;

  -- ── Participants (responsibilities) ──────────────────────────────────────
  -- Each insert is guarded on the producer existing, and upserts on the unique
  -- (project_id, producer_id) pair so a replay updates rather than duplicates.

  if exists (select 1 from public.producers where id = p_dulce) then
    insert into public.project_participants (project_id, producer_id, role, note)
    values (proj_q4, p_dulce, 'operations', 'Operations')
    on conflict (project_id, producer_id)
      do update set role = excluded.role, note = excluded.note;
  end if;

  if exists (select 1 from public.producers where id = p_angie) then
    insert into public.project_participants (project_id, producer_id, role, note)
    values (proj_q4, p_angie, 'operations_escalation', 'Operations escalation (first contact)')
    on conflict (project_id, producer_id)
      do update set role = excluded.role, note = excluded.note;
  end if;

  if exists (select 1 from public.producers where id = p_bob) then
    insert into public.project_participants (project_id, producer_id, role, note)
    values (proj_q4, p_bob, 'producer', 'Producer')
    on conflict (project_id, producer_id)
      do update set role = excluded.role, note = excluded.note;
  end if;

  -- Exactly these three: drop any other participant on THIS project only.
  delete from public.project_participants
  where project_id = proj_q4
    and producer_id not in (p_dulce, p_angie, p_bob);

  -- ── Escalation path (operations exceptions) ──────────────────────────────
  -- Angie is the FIRST escalation contact (tier 1). Clear any other escalation
  -- rows on this project first so the single tier-1 is exactly Angie, then
  -- upsert on the unique (project_id, tier) pair.
  if exists (select 1 from public.producers where id = p_angie) then
    delete from public.project_escalation_contacts
    where project_id = proj_q4
      and not (producer_id = p_angie and tier = 1);

    insert into public.project_escalation_contacts (project_id, producer_id, tier, note)
    values (proj_q4, p_angie, 1, 'First operations escalation contact')
    on conflict (project_id, tier)
      do update set producer_id = excluded.producer_id, note = excluded.note;
  end if;
end
$$;
