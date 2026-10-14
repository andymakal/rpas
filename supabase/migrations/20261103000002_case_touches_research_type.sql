-- =============================================================================
-- Add 'research' to case_touches.touch_type
-- Migration: 20261103000002_case_touches_research_type.sql
--
-- Internal contact RESEARCH (an employee looking a customer up in eAgent to try
-- to find a missing email or phone) is NOT a customer communication. It was
-- being recorded as a 'call' or 'email' touch, which mislabeled it in the
-- customer's Touch History as an actual outbound contact. This adds a dedicated
-- 'research' touch_type so an internal look-up is recorded honestly and read as
-- what it is, while preserving the SAME durable mechanism (one case_touches row
-- carrying the per-method outcome marker on the note, the acting employee in
-- touched_by, and the moment in touched_at).
--
-- Additive and safe: it only widens the CHECK allow-list, so every existing row
-- (all of which use the prior types) remains valid. Mirrors the pattern of
-- 20260526000001 (missed_appointment) and 20260530000002/20261030000002
-- (postal). The attempt-history reader counts only genuine outreach channels
-- (call / voicemail / text / email / postal), so a 'research' touch never
-- inflates the outreach attempt or Nonresponsive counts.
-- =============================================================================

alter table public.case_touches
  drop constraint if exists case_touches_touch_type_check;

alter table public.case_touches
  add constraint case_touches_touch_type_check
  check (touch_type in ('call', 'voicemail', 'text', 'email', 'missed_appointment', 'postal', 'research'));
