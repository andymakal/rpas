-- =============================================================================
-- RPAS Core Entity Tables — Row Level Security
-- Migration: 20260516000002_core_entities_rls.sql
--
-- Depends on: 20260516000001_core_entities_ddl.sql
--
-- Auth model:
--   Agencies authenticate via Supabase Auth. On sign-in, two custom JWT claims
--   are injected (see §CUSTOM CLAIM SETUP below):
--     agency_id  uuid    — the agency this user belongs to
--     app_role   text    — 'agency' | 'admin'
--
--   Roles:
--     authenticated + app_role = 'agency'  →  agency dashboard user
--     authenticated + app_role = 'admin'   →  SML team / internal admin
--     service_role                          →  Next.js server-side mutations
--                                              (bypasses RLS entirely)
--
--   Agency users get SELECT only on their own data.
--   All INSERT / UPDATE / DELETE goes through service_role (server-side API routes).
--   Admin users get full SELECT across all agencies; writes still via service_role.
--
-- is_test enforcement:
--   Agency policies always add `is_test = false`. Admins see all rows including
--   test data (they need to verify seeding). Service role bypasses RLS.
--
-- Catalog tables (Phase 1):
--   stage_translations, products, carriers, etc. are readable by all authenticated
--   users. No write access for either role.
--
-- §CUSTOM CLAIM SETUP (application responsibility — not in this migration):
--   In Supabase Dashboard → Authentication → Hooks, set a "Custom Access Token"
--   hook pointing to the function below. This runs on every token mint/refresh.
--
--   create or replace function public.custom_access_token_hook(event jsonb)
--   returns jsonb language plpgsql as $$
--   declare
--     claims      jsonb;
--     agency_row  record;
--   begin
--     select id, is_test
--       into agency_row
--       from public.agency_members   -- your user→agency mapping table
--       where user_id = (event ->> 'user_id')::uuid
--       limit 1;
--
--     claims := event -> 'claims';
--     if agency_row.id is not null then
--       claims := jsonb_set(claims, '{agency_id}', to_jsonb(agency_row.id));
--       claims := jsonb_set(claims, '{app_role}',  '"agency"');
--     else
--       claims := jsonb_set(claims, '{app_role}', '"admin"');
--     end if;
--     return jsonb_set(event, '{claims}', claims);
--   end;
--   $$;
--
--   NOTE: if you store agency membership in a different table, update the
--   function above. The hook must be granted execute to supabase_auth_admin.
-- =============================================================================


-- =============================================================================
-- HELPER: extract agency_id from the current JWT
-- Returns null if the claim is absent (blocks all agency-scoped policies).
-- =============================================================================
create or replace function public.jwt_agency_id()
returns uuid
language sql stable
as $$
  select nullif(auth.jwt() ->> 'agency_id', '')::uuid;
$$;

-- Helper: true when the caller is an admin (SML team internal user)
create or replace function public.jwt_is_admin()
returns boolean
language sql stable
as $$
  select coalesce(auth.jwt() ->> 'app_role', '') = 'admin';
$$;


-- =============================================================================
-- AGENCIES
-- =============================================================================
alter table public.agencies enable row level security;

-- Agency users see only their own agency row.
create policy agencies_agency_select
  on public.agencies
  for select
  to authenticated
  using (
    public.jwt_is_admin()
    or (
      id = public.jwt_agency_id()
      and is_active = true
      and is_test = false
    )
  );


-- =============================================================================
-- CUSTOMERS
-- =============================================================================
alter table public.customers enable row level security;

create policy customers_agency_select
  on public.customers
  for select
  to authenticated
  using (
    public.jwt_is_admin()
    or (
      agency_id = public.jwt_agency_id()
      and is_test = false
    )
  );


-- =============================================================================
-- AGENTS
-- =============================================================================
alter table public.agents enable row level security;

create policy agents_agency_select
  on public.agents
  for select
  to authenticated
  using (
    public.jwt_is_admin()
    or (
      agency_id = public.jwt_agency_id()
      and is_test = false
    )
  );


