-- =============================================================================
-- RPAS: Staff Profiles + Customer Notes
-- Migration: 20260711000001_customer_notes.sql
--
-- Changes:
--   1. staff_profiles  — maps auth.users.id → display name for internal staff
--   2. customer_notes  — running compliance log per customer
-- =============================================================================


-- =============================================================================
-- 1. STAFF PROFILES
-- One row per internal team member. Keyed to their existing auth.users.id so
-- note authorship is resolved automatically from the session — no extra login.
-- =============================================================================
create table public.staff_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now()
);

alter table public.staff_profiles enable row level security;

create policy staff_profiles_admin_select
  on public.staff_profiles
  for select to authenticated
  using (public.jwt_is_admin());

-- Seed: internal Right Path team
insert into public.staff_profiles (id, display_name) values
  ('1a153da7-a0f8-4742-82c1-8a0ed5969268', 'Andy Makal'),
  ('02d328c6-10fb-4a44-9063-7e93411de7cc', 'Bob Pfromm'),
  ('80282142-925c-49e8-8899-e64719afb0f0', 'Dulce Velazquez'),
  ('2b44645a-f755-43b6-aab9-c070eb10de3b', 'Nikki Fox'),
  ('49323b2f-fc31-4a5c-baf7-6158591195a9', 'Gabe Aldridge'),
  ('fcbdc978-da30-40fa-83e8-6b69de9f444a', 'Ashley Brown'),
  ('6dabae1c-ebf9-4a3e-8a39-b7637ff466df', 'Abigail Brown'),
  ('76c98896-035a-4696-bca4-78b457330a8b', 'Lucas Pearson'),
  ('0d2ee55f-d030-4820-85c3-a99de2b22b5d', 'Tyler Gee'),
  ('27eab126-8d14-4b39-a9da-6b4b248ba6d9', 'Angie Strem');


-- =============================================================================
-- 2. CUSTOMER NOTES
-- Running compliance log. Each row is a single timestamped entry — immutable
-- once written. Deletion is intentionally not exposed in the app UI.
--
-- section: which workflow area the note relates to (anyone can post to any section)
-- author_name: denormalized at write time so the log survives staff turnover
-- =============================================================================
create table public.customer_notes (
  id           uuid        primary key default gen_random_uuid(),
  customer_id  uuid        not null references public.customers(id) on delete cascade,
  section      text        not null
                 constraint customer_notes_section_valid
                 check (section in ('triage', 'producer', 'underwriting')),
  author_id    uuid        not null references auth.users(id),
  author_name  text        not null,
  body         text        not null
                 constraint customer_notes_body_nonempty
                 check (length(trim(body)) > 0),
  created_at   timestamptz not null default now()
);

create index customer_notes_customer_idx on public.customer_notes(customer_id, created_at desc);

alter table public.customer_notes enable row level security;

-- Internal staff can read all notes
create policy customer_notes_admin_select
  on public.customer_notes
  for select to authenticated
  using (public.jwt_is_admin());

-- Internal staff can insert notes (server validates auth before calling admin client)
create policy customer_notes_admin_insert
  on public.customer_notes
  for insert to authenticated
  with check (public.jwt_is_admin());

-- Agency portal users have no access to internal staff notes
