-- =============================================================================
-- Correction: the 1035 servicing-agent authorization email is recorded as an
-- ordinary 'email' touch, identified by its description, not by a dedicated
-- activity type. Revert the touch_type allow-list added in
-- 20261028000001_case_touches_customer_level.sql back to the established set.
--
-- The customer-level extension to case_touches (nullable customer_id, relaxed
-- case_id, presence check, index) is retained; only the extra 'servicing_outreach'
-- type is removed.
--
-- SAFE: no servicing_outreach rows exist (verified on the development clone
-- before this migration), so tightening the CHECK validates cleanly with no
-- data to migrate. The guard below makes that explicit and keeps replay honest:
-- if any such row somehow exists, it is relabeled to 'email' first so the new
-- constraint can never fail to apply.
-- =============================================================================

-- Defensive: fold any stray servicing_outreach touch into a plain email touch.
update public.case_touches
  set touch_type = 'email'
  where touch_type = 'servicing_outreach';

alter table public.case_touches
  drop constraint if exists case_touches_touch_type_check;

alter table public.case_touches
  add constraint case_touches_touch_type_check
  check (touch_type in ('call', 'voicemail', 'text', 'email', 'missed_appointment'));
