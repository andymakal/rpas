-- =============================================================================
-- Other-specialist restriction: "hands off" customers already working with
-- another active financial specialist
-- Migration: 20261201000001_other_specialist_restriction.sql
--
-- Some customers (e.g. in the Cassidy book) already work with a still-active
-- financial specialist. We respect that boundary. This adds the CAPACITY only;
-- the data is filled by hand / import scrubs afterward.
--
--   financial_specialists            — durable lookup of the other specialists
--                                      (name, soft-retire via is_active). If a
--                                      specialist leaves without selling their
--                                      book, one query on their id returns
--                                      every customer who was hands off.
--   customers.other_specialist_status — three states, same shape as
--                                      service_policies.sa_status:
--                                        unknown   never checked (default)
--                                        clear     checked, fair game
--                                        hands_off do not touch
--   customers.other_specialist_id    — FK to the specialist. REQUIRED when
--                                      hands_off (no exclusion without a
--                                      specific reason) and NULL otherwise.
--
-- Customers we already have policies with stay 'unknown' until decided case by
-- case; there is deliberately no "review" state.
--
-- project_population_source (the base of every project population) is
-- recreated so hands_off customers never enter a new project population.
-- Everything else (My Work, Verify, onboarding) is enforced in application code
-- through src/lib/customers/other-specialist.ts.
--
-- Depends on: customers, jwt_is_admin(). Writes via service_role; internal
-- staff (admin) read. Internal-only.
-- =============================================================================


-- 1. SPECIALIST LOOKUP
create table if not exists public.financial_specialists (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.financial_specialists is
  'Other financial specialists whose customers we leave alone. Referenced by '
  'customers.other_specialist_id. Retire with is_active = false; never delete '
  '(the reference is on delete restrict).';

create unique index if not exists financial_specialists_name_key
  on public.financial_specialists (lower(btrim(name)));


-- 2. CUSTOMER COLUMNS
alter table public.customers
  add column if not exists other_specialist_status text not null default 'unknown',
  add column if not exists other_specialist_id uuid
    references public.financial_specialists (id) on delete restrict;

alter table public.customers
  drop constraint if exists customers_other_specialist_status_check,
  add constraint customers_other_specialist_status_check
    check (other_specialist_status in ('unknown', 'clear', 'hands_off'));

-- hands_off requires a specific specialist; the other states carry none.
alter table public.customers
  drop constraint if exists customers_other_specialist_consistent,
  add constraint customers_other_specialist_consistent
    check (
      (other_specialist_status = 'hands_off' and other_specialist_id is not null)
      or (other_specialist_status <> 'hands_off' and other_specialist_id is null)
    );

comment on column public.customers.other_specialist_status is
  'unknown = never checked (default); clear = checked, fair game; hands_off = '
  'working with another active specialist, do not touch. Only hands_off '
  'restricts anything.';
comment on column public.customers.other_specialist_id is
  'The other specialist. Required when other_specialist_status = hands_off, '
  'otherwise null.';

create index if not exists customers_other_specialist_idx
  on public.customers (other_specialist_id)
  where other_specialist_id is not null;


-- 3. TABLE PRIVILEGES + RLS (same as project_types)
grant all on public.financial_specialists to anon, authenticated, service_role;

alter table public.financial_specialists enable row level security;

create policy financial_specialists_admin_select
  on public.financial_specialists for select to authenticated
  using (public.jwt_is_admin());

create policy financial_specialists_all
  on public.financial_specialists for all to service_role
  using (true) with check (true);


-- 4. POPULATION SOURCE: hands_off customers never enter a project population.
-- Same columns as before; only the WHERE gains one condition.
create or replace view public.project_population_source
with (security_invoker = true) as
 SELECT sp.id AS policy_id,
    sp.customer_id,
    project_policy_status_class(sp.coverage_status) AS normalized_status,
    project_policy_status_class(sp.coverage_status) = 'active'::text AS is_active,
    COALESCE(sp.agency_id::text, '∅'::text) AS agency,
    COALESCE(sp.carrier, '∅'::text) AS carrier,
    COALESCE(sp.product_type, '∅'::text) AS product_type,
    COALESCE(sp.term_length, '∅'::text) AS term_length,
    COALESCE(sp.rate_class, '∅'::text) AS rate_class,
    COALESCE(cu.segment, '∅'::text) AS segment,
    COALESCE(sp.insured_state, '∅'::text) AS insured_state,
    sp.face_amount,
    sp.cash_value_amount,
    sp.annual_premium,
    sp.issue_date,
    sp.policy_termination_date,
    sp.surrender_end_date,
    project_insured_age(sp.insured_dob, sp.insured_dob_year::integer, sp.insured_dob_month::integer) AS insured_age
   FROM service_policies sp
     JOIN customers cu ON cu.id = sp.customer_id
  WHERE sp.is_test = false AND cu.is_test = false AND sp.customer_id IS NOT NULL
    AND cu.other_specialist_status <> 'hands_off';

notify pgrst, 'reload schema';
