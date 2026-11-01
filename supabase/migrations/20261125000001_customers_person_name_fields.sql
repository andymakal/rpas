-- =============================================================================
-- Person-name fields on the customer record
-- Migration: 20261125000001_customers_person_name_fields.sql
--
-- Backs the reusable Person Name component. Today customers carry only
-- first_name and last_name. A full recorded name and a familiar name need a
-- few more durable facts, added here as additive, nullable columns on the
-- existing customers row (one database, single tenant — no new table).
--
--   customers.middle_name text, nullable
--     The recorded middle name(s), kept whole and as typed (multiple words
--     allowed: "Anne Marie"). NULL = none recorded. Never inferred, never
--     auto-included in a greeting.
--
--   customers.suffix text, nullable
--     The generational suffix as typed ("Jr", "Sr", "III", "IV"). NULL = none.
--     Free text so an unusual suffix is preserved rather than forced into a
--     fixed list.
--
--   customers.goes_by text, nullable
--     The name the customer is actually called — a "Goes by" / preferred first
--     name ("Bob" for Robert, "Beth" for Elizabeth). NULL = none; the familiar
--     and greeting presentations then fall back to first_name. Never inferred
--     from the first name.
--
--   customers.suffix_in_familiar boolean, nullable
--     Preference for whether the generational suffix appears in the FAMILIAR
--     name (e.g. "Bob Smith Jr"). NULL = no preference recorded, which the
--     application treats as YES (default to including the suffix). An explicit
--     false suppresses the suffix from the familiar name only; the full
--     recorded name always keeps it.
--
-- Spelling, capitalization (McDonald, DeLuca), and multi-word names are
-- preserved exactly as entered — normalization only collapses whitespace and
-- trims, never title-cases or splits. No existing customer data is changed:
-- every column is nullable with no backfill.
-- =============================================================================

alter table public.customers
  add column if not exists middle_name        text,
  add column if not exists suffix             text,
  add column if not exists goes_by            text,
  add column if not exists suffix_in_familiar boolean;

comment on column public.customers.middle_name is
  'Recorded middle name(s), kept whole and as typed (multiple words allowed). '
  'NULL = none. Never inferred, never auto-included in a greeting.';

comment on column public.customers.suffix is
  'Generational suffix as typed (Jr, Sr, III). Free text; NULL = none.';

comment on column public.customers.goes_by is
  'The name the customer is called (preferred first / "Goes by"). NULL = none, '
  'then familiar and greeting names fall back to first_name. Never inferred.';

comment on column public.customers.suffix_in_familiar is
  'Preference for showing the suffix in the FAMILIAR name. NULL = no preference '
  '(application defaults to YES / include). Explicit false suppresses the suffix '
  'from the familiar name only; the full recorded name always keeps it.';
