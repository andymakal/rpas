-- =============================================================================
-- Fix lead_source CHECK constraint
-- Migration: 20260526000002_lead_source_constraint_fix.sql
--
-- The original constraint only allowed ('agency_referral', 'allstate_web',
-- 'self_generated'). The intake form was later updated to store the referral
-- category (mortgage_protection, term_life, etc.) in lead_source, but the
-- constraint was never updated — causing every intake form submission to fail
-- with a CHECK constraint violation on the case insert.
-- =============================================================================

alter table public.cases
  drop constraint if exists cases_lead_source_valid;

alter table public.cases
  add constraint cases_lead_source_valid
  check (lead_source in (
    -- legacy source values (may exist on older records)
    'agency_referral',
    'allstate_web',
    'self_generated',
    -- current referral category values (from REFERRAL_TYPES in referral-options.ts)
    'mortgage_protection',
    'term_life',
    'life_review',
    'financial_planning',
    'retirement_planning',
    'medicare_planning',
    'business_owner',
    '1035_exchange',
    'existing_service',
    'existing_sales'
  ));
