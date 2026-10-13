-- =============================================================================
-- Generalize case_touches into one shared communication history that can be
-- recorded against a customer directly, not only through a case.
--
-- Why: the 1035 stewardship outreach flow needs to record a durable email touch
-- that is visible in the customer's Touch History, but stewardship customers
-- typically have no `cases` row (verified on the development clone: 69 of 70
-- open-outreach customers had no non-test case). Rather than fabricate an
-- artificial case or stand up a competing history system, we let case_touches
-- carry a customer-level touch.
--
-- This is additive and backward compatible:
--   * Every existing touch keeps its case_id; nothing is migrated or dropped.
--   * case_id becomes nullable so a touch can be customer-only.
--   * A presence check guarantees a touch always points at a case, a customer,
--     or both — never nothing.
--   * A new touch_type value 'servicing_outreach' identifies the 1035
--     servicing-agent authorization email as its own activity type.
-- =============================================================================

-- 1. Direct customer association (nullable; existing rows stay case-only).
alter table public.case_touches
  add column if not exists customer_id uuid references public.customers (id) on delete cascade;

-- 2. Allow a touch to exist without a case (customer-level touch).
alter table public.case_touches
  alter column case_id drop not null;

-- 3. A touch must point at a case, a customer, or both — never neither.
alter table public.case_touches
  drop constraint if exists case_touches_target_present_check;
alter table public.case_touches
  add constraint case_touches_target_present_check
  check (case_id is not null or customer_id is not null);

-- 4. Add the 1035 servicing-outreach activity type to the allowed set.
alter table public.case_touches
  drop constraint if exists case_touches_touch_type_check;
alter table public.case_touches
  add constraint case_touches_touch_type_check
  check (touch_type in ('call', 'voicemail', 'text', 'email', 'missed_appointment', 'servicing_outreach'));

-- 5. Efficient lookup of a customer's touches (customer card gathers by this).
create index if not exists case_touches_customer_id_idx
  on public.case_touches (customer_id, touched_at desc)
  where customer_id is not null;

comment on column public.case_touches.customer_id is
  'Optional direct customer association. Set for customer-level touches that are '
  'not tied to a case (e.g. 1035 servicing-agent outreach, where the customer '
  'often has no case row). Case-linked touches continue to reach the customer '
  'through case_id -> cases.customer_id; this column is the direct path.';
