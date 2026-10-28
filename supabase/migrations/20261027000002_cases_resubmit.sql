-- =============================================================================
-- Case resubmission: link a withdrawn case to its replacement at a new carrier.
-- Migration: 20261027000002_cases_resubmit.sql
--
-- Andy's case-resubmission feature (branch `main`). Originally authored under
-- version 20261027000001, which COLLIDED with the development-branch migration
-- 20261027000001_contact_review_work_function.sql (production recorded that
-- version as contact_review_work_function). Renamed to 20261027000002 during the
-- development -> main reconciliation so the migration set has a unique version
-- per file and migration history is unambiguous.
--
-- Production already has both columns (applied directly while the feature was
-- developed on main), so this migration is a verified no-op there: the
-- ADD COLUMN IF NOT EXISTS guards make re-running safe and non-destructive. It
-- is retained (not deleted) so a fresh environment and the migration ledger
-- reproduce the schema faithfully.
-- =============================================================================
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS replaced_by_case_id uuid REFERENCES cases(id),
  ADD COLUMN IF NOT EXISTS replaces_case_id uuid REFERENCES cases(id);
