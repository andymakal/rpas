-- =============================================================================
-- Add 'postal' to case_touches.touch_type
-- Migration: 20261030000002_case_touches_postal_type.sql
--
-- Servicing-agent onboarding can deliver the authorization form by postal mail
-- as well as by email. A mailed form is a real outbound contact that belongs in
-- the customer's history, but 'postal' was not an allowed touch_type, so such a
-- touch could not be recorded honestly (the alternatives — 'email', 'call' —
-- would mislabel the channel). This extends the CHECK to allow 'postal'.
--
-- Additive and safe: no existing row uses 'postal' (verified against the
-- development clone), so the drop/recreate cannot reject existing data. Matches
-- the pattern of 20260526000001 (missed_appointment).
-- =============================================================================

alter table public.case_touches
  drop constraint if exists case_touches_touch_type_check;

alter table public.case_touches
  add constraint case_touches_touch_type_check
  check (touch_type in ('call', 'voicemail', 'text', 'email', 'missed_appointment', 'postal'));
