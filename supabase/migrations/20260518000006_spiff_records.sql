-- SPIFF tracking
alter table public.cases
  add column if not exists spiff_earned    boolean     not null default false,
  add column if not exists spiff_earned_at timestamptz;

create table if not exists public.spiff_records (
  id         uuid        primary key default gen_random_uuid(),
  case_id    uuid        not null references public.cases (id) on delete cascade,
  agent_id   uuid        references public.agents (id),
  agency_id  uuid        references public.agencies (id),
  amount     numeric(6,2) not null default 10.00,
  earned_at  timestamptz not null default now(),
  paid_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists spiff_records_case_id_idx   on public.spiff_records (case_id);
create index if not exists spiff_records_agent_id_idx  on public.spiff_records (agent_id);
create index if not exists spiff_records_agency_id_idx on public.spiff_records (agency_id);
create index if not exists spiff_records_paid_idx      on public.spiff_records (paid_at) where paid_at is null;
