-- =============================================================================
-- Add registration type to service_policies
-- Migration: 20261121000001_service_policies_registration.sql
--
-- Covers account/policy registration types used in investment products:
--   IRA, Roth IRA, Inherited IRA, Inherited Roth IRA,
--   TOD (Transfer on Death), JTWROS, Individual, Joint, Trust, etc.
-- Free-text with no check constraint — values are UI-enforced via dropdown.
-- =============================================================================

alter table public.service_policies
  add column if not exists registration text;

comment on column public.service_policies.registration is
  'Account registration type (IRA, Roth IRA, TOD, JTWROS, etc.). '
  'Primarily used for investment accounts; nullable for insurance policies.';
