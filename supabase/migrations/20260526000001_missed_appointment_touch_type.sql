-- =============================================================================
-- Add missed_appointment to case_touches.touch_type
-- Migration: 20260526000001_missed_appointment_touch_type.sql
--
-- Extends the touch_type CHECK constraint to allow 'missed_appointment',
-- which is logged when a client doesn't answer at their scheduled appointment
-- time. The API also moves the case back to triage and clears appointment_date.
-- =============================================================================

alter table public.case_touches
  drop constraint if exists case_touches_touch_type_check;

alter table public.case_touches
  add constraint case_touches_touch_type_check
  check (touch_type in ('call', 'voicemail', 'text', 'email', 'missed_appointment'));
