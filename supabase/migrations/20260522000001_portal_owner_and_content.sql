-- =============================================================================
-- RPAS: Portal Owner PIN + Portal Content
-- Migration: 20260522000001_portal_owner_and_content.sql
--
-- Changes:
--   1. agencies.owner_pin  → 4-8 digit PIN for owner-mode unlock (default 0000)
--   2. portal_content      → training/bulletin/resource cards for portal right column
-- =============================================================================


-- =============================================================================
-- 1. OWNER PIN ON AGENCIES
-- Separate from the portal entry PIN (portal_pin / agent_number).
-- The owner enters this PIN from within the portal to unlock the owner section,
-- which shows GDC transactions, chargebacks, and PIN management.
-- Admins can see and reset these in the Agencies admin page.
-- =============================================================================
alter table public.agencies
  add column if not exists owner_pin text not null default '0000';


-- =============================================================================
-- 2. PORTAL CONTENT
-- Drives the right-column cards on each agency portal:
--   training  → Training Schedule card
--   bulletin  → Bulletins card
--   resource  → Quick Links in left column
--
-- agency_id = NULL means the item appears on ALL portals (global content).
-- agency_id = <uuid> means the item appears only on that agency's portal.
-- =============================================================================
create table if not exists public.portal_content (
  id           uuid        primary key default gen_random_uuid(),
  agency_id    uuid        references public.agencies(id) on delete cascade,
  content_type text        not null
                 constraint portal_content_type_valid
                 check (content_type in ('training', 'bulletin', 'resource')),
  title        text        not null,
  body         text,
  link         text,
  link_label   text,
  is_active    boolean     not null default true,
  sort_order   int         not null default 0,
  expires_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists portal_content_agency_idx on public.portal_content (agency_id);
create index if not exists portal_content_type_idx   on public.portal_content (content_type);

alter table public.portal_content enable row level security;

create policy portal_content_admin_only
  on public.portal_content
  for all to authenticated
  using (public.jwt_is_admin());


-- =============================================================================
-- 3. SEED GLOBAL RESOURCES (agency_id = null → show on every portal)
-- =============================================================================
insert into public.portal_content
  (agency_id, content_type, title, link, link_label, sort_order)
values
  (null, 'resource', 'Corebridge Rapid Rater',   'https://www.corebridgefinancial.com/rapidrater', 'Open Rater',   10),
  (null, 'resource', 'Dashboard-ology',           '/resources/dashboard-ology',                    'View Guide',   20),
  (null, 'resource', 'SPIFF Rules',               '/resources/spiff-rules',                        'View Rules',   30),
  (null, 'resource', 'Carrier Quick Guide',       '/resources/carriers',                           'View Guide',   40);
