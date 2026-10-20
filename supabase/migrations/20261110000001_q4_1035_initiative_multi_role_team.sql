-- =============================================================================
-- Configure the "Q4 1035 initiative" TEAM under the multi-responsibility model
-- Migration: 20261110000001_q4_1035_initiative_multi_role_team.sql
--
-- Sets the exact team for "Q4 1035 initiative" now that a participant can hold
-- SEVERAL project responsibilities (project_participants.roles[]):
--
--   - Bob Pfromm      : Project owner, Operations manager, Producer
--                       (roles = {project_owner, operations_manager, producer};
--                        NOT on the escalation path)
--   - Dulce Velazquez : Operations                  (roles = {operations})
--   - Angie Strem     : Operations                  (roles = {operations}) AND
--                       the FIRST operations escalation contact
--                       (project_escalation_contacts tier 1)
--
-- Reuses the existing team + escalation structures. Operations escalation stays
-- in project_escalation_contacts (the single source of truth); it is NOT a
-- stored role. Project owner and operations manager are INDEPENDENT roles.
--
-- Supersedes the single-role seed (20261108000001) for this project: Bob was a
-- tier-2 escalation contact there; the target keeps Angie as the ONLY escalation
-- contact (tier 1), so any other escalation row on this project is removed.
--
-- This touches NO work assignment, capability, or routing record
-- (producer_work_functions is untouched). Idempotent, scoped to the one project,
-- and a clean no-op where the project or producers are absent.
--
-- Depends on 20261109000001_project_participants_multi_role (roles[] column).
-- =============================================================================

do $$
declare
  proj_q4  uuid;
  p_dulce  uuid := 'afc210a6-9974-4459-95bf-87dee6274f30';
  p_angie  uuid := '6fbce54f-5c02-4589-90b3-f4eb19248256';
  p_bob    uuid := '55c0e564-35d1-4bcc-888d-8edaa4e2fdf7';
begin
  select id into proj_q4
  from public.projects
  where lower(name) = lower('Q4 1035 initiative')
  limit 1;

  if proj_q4 is null then
    raise notice 'Q4 1035 initiative project not found; skipping team configuration.';
    return;
  end if;

  -- ── Participants (responsibility SETS) ───────────────────────────────────
  -- Upsert on the unique (project_id, producer_id) pair; set roles[] and clear
  -- the legacy single role so the array is authoritative.

  if exists (select 1 from public.producers where id = p_bob) then
    insert into public.project_participants (project_id, producer_id, roles, role, note)
    values (proj_q4, p_bob, array['project_owner','operations_manager','producer'], null,
            'Project owner, operations manager, producer')
    on conflict (project_id, producer_id)
      do update set roles = excluded.roles, role = null, note = excluded.note;
  end if;

  if exists (select 1 from public.producers where id = p_dulce) then
    insert into public.project_participants (project_id, producer_id, roles, role, note)
    values (proj_q4, p_dulce, array['operations'], null, 'Operations')
    on conflict (project_id, producer_id)
      do update set roles = excluded.roles, role = null, note = excluded.note;
  end if;

  if exists (select 1 from public.producers where id = p_angie) then
    insert into public.project_participants (project_id, producer_id, roles, role, note)
    values (proj_q4, p_angie, array['operations'], null,
            'Operations; first operations escalation contact')
    on conflict (project_id, producer_id)
      do update set roles = excluded.roles, role = null, note = excluded.note;
  end if;

  -- Exactly these three participants on THIS project.
  delete from public.project_participants
  where project_id = proj_q4
    and producer_id not in (p_dulce, p_angie, p_bob);

  -- ── Escalation path ──────────────────────────────────────────────────────
  -- Angie is the ONLY escalation contact, at tier 1. Remove any other escalation
  -- row on this project (e.g. the prior tier-2 Bob), then upsert Angie at tier 1.
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
