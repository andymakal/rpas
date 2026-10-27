-- =============================================================================
-- Customer-level contact alert
-- Migration: 20261118000001_customers_contact_alert.sql
--
-- One short, free-text alert per customer, shown prominently at the top of the
-- shared Customer Contact card wherever it renders (the customer record, Contact
-- Research, and the stewardship working screens). It is a DURABLE CUSTOMER FACT
-- that travels with the customer, not a workflow object: there are no
-- categories, priorities, expiration dates, or routing rules, and it creates no
-- separate notes system. An empty alert is simply NULL and displays nothing.
--
--   customers.contact_alert text, nullable
--     NULL — no alert (the default for every existing customer, so this
--            migration changes no business data).
--     text — the current alert message, shown as the card's alert banner.
--
-- This is the smallest field needed: a single nullable text column on the
-- existing customers row, re-homed on Right Path's one database and single
-- tenant. Add / Edit / Clear all map to writing or nulling this one column
-- through the existing shared contact save route; this migration only adds the
-- storage.
--
-- Additive and non-destructive: a nullable column, no constraint, no backfill.
-- =============================================================================

alter table public.customers
  add column if not exists contact_alert text;

comment on column public.customers.contact_alert is
  'Durable single customer alert (free text), shown at the top of the shared '
  'Customer Contact card wherever it renders. NULL = no alert. One current alert '
  'per customer; no categories, priorities, expiration, or workflow rules. '
  'Add/Edit/Clear write this one column via the shared contact save route.';
