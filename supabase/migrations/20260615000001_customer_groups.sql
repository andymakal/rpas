-- =============================================================================
-- Customer Groups — household linking
-- Migration: 20260615000001_customer_groups.sql
--
-- A customer_group is a household: two or more customer records that belong to
-- the same family unit. Created when staff manually links two people together.
--
-- customers.customer_group_id is a nullable FK into this table.
-- The link route (POST /api/customer-groups/link) handles create / join / merge.
-- =============================================================================

create table public.customer_groups (
  id          uuid        primary key default gen_random_uuid(),
  agency_id   uuid        references public.agencies (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.customer_groups is
  'Household groupings. Each row represents a family unit; customers.customer_group_id '
  'points here. Created when two customer records are manually linked.';

-- Fast lookup of all groups for an agency
create index customer_groups_agency_id_idx on public.customer_groups (agency_id);

-- Add household FK and updated_at to customers
alter table public.customers
  add column if not exists customer_group_id uuid references public.customer_groups (id) on delete set null,
  add column if not exists updated_at        timestamptz;

-- Index for "give me everyone in this household" query
create index if not exists customers_customer_group_id_idx
  on public.customers (customer_group_id)
  where customer_group_id is not null;
