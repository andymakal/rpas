-- =============================================================================
-- Add segment (Right Path tier) to customers
-- Migration: 20260627000001_customers_segment.sql
--
-- Tiers (lowest → highest):
--   wanderer    — legacy policy holder (Everlake/LBL), service only
--   explorer    — life insurance client we wrote
--   pathfinder  — financial client, AUM < $100K
--   voyageur    — financial client, AUM $100K–$500K
--   trailblazer — financial client, AUM > $500K
--
-- Null = unassigned. Manually set; system surfaces suggestions based on data.
-- =============================================================================

alter table public.customers
  add column if not exists segment text
  check (segment in ('wanderer', 'explorer', 'pathfinder', 'voyageur', 'trailblazer'));

comment on column public.customers.segment is
  'Right Path client tier. Null = unassigned. '
  'wanderer < explorer < pathfinder < voyageur < trailblazer.';
