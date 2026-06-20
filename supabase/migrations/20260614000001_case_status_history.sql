-- =============================================================================
-- Case status history table + trigger
-- Migration: 20260614000001_case_status_history.sql
--
-- Records every internal_status change on the cases table so the UI can
-- display a full audit trail and provide the "Return to Triage" escape hatch.
-- =============================================================================

create table if not exists public.case_status_history (
  id          uuid        primary key default gen_random_uuid(),
  case_id     uuid        not null references public.cases (id) on delete cascade,
  from_status text,
  to_status   text        not null,
  changed_at  timestamptz not null default now()
);

create index if not exists case_status_history_case_idx
  on public.case_status_history (case_id, changed_at desc);

-- Trigger function: fires after UPDATE when internal_status changes
create or replace function public.record_case_status_change()
returns trigger language plpgsql as $$
begin
  if (old.internal_status is distinct from new.internal_status) then
    insert into public.case_status_history (case_id, from_status, to_status)
    values (new.id, old.internal_status, new.internal_status);
  end if;
  return new;
end;
$$;

create trigger case_status_history_trigger
  after update on public.cases
  for each row execute function public.record_case_status_change();
