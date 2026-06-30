-- =============================================================================
-- Fix misspelled agency portal slug for Brittney Bianco
-- Migration: 20260630000001_fix_bianco_brittney_slug.sql
--
-- Slug was seeded as 'bianco-brittany' (typo) but the agency name is
-- 'BIANCO, BRITTNEY'. Corrects the slug to 'bianco-brittney' so the portal
-- URL matches the spelling of her name.
-- =============================================================================

update public.agencies
  set slug = 'bianco-brittney'
  where slug = 'bianco-brittany';
