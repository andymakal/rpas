-- =============================================================================
-- Batch best-available-precision customer age for the Contact Research card.
--
-- Contact Research shows the customer's age in the shared Customer Contact
-- Card. The card previously derived age from customers.date_of_birth alone,
-- which is populated for almost no one (e.g. 2 of 143 in the Q4 1035 Review),
-- so the age was missing for nearly everyone.
--
-- This reuses the EXISTING project age logic — public.project_customer_age
-- (20261012000001), which already derives age from the exact DOB when present
-- and otherwise from the best masked owner DOB on the customer's policies
-- (owner_dob_approx), choosing deterministically (most recent policy, then
-- highest year) so conflicting birth information resolves to one value, and
-- rejecting implausible ages (outside 0..120). It adds nothing to that logic;
-- it only exposes it per customer in a batch, plus whether the resulting age is
-- EXACT (from a full date_of_birth) or APPROXIMATE (derived from an incomplete
-- masked policy DOB), so the UI can label an approximate age appropriately.
--
-- Age only. No DOB, month, or day is ever returned. Development only.
-- Depends on 20261012000001 (the precision-aware age functions).
-- =============================================================================
create or replace function public.project_customer_ages(p_customer_ids uuid[])
returns table (customer_id uuid, age integer, is_approximate boolean)
language sql
stable
as $$
  select
    c.id as customer_id,
    public.project_customer_age(c.id, c.date_of_birth) as age,
    -- Exact when a full date_of_birth yields the age; otherwise the value came
    -- from the masked policy fallback, so it is approximate. NULL age (unknown)
    -- reports false — there is nothing to qualify.
    (
      public.project_customer_age(c.id, c.date_of_birth) is not null
      and public.project_age_years(c.date_of_birth) is null
    ) as is_approximate
  from public.customers c
  where c.id = any(p_customer_ids)
    and c.is_test = false
$$;

comment on function public.project_customer_ages(uuid[]) is
  'Batch best-available-precision age per customer, reusing project_customer_age '
  '(exact date_of_birth, else masked owner DOB from policies). is_approximate is '
  'true when the age came from the masked policy fallback rather than an exact '
  'date_of_birth. Age only; no DOB exposed.';

grant execute on function public.project_customer_ages(uuid[]) to service_role;
