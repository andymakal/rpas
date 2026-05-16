-- =============================================================================
-- RPAS Agency Members — User → Agency Mapping + JWT Hook
-- Migration: 20260516000003_agency_members.sql
--
-- Links a Supabase Auth user (auth.users.id) to an agency.
-- One user per agency in the standard model (the agency principal's login).
-- Add additional rows if an agency ever needs multiple logins.
--
-- Also installs the custom_access_token_hook that injects agency_id and
-- app_role into every JWT on sign-in and token refresh.
-- =============================================================================


-- =============================================================================
-- AGENCY MEMBERS
-- =============================================================================
create table if not exists public.agency_members (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  agency_id   uuid not null references public.agencies (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint agency_members_user_unique unique (user_id)
  -- one user belongs to one agency; remove this constraint if multi-agency logins needed
);

comment on table public.agency_members is
  'Maps a Supabase Auth user to one agency. '
  'Users without a row here are treated as internal admins (app_role = admin).';

create index if not exists agency_members_agency_id_idx on public.agency_members (agency_id);


-- =============================================================================
-- CUSTOM ACCESS TOKEN HOOK
-- Supabase calls this function every time it mints or refreshes a JWT.
-- It adds two claims:
--   agency_id  — the agency this user belongs to (null for admins)
--   app_role   — 'agency' or 'admin'
--
-- After running this migration, enable the hook in:
--   Supabase Dashboard → Authentication → Hooks
--   → Custom Access Token → select function: public.custom_access_token_hook
-- =============================================================================
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims    jsonb;
  member    record;
begin
  -- Look up whether this user is mapped to an agency
  select agency_id
    into member
    from public.agency_members
   where user_id = (event ->> 'user_id')::uuid
   limit 1;

  claims := event -> 'claims';

  if member.agency_id is not null then
    -- Agency dashboard user
    claims := jsonb_set(claims, '{agency_id}', to_jsonb(member.agency_id));
    claims := jsonb_set(claims, '{app_role}',  '"agency"');
  else
    -- No agency mapping = internal admin (SML team)
    claims := jsonb_set(claims, '{agency_id}', 'null');
    claims := jsonb_set(claims, '{app_role}',  '"admin"');
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Supabase Auth needs execute permission on this function
grant execute
  on function public.custom_access_token_hook
  to supabase_auth_admin;

-- Prevent agency users from reading the members table directly
alter table public.agency_members enable row level security;

create policy agency_members_admin_only
  on public.agency_members
  for select
  to authenticated
  using (public.jwt_is_admin());
