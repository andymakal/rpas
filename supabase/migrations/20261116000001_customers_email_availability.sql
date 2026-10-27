-- =============================================================================
-- Customer-level email availability
-- Migration: 20261116000001_customers_email_availability.sql
--
-- Email availability is a DURABLE CUSTOMER FACT: what the agency currently knows
-- about whether a customer can be reached by email, independent of any one
-- workflow (it was previously expressed only for the 1035 contact-review slice,
-- and only as a derived case_touches note marker). This adds the single field
-- that carries that fact for EVERY customer.
--
--   customers.email_availability text, nullable
--     NULL            — unknown / "Missing": no email on file and no reason
--                       recorded. This is the default for every existing
--                       customer, so this migration changes no business data.
--     'available'     — a usable email address is on file (the normal state).
--     'no_address'    — the customer confirmed they have NO email address.
--     'refused'       — the customer refuses to provide or use email.
--     'undeliverable' — a known address permanently failed; the address is
--                       removed from active use (customers.email) and preserved
--                       in Customer History (case_touches), and research for a
--                       REPLACEMENT is allowed.
--
-- This is the smallest field needed. It deliberately does NOT duplicate the
-- email itself, add a second history system, or change existing rows. The
-- preserved failed address and every status change are recorded in the one
-- durable history system (case_touches, 'workflow' touch_type) by the save
-- route, with the acting employee and a timestamp — never here.
--
-- Semantics honored by the application (not enforceable in SQL):
--   * 'no_address' and 'refused' STOP unnecessary email research.
--   * 'undeliverable' (with no usable address) ALLOWS research for a replacement.
--   * Entering a replacement email clears 'no_address' or 'undeliverable'
--     (-> 'available'); 'refused' persists until explicitly reversed.
--   * No automatic case close / stop-servicing / project removal is implied.
--
-- Additive and non-destructive: a nullable column with a value CHECK. Existing
-- customers remain valid with NULL (Missing).
-- =============================================================================

alter table public.customers
  add column if not exists email_availability text;

comment on column public.customers.email_availability is
  'Durable customer fact: current email availability. '
  'NULL = unknown/Missing (no email, reason unknown); '
  '''available'' = usable email on file; '
  '''no_address'' = customer has no email address; '
  '''refused'' = customer refuses email; '
  '''undeliverable'' = a known address permanently failed (address removed from '
  'customers.email and preserved in Customer History; research for a replacement '
  'is allowed). Status changes and the preserved failed address are recorded in '
  'case_touches (''workflow''), not here.';

alter table public.customers
  drop constraint if exists customers_email_availability_check;

alter table public.customers
  add constraint customers_email_availability_check
  check (email_availability is null
    or email_availability in ('available', 'no_address', 'refused', 'undeliverable'));
