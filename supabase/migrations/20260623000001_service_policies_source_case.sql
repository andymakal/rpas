-- =============================================================================
-- Link service_policies back to the placed case that generated them
-- Migration: 20260623000001_service_policies_source_case.sql
--
-- Adds source_case_id so that when a case reaches "placed" status and a
-- policy number is recorded, the API can auto-create (or update) a
-- service_policies row — making the policy visible on Customer Cards and
-- selectable in Policy Reviews without manual data entry.
--
-- The unique index ensures exactly one service_policy per source case.
-- ON DELETE SET NULL means if the case is deleted the policy record survives.
-- =============================================================================

alter table public.service_policies
  add column if not exists source_case_id uuid
    references public.cases (id) on delete set null;

comment on column public.service_policies.source_case_id is
  'Set when this policy was auto-promoted from a placed case. '
  'Null for manually-entered and imported legacy policies.';

-- Prevent duplicate promotions (only one service_policy per case)
create unique index if not exists service_policies_source_case_unique
  on public.service_policies (source_case_id)
  where source_case_id is not null;

create index if not exists service_policies_source_case_id_idx
  on public.service_policies (source_case_id)
  where source_case_id is not null;
