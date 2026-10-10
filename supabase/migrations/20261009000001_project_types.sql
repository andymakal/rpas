-- =============================================================================
-- Project types — durable lookup for project_type, replacing free text
-- Migration: 20261009000001_project_types.sql
--
-- The projects foundation (20261008230000) stored project_type as free text.
-- This migration normalizes it into a durable lookup table and points projects
-- at it by foreign key:
--
--   project_types          — the durable catalog of project kinds (e.g.
--                            "1035 Exchange"). Soft-deletable via is_active:
--                            inactive types are hidden from the "Start New"
--                            dropdown but are NEVER deleted, so projects that
--                            already reference them keep their type.
--   projects.project_type_id — FK to project_types. on delete restrict means a
--                            type that is in use cannot be removed at all; the
--                            soft-delete (is_active = false) is the only way to
--                            retire a type, which preserves existing projects'
--                            type exactly as required.
--
-- Backfill: any distinct existing projects.project_type text is turned into a
-- project_types row and linked, so a replay against a populated database keeps
-- every project's type. (On the development branch there are currently no
-- projects, so the backfill is a no-op, but it stays correct for any replay.)
--
-- Seed: "1035 Exchange" is inserted with a fixed id so the first project can be
-- created immediately and the id is stable across environments.
--
-- Depends on: projects (20261008230000), set_updated_at() and jwt_is_admin()
--             (earlier in the chain). Writes via service_role; internal staff
--             (admin) read. Internal-only; no agency portal access.
-- =============================================================================


-- =============================================================================
-- 1. PROJECT TYPES
-- The durable catalog of project kinds. name is unique. is_active soft-retires a
-- type without deleting it, so projects referencing it keep their type.
-- =============================================================================
create table if not exists public.project_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.project_types is
  'Durable catalog of project kinds (e.g. "1035 Exchange"). Referenced by '
  'projects.project_type_id. Retire a type by setting is_active = false; types '
  'are never deleted, so existing projects keep their type.';

comment on column public.project_types.is_active is
  'When false, the type is hidden from the "Start New" dropdown but remains '
  'referenceable; projects that already use it are unaffected.';

-- Case-insensitive uniqueness so "1035 Exchange" and "1035 exchange" cannot
-- both exist as separate catalog rows.
create unique index if not exists project_types_name_key
  on public.project_types (lower(name));

create index if not exists project_types_active_idx
  on public.project_types (is_active)
  where is_active;


-- =============================================================================
-- 2. SEED — the first project type
-- Fixed id so it is stable across environments and the first project can be
-- created straight away. on conflict keeps a replay idempotent.
-- =============================================================================
insert into public.project_types (id, name, description, is_active)
values (
  'a1035000-0000-4000-8000-000000000001'::uuid,
  '1035 Exchange',
  'IRS Section 1035 exchange initiative — moving cash-value coverage to a new '
  'contract without triggering a taxable event.',
  true
)
on conflict (lower(name)) do nothing;


-- =============================================================================
-- 3. PROJECTS → PROJECT_TYPES FK
-- Add the FK column, backfill from the existing text, then enforce NOT NULL and
-- drop the old text column. on delete restrict guarantees a type in use cannot
-- be deleted (soft-delete via is_active is the retirement path).
-- =============================================================================

-- 3a. Add the nullable FK column first so the backfill can populate it.
alter table public.projects
  add column if not exists project_type_id uuid references public.project_types (id) on delete restrict;

-- 3b. Backfill: turn every distinct existing project_type text into a catalog
-- row (if not already present), then link each project to its type. Guarded so
-- it only runs while the old text column is still present.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projects' and column_name = 'project_type'
  ) then
    -- create any missing catalog rows from distinct existing values
    insert into public.project_types (name, is_active)
    select distinct btrim(p.project_type), true
    from public.projects p
    where p.project_type is not null
      and btrim(p.project_type) <> ''
      and not exists (
        select 1 from public.project_types t
        where lower(t.name) = lower(btrim(p.project_type))
      );

    -- link each project to the matching catalog row
    update public.projects p
       set project_type_id = t.id
      from public.project_types t
     where p.project_type_id is null
       and p.project_type is not null
       and lower(t.name) = lower(btrim(p.project_type));
  end if;
end
$$;

-- 3c. Enforce NOT NULL now that every row is backfilled.
alter table public.projects
  alter column project_type_id set not null;

-- 3d. Drop the old free-text column — project_types is now authoritative.
alter table public.projects
  drop column if exists project_type;

create index if not exists projects_project_type_id_idx
  on public.projects (project_type_id);


-- =============================================================================
-- 4. TABLE PRIVILEGES
-- Match every existing public table: default privileges do not auto-grant DML to
-- the API roles on this branch, so grant explicitly or PostgREST returns 403.
-- RLS below gates row access.
-- =============================================================================
grant all on public.project_types to anon, authenticated, service_role;


-- =============================================================================
-- 5. ROW LEVEL SECURITY
-- Internal staff (admin) read; all writes via service_role. Matches the rest of
-- the projects / service / stewardship modules. Internal-only.
-- =============================================================================
alter table public.project_types enable row level security;

create policy project_types_admin_select
  on public.project_types for select to authenticated
  using (public.jwt_is_admin());

create policy project_types_all
  on public.project_types for all to service_role
  using (true) with check (true);


-- Refresh PostgREST's schema cache so the new table / column are visible via the
-- API immediately.
notify pgrst, 'reload schema';
