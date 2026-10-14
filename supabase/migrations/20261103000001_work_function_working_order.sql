-- =============================================================================
-- My Work working-order correction — work_functions.sort_order
-- Migration: 20261103000001_work_function_working_order.sql
--
-- WHY: My Work's recommended working plan is ordered by the GoRules ZEN priority
-- BAND first and then, WITHIN a band, by the capability catalog's sort_order
-- (the established secondary ordering the composition already applies). ZEN owns
-- the band judgment; sort_order owns the business ordering of materially
-- different activities that share a band. This is NOT a new UI priority system
-- and NOT a change to any band — it corrects the secondary ordering so equal-
-- band onboarding activities no longer read as co-equal "any of these".
--
-- The settled Servicing Agent Onboarding working order is:
--   1. Contact Research       — customers with NO usable contact method; find
--                               a working email/phone before anything else.
--   2. Contact Review         — customers missing an ADDITIONAL contact method;
--                               complete it next.
--   3. Outreach               — introductory emails, then phone calls (due
--                               calls distinguished from other callable work).
--   4. Operations Preparation — work already ready to advance, independent of
--                               ongoing outreach.
--   5. Determination          — senior-producer candidacy decision.
--   6. General Office Support  — ordinary office business.
--
-- The PRIOR order led with Outreach (10) ahead of Research (20) and Contact
-- Review (25), which is materially wrong for onboarding: you cannot email or
-- call a customer whose contact method is still missing. This migration moves
-- Research and Contact Review ahead of Outreach, and leaves Operations
-- Preparation / Determination / Office Support after it.
--
-- SAFE REPLAY + PORTABILITY: pure idempotent UPDATEs keyed by canonical_key; a
-- re-run sets the same values. No row is created or removed, no band changes,
-- no eligibility changes. Depends on 20261021000001_ipf_work_overlay (seeds the
-- catalog) and 20261027000001_contact_review_work_function (seeds contact_review).
-- =============================================================================

update public.work_functions set sort_order = 10 where canonical_key = 'research';
update public.work_functions set sort_order = 20 where canonical_key = 'contact_review';
update public.work_functions set sort_order = 30 where canonical_key = 'outreach';
update public.work_functions set sort_order = 40 where canonical_key = 'operations_prep';
update public.work_functions set sort_order = 50 where canonical_key = 'determination';
update public.work_functions set sort_order = 60 where canonical_key = 'office_support';

-- Refresh PostgREST's schema cache so the reordering is reflected immediately.
notify pgrst, 'reload schema';
