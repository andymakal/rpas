-- =============================================================================
-- Add no_lsp_response lost status
-- Migration: 20260713000001_no_lsp_response_status.sql
--
-- Auto-close path: if a case stays in lsp_contact_needed for 14+ days the
-- daily cron (/api/cron/lsp-no-response) moves it here.
-- Portal label: "No LSP Response Received" — visible on the ClosedCard badge.
-- =============================================================================

-- Stage translation (shows on Agency Portal closed card)
insert into public.stage_translations
  (internal_status, agency_label, tier, stage_order, stale_threshold_days,
   is_active_case, is_won, is_lost, is_snoozed)
values
  ('no_lsp_response', 'No LSP Response Received', 1, 0, null,
   false, false, true, false)
on conflict (internal_status) do nothing;

-- Lost reason (links to cases.lost_reason_id)
insert into public.lost_reasons (internal_code, agency_label, sort_order, context)
values ('no_lsp_response', 'No LSP Response Received', 99, 'triage')
on conflict (internal_code) do nothing;
