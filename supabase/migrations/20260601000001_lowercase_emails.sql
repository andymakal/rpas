-- =============================================================================
-- Lowercase all existing email addresses
-- Migration: 20260601000001_lowercase_emails.sql
--
-- Going forward, normalizeEmail() enforces lowercase at every save point.
-- This migration backfills existing records so the database is consistent.
-- =============================================================================

-- Agents (LSPs)
update public.agents
set email = lower(trim(email))
where email is not null
  and email != lower(trim(email));

-- Customers
update public.customers
set email = lower(trim(email))
where email is not null
  and email != lower(trim(email));

-- Producers (internal team)
update public.producers
set email = lower(trim(email))
where email is not null
  and email != lower(trim(email));
