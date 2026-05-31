-- =============================================================================
-- Add appointment_time to cases
-- Migration: 20260530000003_cases_appointment_time.sql
--
-- Stores the time of day for appointments as a plain text field (e.g. "2:30 PM").
-- Stored as text rather than timestamptz because:
--   - The date is already on appointment_date
--   - Time zones vary and storing them together in UTC would require TZ handling
--   - The value is purely for human display in emails and the UI
-- =============================================================================

alter table public.cases
  add column if not exists appointment_time text;

comment on column public.cases.appointment_time is
  'Human-readable appointment time (e.g. "2:30 PM"). '
  'Paired with appointment_date for client-facing confirmations and reminders.';
