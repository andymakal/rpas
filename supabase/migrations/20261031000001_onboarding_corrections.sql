-- =============================================================================
-- Servicing-Agent Onboarding — correctness fixes (permanent verification +
-- durable completion marker)
-- Migration: 20261031000001_onboarding_corrections.sql
--
-- Two corrections to the onboarding (Stewardship) workflow. Both re-home state
-- that was being kept in the wrong place; neither redesigns the workflow.
--
--   1. Customer-verified contact flags belong on the CUSTOMER, not on the
--      temporary outreach row. A customer confirming their phone / email /
--      address is correct is durable customer-record truth that must survive the
--      end of outreach (the stewardship_outreach row is deleted when onboarding
--      completes). The earlier placement on stewardship_outreach
--      (20261030000001) lost the verification the moment onboarding finished.
--      These three nullable timestamps on customers are the permanent home.
--
--   2. Onboarding COMPLETION needs a durable, non-derivable marker. Completion
--      cannot be inferred from service_policies.sa_status = 'confirmed': a policy
--      can reach confirmed by routes unrelated to an onboarding run, and the
--      request-policy set is deleted (cascade) when the outreach row is removed
--      on completion, so after the fact there is nothing to derive "this
--      onboarding completed" from. customer_prereviews.servicing_completed_at
--      records exactly when a servicing-agent onboarding run finished (every
--      request policy confirmed). It drives: the accurate completed-onboarding
--      summary, the Wanderer -> Explorer promotion (which now fires at
--      completion, not on the first per-policy confirmation), and the Initial
--      Analysis handoff.
--
-- Additive and nullable, so no backfill and no change to existing rows. The
-- stewardship_outreach.*_verified_at columns from 20261030000001 are left in
-- place (harmless, unused) rather than dropped, to keep this migration purely
-- additive and reversible; application code now reads/writes the customers
-- columns exclusively.
--
-- Depends on: customers (20260516000001), customer_prereviews (20260927000002).
-- =============================================================================


-- 1. Permanent customer-verified contact flags on the CUSTOMER record.
alter table public.customers
  add column if not exists phone_verified_at   timestamptz,
  add column if not exists email_verified_at   timestamptz,
  add column if not exists address_verified_at timestamptz;

comment on column public.customers.phone_verified_at is
  'When the customer last confirmed their phone is correct (servicing-agent '
  'onboarding verification). Null = not customer-verified. Durable; distinct '
  'from a phone merely being on file.';
comment on column public.customers.email_verified_at is
  'When the customer last confirmed their email is correct. Null = not '
  'customer-verified. Durable; distinct from an email merely being on file.';
comment on column public.customers.address_verified_at is
  'When the customer last confirmed their mailing address is correct. Null = '
  'not customer-verified. Durable; distinct from an address being on file.';


-- 2. Durable onboarding-completion marker on the pre-review work item.
alter table public.customer_prereviews
  add column if not exists servicing_completed_at timestamptz;

comment on column public.customer_prereviews.servicing_completed_at is
  'When the servicing-agent onboarding run for this customer completed (every '
  'policy in the request had its servicing agent confirmed). Durable and '
  'non-derivable: the outreach row and its request-policy links are deleted on '
  'completion. Null while onboarding is in progress or never run. Drives the '
  'completed-onboarding summary, the Wanderer->Explorer promotion, and the '
  'Initial Analysis handoff.';