-- =============================================================================
-- CASES
-- =============================================================================
alter table public.cases enable row level security;

create policy cases_agency_select
  on public.cases
  for select
  to authenticated
  using (
    public.jwt_is_admin()
    or (
      agency_id = public.jwt_agency_id()
      and is_test = false
    )
  );


-- =============================================================================
-- CASE PENDING REQUIREMENTS
-- No agency_id column here — security is inherited via the parent case.
-- The subquery is index-supported: cases_agency_status_idx covers (agency_id, internal_status)
-- and the cases_customer_id_idx covers the case_id lookup.
-- =============================================================================
alter table public.case_pending_requirements enable row level security;

create policy case_pending_req_agency_select
  on public.case_pending_requirements
  for select
  to authenticated
  using (
    public.jwt_is_admin()
    or exists (
      select 1
        from public.cases c
       where c.id = case_id
         and c.agency_id = public.jwt_agency_id()
         and c.is_test = false
    )
  );


-- =============================================================================
-- INTAKE_RAW
-- =============================================================================
alter table public.intake_raw enable row level security;

create policy intake_raw_agency_select
  on public.intake_raw
  for select
  to authenticated
  using (
    public.jwt_is_admin()
    or (
      agency_id = public.jwt_agency_id()
      and is_test = false
    )
  );


-- =============================================================================
-- CATALOG / SETTINGS TABLES (Phase 1)
-- All authenticated users can read catalog data.
-- No writes from the authenticated role — catalog is managed via service_role
-- (admin tooling / migrations only).
-- =============================================================================
alter table public.stage_translations    enable row level security;
alter table public.products              enable row level security;
alter table public.carriers              enable row level security;
alter table public.product_types         enable row level security;
alter table public.rate_classes          enable row level security;
alter table public.premium_modes         enable row level security;
alter table public.lost_reasons          enable row level security;
alter table public.snooze_reasons        enable row level security;
alter table public.service_request_types enable row level security;
alter table public.request_statuses      enable row level security;
alter table public.pending_requirements  enable row level security;
alter table public.opportunity_types     enable row level security;
alter table public.review_statuses       enable row level security;
alter table public.health_change_types   enable row level security;

-- sml_teams is internal-only: agencies must NOT see it.
alter table public.sml_teams enable row level security;

create policy stage_translations_read    on public.stage_translations    for select to authenticated using (true);
create policy products_read              on public.products              for select to authenticated using (true);
create policy carriers_read              on public.carriers              for select to authenticated using (true);
create policy product_types_read         on public.product_types         for select to authenticated using (true);
create policy rate_classes_read          on public.rate_classes          for select to authenticated using (true);
create policy premium_modes_read         on public.premium_modes         for select to authenticated using (true);
create policy lost_reasons_read          on public.lost_reasons          for select to authenticated using (true);
create policy snooze_reasons_read        on public.snooze_reasons        for select to authenticated using (true);
create policy service_request_types_read on public.service_request_types for select to authenticated using (true);
create policy request_statuses_read      on public.request_statuses      for select to authenticated using (true);
create policy pending_requirements_read  on public.pending_requirements  for select to authenticated using (true);
create policy opportunity_types_read     on public.opportunity_types     for select to authenticated using (true);
create policy review_statuses_read       on public.review_statuses       for select to authenticated using (true);
create policy health_change_types_read   on public.health_change_types   for select to authenticated using (true);

-- sml_teams: admin-only; agency users must never see producer assignments.
create policy sml_teams_admin_only
  on public.sml_teams
  for select
  to authenticated
  using (public.jwt_is_admin());


-- =============================================================================
-- VERIFICATION QUERIES
-- Run after applying to confirm policies are wired correctly.
-- Remove or comment out before committing to CI.
-- =============================================================================
-- select schemaname, tablename, policyname, roles, cmd, qual
--   from pg_policies
--  where schemaname = 'public'
--  order by tablename, policyname;
