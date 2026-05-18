create table if not exists public.case_touches (
  id          uuid        primary key default gen_random_uuid(),
  case_id     uuid        not null references public.cases (id) on delete cascade,
  touch_type  text        not null check (touch_type in ('call', 'voicemail', 'text', 'email')),
  notes       text,
  touched_at  timestamptz not null default now()
);

create index if not exists case_touches_case_id_idx on public.case_touches (case_id, touched_at desc);
