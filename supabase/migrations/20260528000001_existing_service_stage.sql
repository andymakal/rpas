-- =============================================================================
-- Add existing_service stage to stage_translations
-- Migration: 20260528000001_existing_service_stage.sql
--
-- Why this is CRITICAL (not cosmetic):
--   cases.internal_status has a FK referencing stage_translations(internal_status).
--   Without this row, any attempt to set a case to 'existing_service' — which
--   happens automatically when a service request is created from the Triage queue
--   or a Referral record — will be rejected by PostgreSQL with a FK violation.
--
-- Semantics:
--   The case referral is closed because it was converted into a service request.
--   It is NOT won, lost, or snoozed. It is simply no longer a live referral in
--   the active pipeline. is_active_case = false keeps it out of the referrals
--   pipeline views without deleting the history.
-- =============================================================================

insert into public.stage_translations
  (internal_status, agency_label, tier, stage_order, stale_threshold_days,
   is_active_case, is_won, is_lost, is_snoozed, is_prospect)
values
  ('existing_service',
   'Converted to service request',
   1, 0, null,
   false, false, false, false, false)
on conflict (internal_status) do nothing;
