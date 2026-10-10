-- =============================================================================
-- Stewardship tables — missing API-role table privileges
-- Migration: 20261016000001_stewardship_grants.sql
--
-- The stewardship foundation migrations (20260927000002_stewardship_prereview,
-- 20260927000003_stewardship_outreach) enabled RLS and added policies but never
-- GRANTed table privileges to the Supabase API roles. On this branch default
-- privileges do NOT auto-grant DML to anon / authenticated / service_role, so
-- PostgREST returns 42501 "permission denied" even for service_role (which
-- bypasses RLS but still needs the table privilege). This is the same gap the
-- projects foundation migration (20261008230000) called out and fixed for its
-- own tables; the stewardship tables predate that discovery.
--
-- Without these grants, starting stewardship work (POST /api/stewardship/start)
-- fails for every path — agency book and project alike — because the admin
-- client cannot insert customer_prereviews / stewardship_outreach rows.
--
-- RLS still gates row access (anon / authenticated restricted by the existing
-- policies; service_role bypasses RLS). These grants only make the tables
-- reachable through the API, matching every existing public table.
-- =============================================================================

grant all on public.customer_prereviews          to anon, authenticated, service_role;
grant all on public.stewardship_outreach          to anon, authenticated, service_role;
grant all on public.stewardship_outreach_policies to anon, authenticated, service_role;

-- policy_documents and policy_review_policies were added in the same
-- prereview migration without grants; grant them too so the documentation
-- layer that follows stewardship is reachable through the API as well.
grant all on public.policy_documents       to anon, authenticated, service_role;
grant all on public.policy_review_policies to anon, authenticated, service_role;
