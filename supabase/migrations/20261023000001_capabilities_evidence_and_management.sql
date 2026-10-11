-- =============================================================================
-- IPF overlay — evidence-based capabilities and management authority
-- Migration: 20261023000001_capabilities_evidence_and_management.sql
--
-- Forward data correction (no schema change). Two settled things:
--
--   1. EVIDENCE-BASED CAPABILITIES. The prior correction (20261022000001)
--      removed capability assignments that had been inferred from job titles,
--      leaving only Bob -> determination. This migration restores the
--      assignments that are backed by ESTABLISHED, ACTUAL RESPONSIBILITIES
--      (not titles):
--        * Dulce and Gabe perform customer outreach and calls   -> 'outreach'
--        * Angie handles servicing outreach and operations
--            -> 'outreach' (support), 'research', 'operations_prep'
--        * Bob performs 1035 determinations                     -> 'determination'
--            (already present; reasserted idempotently, with his life-license
--             fact which that responsibility requires)
--      Nothing is asserted for anyone else: genuinely unknown qualifications
--      stay unassigned (the absence of a row = not qualified), and no licensing
--      flag is invented.
--
--   2. MANAGEMENT AUTHORITY (confirmed decision). Both Bob (operations manager)
--      and Andy (agency owner) may set, modify, and end Today's Focus. Grant
--      producers.is_management = true to BOTH, using their verified producer
--      records. No other employee receives this authority.
--
-- SAFE REPLAY + PORTABILITY: every write is guarded on the producer and the
-- capability existing and uses on-conflict / existence filters, so a replay — or
-- a run against an environment with a different roster — is a clean no-op rather
-- than an error, and never overwrites a legitimate assignment made elsewhere.
--
-- Already applied to development as part of this correction. Depends on
-- 20261021000001_ipf_work_overlay and 20261022000001_ipf_overlay_corrections.
-- =============================================================================


-- =============================================================================
-- 1. EVIDENCE-BASED CAPABILITY ASSIGNMENTS
-- Each row is inserted only when BOTH the producer and the work function exist,
-- via a join, so a different roster cannot cause a foreign-key failure. Routable
-- assignment types only (primary/support). on conflict do nothing keeps replays
-- idempotent and preserves any assignment a human later changes.
-- =============================================================================
do $$
declare
  p_gabe  uuid := '7a8ffc03-a89a-4dfc-96d9-2cb552ca6036'; -- performs outreach + calls
  p_dulce uuid := 'afc210a6-9974-4459-95bf-87dee6274f30'; -- performs outreach + calls
  p_angie uuid := '6fbce54f-5c02-4589-90b3-f4eb19248256'; -- servicing outreach + operations
  p_bob   uuid := '55c0e564-35d1-4bcc-888d-8edaa4e2fdf7'; -- 1035 determinations
begin
  -- (producer, capability canonical_key, assignment_type) backed by evidence.
  insert into public.producer_work_functions (producer_id, work_function_id, assignment_type, project_id)
  select p.id, wf.id, v.assignment_type, null
  from (values
    -- Dulce and Gabe perform customer outreach and calls.
    (p_gabe,  'outreach',        'primary'),
    (p_dulce, 'outreach',        'primary'),
    -- Angie handles servicing outreach and operations.
    (p_angie, 'outreach',        'support'),
    (p_angie, 'research',        'primary'),
    (p_angie, 'operations_prep', 'primary'),
    -- Bob performs 1035 determinations (reasserted; also seeded earlier).
    (p_bob,   'determination',   'primary')
  ) as v(pid, canonical_key, assignment_type)
  join public.producers p       on p.id = v.pid
  join public.work_functions wf on wf.canonical_key = v.canonical_key
  on conflict do nothing;

  -- Bob's determination capability is life-licensing-gated; his settled
  -- responsibility requires the fact, so assert it (only if he exists). No other
  -- licensing fact is asserted for anyone — unknown stays NULL.
  update public.producers set is_life_licensed = true
    where id = p_bob and is_life_licensed is distinct from true;
end
$$;


-- =============================================================================
-- 2. MANAGEMENT AUTHORITY — Bob and Andy only
-- Confirmed decision: Bob (operations manager) and Andy (agency owner) may set,
-- modify, and end Today's Focus. Grant to BOTH via their verified records; no
-- other employee. Guarded on existence; idempotent.
-- =============================================================================
do $$
declare
  p_bob  uuid := '55c0e564-35d1-4bcc-888d-8edaa4e2fdf7'; -- operations manager
  p_andy uuid := '576441c0-c4c9-4649-8e62-27ee61a0309c'; -- agency owner
begin
  update public.producers set is_management = true
    where id in (p_bob, p_andy);
end
$$;


-- Refresh PostgREST's schema cache (no new columns, but keeps a replay uniform).
notify pgrst, 'reload schema';
