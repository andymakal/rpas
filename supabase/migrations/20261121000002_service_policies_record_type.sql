-- =============================================================================
-- Add record_type, account_value, account_value_as_of to service_policies
-- Migration: 20261121000002_service_policies_record_type.sql
--
-- Splits the service_policies table into logical "policies" (life insurance)
-- and "accounts" (annuities, mutual funds, UITs, brokerage) using a
-- record_type discriminator, with account-specific value tracking columns.
-- =============================================================================

alter table public.service_policies
  add column if not exists record_type text not null default 'policy'
    check (record_type in ('policy', 'account'));

alter table public.service_policies
  add column if not exists account_value numeric(14,2);

alter table public.service_policies
  add column if not exists account_value_as_of date;

comment on column public.service_policies.record_type is
  'Discriminator: "policy" for life/LTC insurance, "account" for investment '
  'products (annuities, mutual funds, UITs, brokerage) written through the BD.';

comment on column public.service_policies.account_value is
  'Current account/contract value. Used for investment accounts and annuities. '
  'Nullable; recorded with account_value_as_of to anchor the valuation date.';

comment on column public.service_policies.account_value_as_of is
  'Date of the account_value snapshot (from the most recent statement).';

-- Backfill: annuities and investment products are accounts, not policies.
-- Case-insensitive match on the product_type values the UI writes today.
update public.service_policies
  set record_type = 'account'
  where lower(product_type) in (
    'annuity', 'fa', 'mva', 'money market', 'mutual fund', 'uit', 'brokerage'
  )
    and record_type = 'policy';
