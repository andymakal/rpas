-- =============================================================================
-- Simplify customers.email_availability: drop the separate 'refused' state
-- Migration: 20261117000001_email_availability_simplify.sql
--
-- Email availability is an informational customer fact with three recorded
-- values plus the normal on-file state:
--   NULL            — unknown / "Missing".
--   'available'     — a usable email address is on file.
--   'no_address'    — "No Usable Email": the customer has no email address OR
--                     will not provide one (this now covers what was 'refused').
--   'undeliverable' — a known address permanently failed and was removed from
--                     active use (the failed address stays in Customer History).
--
-- The earlier separate 'refused' state is removed and folded into 'no_address'.
-- Any existing 'refused' row is rewritten to 'no_address' before the CHECK is
-- tightened. This is the smallest correction to the development migration added
-- in 20261116000001; it changes no other column and no business data beyond the
-- value fold. (The folded history notes already written under the old label are
-- left intact — they are durable history, not live state.)
-- =============================================================================

-- Fold any recorded 'refused' into 'no_address' (no rows expected in practice,
-- but written so the tightened CHECK can never reject existing data).
update public.customers
  set email_availability = 'no_address'
  where email_availability = 'refused';

alter table public.customers
  drop constraint if exists customers_email_availability_check;

alter table public.customers
  add constraint customers_email_availability_check
  check (email_availability is null
    or email_availability in ('available', 'no_address', 'undeliverable'));

comment on column public.customers.email_availability is
  'Informational customer fact: current email availability. '
  'NULL = unknown/Missing (no email, reason unknown); '
  '''available'' = usable email on file; '
  '''no_address'' = No Usable Email (none, or customer will not provide one); '
  '''undeliverable'' = a known address permanently failed (address removed from '
  'customers.email and preserved in Customer History). Changes are recorded in '
  'case_touches (''workflow''). Informational only: it suppresses no research, '
  'routes no queue, and sets no terminal state.';
