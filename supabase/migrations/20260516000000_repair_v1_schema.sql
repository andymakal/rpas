-- =============================================================================
-- REPAIR: Remove rpas-schema-v1.sql tables and any partial Phase 2 work
-- Run this ONCE in SQL Editor, then re-run files 4, 5, and 6:
--   20260516000001_core_entities_ddl.sql
--   20260516000002_core_entities_rls.sql
--   20260516000003_agency_members.sql
-- =============================================================================

-- ── Drop old v1 tables (wrong schema — no data worth keeping) ─────────────────
drop table if exists public.referrals      cascade;
drop table if exists public.lsps           cascade;
drop table if exists public.agencies       cascade;

-- ── Drop any partial Phase 2 tables (in case DDL partially ran) ───────────────
drop table if exists public.case_pending_requirements cascade;
drop table if exists public.intake_raw     cascade;
drop table if exists public.cases          cascade;
drop table if exists public.agents         cascade;
drop table if exists public.customers      cascade;
drop table if exists public.agency_members cascade;

-- ── Drop partial Phase 2 functions ───────────────────────────────────────────
drop function if exists public.custom_access_token_hook(jsonb);
drop function if exists public.cases_track_status_change();
drop function if exists public.set_updated_at();
drop function if exists public.jwt_agency_id();
drop function if exists public.jwt_is_admin();

-- ── Drop any catalog policies created before the error hit ───────────────────
-- (safe even if they don't exist yet)
drop policy if exists stage_translations_read    on public.stage_translations;
drop policy if exists products_read              on public.products;
drop policy if exists carriers_read              on public.carriers;
drop policy if exists product_types_read         on public.product_types;
drop policy if exists rate_classes_read          on public.rate_classes;
drop policy if exists premium_modes_read         on public.premium_modes;
drop policy if exists lost_reasons_read          on public.lost_reasons;
drop policy if exists snooze_reasons_read        on public.snooze_reasons;
drop policy if exists service_request_types_read on public.service_request_types;
drop policy if exists request_statuses_read      on public.request_statuses;
drop policy if exists pending_requirements_read  on public.pending_requirements;
drop policy if exists opportunity_types_read     on public.opportunity_types;
drop policy if exists review_statuses_read       on public.review_statuses;
drop policy if exists health_change_types_read   on public.health_change_types;
drop policy if exists sml_teams_admin_only       on public.sml_teams;
