alter table public.cases
  add column if not exists is_owner_referral boolean not null default false;
