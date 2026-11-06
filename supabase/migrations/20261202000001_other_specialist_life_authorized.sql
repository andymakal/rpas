-- Other-specialist: add the life_authorized status
-- Migration: 20261202000001_other_specialist_life_authorized.sql
--
-- Four selections on customers.other_specialist_status:
--   unknown | clear | life_authorized | hands_off
--
-- life_authorized and hands_off both require a named specialist
-- (other_specialist_id); unknown and clear carry none. Only hands_off restricts
-- work (enforced in application code via src/lib/customers/other-specialist.ts
-- and, for new project populations, project_population_source, unchanged here).
--
-- RECONCILIATION: this schema change was ALREADY applied by hand to both the
-- development and production databases (and production data was updated:
-- 68 life_authorized, 144 hands_off). This file captures it in source control.
-- It is written to be a true no-op where the change is already present: each
-- constraint is rebuilt ONLY if its live definition does not yet include
-- life_authorized. It never writes, updates, or deletes customer data, and a
-- database still on the old three-state constraints is brought forward safely
-- (the widened check accepts every existing row).

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customers'::regclass
      and conname = 'customers_other_specialist_status_check'
      and pg_get_constraintdef(oid) like '%life_authorized%'
  ) then
    alter table public.customers
      drop constraint if exists customers_other_specialist_status_check,
      add constraint customers_other_specialist_status_check
        check (other_specialist_status in ('unknown', 'clear', 'life_authorized', 'hands_off'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customers'::regclass
      and conname = 'customers_other_specialist_consistent'
      and pg_get_constraintdef(oid) like '%life_authorized%'
  ) then
    alter table public.customers
      drop constraint if exists customers_other_specialist_consistent,
      add constraint customers_other_specialist_consistent
        check (
          (other_specialist_status in ('life_authorized', 'hands_off') and other_specialist_id is not null)
          or (other_specialist_status in ('unknown', 'clear') and other_specialist_id is null)
        );
  end if;
end $$;

comment on column public.customers.other_specialist_status is
  'unknown = never checked (default); clear = no other EFS; life_authorized = '
  'another EFS, life work authorized (informational, does not restrict); '
  'hands_off = another EFS, do not touch. Only hands_off restricts anything.';
comment on column public.customers.other_specialist_id is
  'The other specialist. Required when other_specialist_status is life_authorized '
  'or hands_off, otherwise null.';

notify pgrst, 'reload schema';
