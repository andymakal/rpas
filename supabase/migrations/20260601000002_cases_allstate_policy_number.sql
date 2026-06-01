-- =============================================================================
-- Add allstate_policy_number as a dedicated column on cases
-- Migration: 20260601000002_cases_allstate_policy_number.sql
--
-- Previously stored only as a key:value line in the notes field
-- ("Allstate Policy: XXXXXXXX"). Promoting to its own column makes it
-- directly editable from the Referral and Triage pages.
--
-- Backfill: extract the value from existing notes using regex so no data
-- is lost in the transition.
-- =============================================================================

alter table public.cases
  add column if not exists allstate_policy_number text;

comment on column public.cases.allstate_policy_number is
  'The client''s existing Allstate property/auto policy number as provided '
  'by the referring LSP. Used to identify the client in the Allstate system.';

-- Backfill from notes — captures "Allstate Policy: XXXXXXXX" lines
update public.cases
set allstate_policy_number = trim((regexp_match(notes, '(?i)Allstate Policy:\s*([^\n\r]+)'))[1])
where notes ~ '(?i)Allstate Policy:'
  and allstate_policy_number is null;
