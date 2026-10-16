-- =============================================================================
-- Consolidate contact research into ONE activity
-- Migration: 20261104000001_consolidate_contact_research.sql
--
-- Right Path had TWO overlapping contact-finding activities:
--   * 'research'        — the Stewardship board exception path (customers with
--                         NO usable contact method).
--   * 'contact_review'  — the project-scoped pass (customers missing EITHER a
--                         usable email or phone), seeded by
--                         20261027000001_contact_review_work_function.sql with
--                         its eligibility MIRRORED one-for-one from 'research'.
--
-- They are now a SINGLE consolidated activity. The project Contact Research read
-- (buildContactReview) already covers every customer missing a method — a strict
-- superset of the board's no-usable-contact population — so one activity routed
-- to one screen counts each customer once. 'research' is that single activity;
-- 'contact_review' is retired.
--
-- What this migration does:
--   1. Removes the mirrored 'contact_review' eligibility rows. They were created
--      as exact copies of the 'research' grants, so deleting them loses nothing:
--      whoever can do contact research is already eligible via 'research'.
--   2. Removes the 'contact_review' catalog row.
--   3. Relabels/retunes 'research' to describe the consolidated activity (it now
--      covers missing-one as well as missing-both) and reasserts its working
--      order (sort_order 10, ahead of Outreach), matching
--      20261103000001_work_function_working_order.sql.
--
-- SAFE REPLAY: every statement is idempotent. Deleting absent rows is a no-op;
-- the catalog update is a plain upsert-by-key. No 'research' grant is touched;
-- no producer loses eligibility for contact research.
--
-- Depends on 20261021000001_ipf_work_overlay (work_functions +
-- producer_work_functions), 20261027000001_contact_review_work_function (which
-- seeded the rows removed here), and 20261103000001_work_function_working_order.
-- =============================================================================

-- 1. Remove the mirrored contact_review eligibility rows.
delete from public.producer_work_functions
where work_function_id in (
  select id from public.work_functions where canonical_key = 'contact_review'
);

-- 2. Remove the contact_review catalog row.
delete from public.work_functions where canonical_key = 'contact_review';

-- 3. Reassert 'research' as the single consolidated Contact Research activity.
update public.work_functions
set label = 'Contact Research',
    description =
      'Find the contact information missing from the import: look the customer '
      || 'up in eAgent and fill in a usable email or phone. Covers every customer '
      || 'missing a method — those with no usable contact at all (the No Usable '
      || 'Contact Information exception) and those missing just one. Writes only '
      || 'to the customer record.',
    sort_order = 10
where canonical_key = 'research';

-- Refresh PostgREST's schema cache so the catalog change is visible immediately.
notify pgrst, 'reload schema';
