-- =============================================================================
-- Add 'workflow' to case_touches.touch_type
--
-- Migration: 20261115000001_case_touches_workflow_type.sql
--
-- Customer Interaction records three ADMINISTRATIVE workflow milestones in the
-- customer's history: a follow-up scheduled (set-follow-up), a follow-up
-- completed (complete-follow-up), and a recorded refusal (refuse). These were
-- being written as a 'call' touch, which mislabeled them in Customer History as
-- telephone calls that never happened (a refusal may arrive by email or text; a
-- scheduled/completed follow-up is not a call at all).
--
-- This adds a dedicated 'workflow' touch_type so each milestone is recorded
-- honestly and read as what it is, while preserving the SAME durable mechanism
-- (one case_touches row, the acting employee, the timestamp) and introducing no
-- second history system. It is the exact pattern used to add 'research'
-- (20261103000002) for the same reason, and 'missed_appointment' /
-- 'postal' before it.
--
-- The attempt-history reader and the contact-communication history both count
-- only genuine outreach channels (call / voicemail / text / email / postal), so
-- a 'workflow' touch never inflates the outreach-attempt or Nonresponsive
-- counts and is never shown as a communication; the Customer History display
-- renders it as its own distinct milestone event (like 'research').
-- =============================================================================

alter table public.case_touches
  drop constraint if exists case_touches_touch_type_check;

alter table public.case_touches
  add constraint case_touches_touch_type_check
  check (touch_type in ('call', 'voicemail', 'text', 'email', 'missed_appointment', 'postal', 'research', 'workflow'));
