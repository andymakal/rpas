-- =============================================================================
-- Add missing cases columns: submitted_at, table_rating, is_imported
-- Migration: 20260714000001_cases_missing_columns.sql
--
-- These columns were added directly to the DB without a migration file.
-- This migration documents them so the schema stays in sync with code.
-- Using IF NOT EXISTS guards so it is safe to re-run if already applied.
-- =============================================================================

-- submitted_at: timestamp when the case reached app_submitted for the first time.
-- Stamped automatically by the PATCH handler; can be set manually on import.
alter table public.cases
  add column if not exists submitted_at timestamptz;

comment on column public.cases.submitted_at is
  'Timestamp when the case first reached app_submitted status. '
  'Set automatically by the PATCH handler; overrideable on import.';

-- table_rating: underwriting substandard rating expressed as a table number / percentage.
-- Examples: 150 (Table D), 200 (Table H). Null means standard or unknown.
alter table public.cases
  add column if not exists table_rating integer;

comment on column public.cases.table_rating is
  'Substandard underwriting table rating (e.g. 150 = Table D). '
  'Null = standard rating or rating not yet returned.';

-- is_imported: true for cases migrated from the legacy eAgent system.
-- Used to suppress certain automation (status history, SPIFF triggers) on old records.
alter table public.cases
  add column if not exists is_imported boolean not null default false;

comment on column public.cases.is_imported is
  'True for cases imported from the legacy eAgent system. '
  'Suppresses certain automation that is not applicable to historical records.';
