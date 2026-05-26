-- =============================================================================
-- Add follow_up_date to cases
-- Migration: 20260525000002_cases_follow_up_date.sql
--
-- follow_up_date is used throughout the Referrals and Cases pipeline views
-- to let producers schedule a callback or next-touch date for a case.
-- Nullable date (no time component needed — date is sufficient for scheduling).
-- =============================================================================

alter table public.cases
  add column if not exists follow_up_date date;

comment on column public.cases.follow_up_date is
  'Date the producer intends to follow up with the client. '
  'Null = no follow-up scheduled. Date only (no time) — '
  'shown in pipeline views with overdue / today / upcoming badges.';

create index if not exists cases_follow_up_date_idx
  on public.cases (follow_up_date)
  where follow_up_date is not null and is_test = false;
