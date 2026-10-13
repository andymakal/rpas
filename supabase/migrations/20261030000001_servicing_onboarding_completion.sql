-- =============================================================================
-- Servicing-Agent Onboarding — complete the capture/stewardship workflow
-- Migration: 20261030000001_servicing_onboarding_completion.sql
--
-- The Servicing-Agent Onboarding workflow is the existing Stewardship flow
-- (customer_prereviews + stewardship_outreach + per-policy sa_status on
-- service_policies). This migration adds ONLY the small amount of non-derivable
-- state the workflow was still missing, re-homed on the existing tables. It adds
-- NO new workflow system, NO second database, NO tenancy or auth concepts.
--
-- What it adds, and why each is non-derivable:
--
--   1. Customer-verified contact flags on stewardship_outreach. "On file" is
--      already derivable from customers.email/phone/address. "The customer
--      themselves confirmed this value is correct" is a distinct human fact that
--      is NOT derivable from the contact value's mere presence. These three
--      nullable timestamps record that confirmation (null = not yet verified).
--
--   2. form_delivery_method on stewardship_outreach. The authorization form can
--      be delivered by email or by postal mail. Which channel was chosen for a
--      given outreach is an operator decision, not derivable from any other
--      record. Null until the worker picks a channel.
--
-- What it deliberately does NOT add:
--
--   * No follow-up "attempt count" or "max attempts" column. Follow-ups are
--     scheduled by rolling stewardship_outreach.follow_up_due / callback_date
--     forward on each unsuccessful attempt; there is NO arbitrary attempt limit,
--     so there is nothing to count or cap. The existing columns carry it.
--
--   * No new signed-form / carrier-submission / confirmation columns. Those
--     already exist: stewardship_outreach.form_received_at (signed form back),
--     submitted_at (sent to carrier), carrier_correction, and the PER-POLICY
--     servicing-agent confirmation on service_policies.sa_status /
--     sa_form_sent_at. This workflow reuses them unchanged.
--
-- Depends on: stewardship_outreach (20260927000003). Additive and nullable, so
-- no backfill and no change to existing rows. Grants are re-applied because the
-- stewardship tables rely on explicit table GRANTs (see 20261016000001).
-- =============================================================================


-- 1. Customer-verified contact flags. Each records WHEN the customer confirmed
--    that specific contact value is correct. Distinct from "a value is on file".
alter table public.stewardship_outreach
  add column if not exists phone_verified_at   timestamptz,
  add column if not exists email_verified_at   timestamptz,
  add column if not exists address_verified_at timestamptz;

comment on column public.stewardship_outreach.phone_verified_at is
  'When the customer confirmed their phone is correct during onboarding. Null = '
  'not customer-verified. Distinct from a phone merely being on file.';
comment on column public.stewardship_outreach.email_verified_at is
  'When the customer confirmed their email is correct during onboarding. Null = '
  'not customer-verified. Distinct from an email merely being on file.';
comment on column public.stewardship_outreach.address_verified_at is
  'When the customer confirmed their mailing address is correct during '
  'onboarding. Null = not customer-verified. Required-ish for postal delivery.';


-- 2. Authorization-form delivery channel. Null until the worker chooses.
alter table public.stewardship_outreach
  add column if not exists form_delivery_method text
    check (form_delivery_method in ('email', 'postal'));

comment on column public.stewardship_outreach.form_delivery_method is
  'How the servicing-agent authorization form was delivered to the customer: '
  'email or postal mail. Null until a channel is chosen. Operator decision; not '
  'derivable from other records.';


-- 3. Re-apply grants (stewardship tables depend on explicit table privileges;
--    adding columns does not change privileges, but this keeps the pattern
--    consistent and harmless if re-run).
grant all on public.stewardship_outreach to anon, authenticated, service_role;
