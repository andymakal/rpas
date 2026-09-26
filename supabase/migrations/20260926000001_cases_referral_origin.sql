-- =============================================================================
-- Add referral_origin to cases
-- Migration: 20260926000001_cases_referral_origin.sql
--
-- Distinguishes genuine portal submissions from cases manually credited to
-- an agency by a producer. Needed for Agency Card scorecard accuracy.
--
--   portal           default — referral submitted through agency portal
--   acom_gift        Allstate.com lead credited to this agency
--   producer_credit  manually gifted by a producer (no portal submission)
--
-- Backfill: existing cases default to 'portal'. Rows with the old
-- lead_source = 'allstate_web' are left as 'portal' — that column was
-- repurposed mid-stream and can't be trusted for reliable classification.
-- Set 'producer_credit' or 'acom_gift' going forward at case creation time.
-- =============================================================================

alter table public.cases
  add column if not exists referral_origin text not null default 'portal'
  constraint cases_referral_origin_valid
    check (referral_origin in ('portal', 'acom_gift', 'producer_credit'));

comment on column public.cases.referral_origin is
  'portal = genuine agency portal submission (EFS-generated). '
  'acom_gift = Allstate.com lead credited to this agency. '
  'producer_credit = manually gifted by a producer (no portal submission).';

create index if not exists cases_referral_origin_idx
  on public.cases (agency_id, referral_origin)
  where is_test = false;
