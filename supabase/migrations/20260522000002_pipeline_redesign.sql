-- =============================================================================
-- RPAS Pipeline Redesign
-- Migration: 20260522000002_pipeline_redesign.sql
--
-- Changes:
--   1. Add producer_id to cases table (assignment tracking)
--   2. Add is_prospect to stage_translations (parked prospects ≠ lost)
--   3. Insert new stages: triage, active_referral, not_interested
--   4. Update existing stages: lsp_contact_needed, appointment_missed, appointment_kept
--   5. Retire back_to_agency snooze reason (push to bottom via sort_order)
--   6. Add client_requested_callback snooze reason
--   7. Add granular not_interested lost reasons
-- =============================================================================


-- =============================================================================
-- 1. CASES — add producer_id for assignment tracking
--    Nullable FK to producers (the SML/internal team member working the case)
--    ON DELETE SET NULL: if producer leaves the team, cases are unassigned not lost
-- =============================================================================
alter table public.cases
  add column if not exists producer_id uuid references public.producers (id) on delete set null;

comment on column public.cases.producer_id is
  'SML team member assigned to work this case. '
  'Set when a Triage case is assigned and it moves to active_referral. '
  'Nullable — unassigned cases remain in Triage queue.';


-- =============================================================================
-- 2. STAGE_TRANSLATIONS — add is_prospect flag
--    Distinguishes "parked prospect" (not_interested) from hard lost (carrier_declined, etc.)
--    Prospects are inactive cases that may be re-engaged later; they are NOT failures.
-- =============================================================================
alter table public.stage_translations
  add column if not exists is_prospect boolean not null default false;

comment on column public.stage_translations.is_prospect is
  'True for stages where the client is parked but potentially re-engageable. '
  'Used in portal to show Parked Prospects section with Re-Warm CTA. '
  'Distinct from is_lost (carrier_declined / client_withdrew) which are hard closes.';


-- =============================================================================
-- 3. NEW STAGES
--    triage:          Intake holding queue — all new referrals land here
--    active_referral: Primary working stage — assigned and being contacted
--    not_interested:  Client wasn't interested — parked, not permanently lost
-- =============================================================================
insert into public.stage_translations
  (internal_status, agency_label, tier, stage_order, stale_threshold_days,
   is_active_case, is_won, is_lost, is_snoozed, is_prospect)
values

  -- Triage: holding queue before producer assignment
  -- Stale threshold: 1 day — unassigned referrals should move quickly
  ('triage',
   'Received — awaiting assignment',
   1, 5, 1,
   true, false, false, false, false),

  -- Active Referral: the primary working stage (replaces old "Working")
  -- Stale threshold: 3 days — producer is actively attempting contact
  ('active_referral',
   'Working on first contact',
   1, 10, 3,
   true, false, false, false, false),

  -- Not Interested: parked prospect — NOT a hard loss
  -- is_prospect = true so portals can show Re-Warm CTA
  -- is_active_case = false so it doesn't crowd the active pipeline
  -- stage_order 45 — sorts after quoted (40) in the status dropdown
  ('not_interested',
   'Client not interested at this time',
   1, 45, null,
   false, false, false, false, true)

on conflict (internal_status) do nothing;


-- =============================================================================
-- 4. UPDATE EXISTING STAGES
--    lsp_contact_needed → "LSP Re-Warm Needed" (relabeled, stage_order 8)
--      - Outcome of 6-9 failed contact attempts; ball is in LSP's court to re-engage
--      - Repositioned BELOW active_referral (stage_order 8 < 10) so it sorts below
--    appointment_missed → "Appointment Missed" (clean up label)
--      - Old label "Back to agency to re-warm" confused LSP Re-Warm Needed
--      - Now clearly means: set appointment, client didn't show
--    appointment_kept → deprecated
--      - SPIFF checkbox handles "kept appointment" tracking
--      - Mark is_active_case = false so it falls out of active pipeline display
-- =============================================================================
update public.stage_translations
set
  agency_label           = 'LSP Re-Warm Needed',
  stage_order            = 8,
  stale_threshold_days   = 7
where internal_status = 'lsp_contact_needed';

update public.stage_translations
set
  agency_label         = 'Appointment Missed'
where internal_status = 'appointment_missed';

update public.stage_translations
set
  is_active_case       = false,
  stale_threshold_days = null
where internal_status = 'appointment_kept';


-- =============================================================================
-- 5. SNOOZE REASONS — retire back_to_agency, add client_requested_callback
--    back_to_agency is now handled by the lsp_contact_needed stage itself
--    (no need for a parallel snooze reason)
-- =============================================================================

-- Push to bottom so it doesn't appear in active dropdowns
-- (We don't hard-delete in case existing cases reference it)
update public.snooze_reasons
set sort_order = 999
where internal_code = 'back_to_agency';

-- New reason: client asked us to call back at a specific time
insert into public.snooze_reasons (internal_code, agency_label, sort_order) values
  ('client_requested_callback', 'Client requested callback — follow-up scheduled', 35)
on conflict (internal_code) do nothing;


-- =============================================================================
-- 6. LOST REASONS — granular not_interested codes
--    These appear when a case is moved to not_interested (parked prospect)
--    or to client_withdrew (hard loss with specific reason)
-- =============================================================================
insert into public.lost_reasons (internal_code, agency_label, sort_order) values
  ('not_interested_no_quote',  'Not interested — declined to receive a quote',   15),
  ('not_interested_price',     'Not interested — pricing too high',              16),
  ('not_interested_options',   'Not interested — no appealing options available', 17),
  ('app_withdrawn',            'Application withdrawn — client changed mind',     35),
  ('uninsurable',              'Not placeable — no insurable options available',  45)
on conflict (internal_code) do nothing;
