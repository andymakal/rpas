-- =============================================================================
-- Add quoted_carrier and quoted_product_type to cases
-- Migration: 20260528000002_cases_quote_fields.sql
--
-- These two text columns capture the carrier and product type recorded when a
-- referral is marked "Quote Provided" (internal_status = 'quoted'). They are
-- deliberately plain text (not FKs) because:
--   - At the quote stage the formal product has not been selected yet.
--   - The carrier dropdown mirrors the service module list, not the products
--     table, which is age-banded and tied to GDC calculations.
--   - product_id (the FK to products) is reserved for the formal application
--     stage once the client decides to proceed.
-- =============================================================================

alter table public.cases
  add column if not exists quoted_carrier      text,
  add column if not exists quoted_product_type text;

comment on column public.cases.quoted_carrier is
  'Carrier name recorded when the case is moved to the quoted stage. '
  'Plain text — mirrors the carrier dropdown in the service module.';

comment on column public.cases.quoted_product_type is
  'Product type recorded when the case is moved to the quoted stage '
  '(e.g. Term Life, IUL, Whole Life). Plain text — not a FK to products.';
