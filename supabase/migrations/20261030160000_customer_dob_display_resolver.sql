-- =============================================================================
-- Customer DOB display resolver for the shared Customer Contact Card
-- Migration: 20261030160000_customer_dob_display_resolver.sql
--
-- The shared Customer Contact Card is the one deliberate, scoped place in Right
-- Path that shows a customer's date of birth (every other surface shows age or
-- a day-masked DOB — see AGENTS.md). Until now the card could only show a DOB
-- that was stored ON the customer row (customers.date_of_birth exact, or
-- customers.date_of_birth_approx partial). The customer's best birth
-- information, however, very often lives only on the owner line of their linked
-- policies (service_policies.owner_dob_approx), exactly the source the age
-- engine already trusts. As a result ~6,700 customers whose only reliable birth
-- fact is a linked-policy month/year showed NO DOB on the card, even though
-- their AGE line was correctly derived from that same source.
--
-- This function resolves the customer's DOB to display at its BEST available
-- precision, following the SAME precedence and the SAME no-guessing consensus
-- rule the age engine uses (project_customer_age, 20261012000001 /
-- 20261013000001 / 20261030154658):
--
--   1. exact customers.date_of_birth           -> source 'exact'  (full date)
--   2. customers.date_of_birth_approx           -> source 'customer_partial'
--        (month+year or year-only; the day is never stored here)
--   3. consensus across the customer's linked owner_dob_approx values
--        -> source 'linked_policy'
--        * all usable linked owner years AGREE on one year: use that year,
--          and the month only if every agreeing row shares one month;
--        * linked years CONFLICT (more than one distinct year): resolve to
--          NONE (we do not pick a winner and we do not show a DOB we cannot
--          stand behind);
--   4. nothing usable                           -> source 'none'
--
-- IT IS THE CUSTOMER-AS-OWNER source only. owner_dob_approx is the owner's DOB;
-- the policy's INSURED DOB (insured_dob / insured_dob_year / insured_dob_month)
-- is a different person's birth fact and is NEVER consulted here, so an
-- insured's DOB can never be shown as the customer's.
--
-- PHI / "never invent a day": a DAY is returned ONLY for source 'exact', where
-- it is a real stored day on customers.date_of_birth. The partial-customer and
-- linked-policy sources return year (+ month) and a NULL day — no day is ever
-- fabricated from a partial source. Month is returned only when actually known.
--
-- This adds NO new age behavior and does not touch project_customer_age, the
-- population match/facet functions, or any stored column. It is a read-only
-- display resolver for the card. Development clone only.
--
-- NOTE: the single-source precedence BODY defined here is superseded by
-- 20261030170000_customer_dob_display_enrich.sql, which keeps the same signature
-- and the same exact/owner-only guarantees but MERGES compatible precisions
-- across the customer's own DOB and the linked owner consensus (e.g. a stored
-- year plus a linked month+year for the same year yields month+year). This file
-- is retained for migration history; the enrich migration is authoritative.
-- Depends on 20261012000001 / 20261013000001 / 20261030154658 (the masked-DOB
-- parsers and the precision-aware age/consensus logic).
-- =============================================================================

create or replace function public.project_customer_dob_display(p_customer_id uuid)
returns table (
  dob_year      integer,
  dob_month     integer,
  dob_day       integer,
  dob_precision text,   -- 'exact' | 'month_year' | 'year_only' | 'none'
  dob_source    text    -- 'exact' | 'customer_partial' | 'linked_policy' | 'none'
)
language sql
stable
as $$
  with cust as (
    select c.date_of_birth, c.date_of_birth_approx
    from public.customers c
    where c.id = p_customer_id
      and c.is_test = false
  ),
  -- 2. the customer's OWN partial DOB (masked month/year; no day)
  own_partial as (
    select
      public.project_masked_dob_year(cu.date_of_birth_approx)  as yr,
      public.project_masked_dob_month(cu.date_of_birth_approx) as mo
    from cust cu
    where cu.date_of_birth is null
      and cu.date_of_birth_approx is not null
      and public.project_masked_dob_year(cu.date_of_birth_approx) is not null
  ),
  -- 3. consensus across the customer's linked owner_dob_approx values, using the
  --    same aggregate the age engine applies: a single agreed year, with the
  --    month only when every agreeing row shares it; conflicting years => none.
  linked_parts as (
    select
      public.project_masked_dob_year(sp.owner_dob_approx)  as yr,
      public.project_masked_dob_month(sp.owner_dob_approx) as mo
    from public.service_policies sp
    where sp.customer_id = p_customer_id
      and sp.is_test = false
      and sp.owner_dob_approx is not null
      and public.project_masked_dob_year(sp.owner_dob_approx) is not null
  ),
  linked_consensus as (
    select
      case when count(distinct yr) = 1 then min(yr) else null end as yr,
      case
        when count(distinct yr) = 1
          and count(distinct mo) filter (where mo is not null) = 1
          and count(*) filter (where mo is null) = 0
          then min(mo) filter (where mo is not null)
        else null
      end as mo
    from linked_parts
  )
  select
    r.yr  as dob_year,
    r.mo  as dob_month,
    r.day as dob_day,
    case
      when r.day is not null and r.mo is not null and r.yr is not null then 'exact'
      when r.mo is not null and r.yr is not null then 'month_year'
      when r.yr is not null then 'year_only'
      else 'none'
    end as dob_precision,
    r.src as dob_source
  from (
    select
      -- 1. exact stored date wins and is the only source that carries a day
      coalesce(
        extract(year  from (select date_of_birth from cust))::int,
        (select yr from own_partial),
        (select yr from linked_consensus)
      ) as yr,
      coalesce(
        extract(month from (select date_of_birth from cust))::int,
        (select mo from own_partial),
        (select mo from linked_consensus)
      ) as mo,
      extract(day from (select date_of_birth from cust))::int as day,
      case
        when (select date_of_birth from cust) is not null then 'exact'
        when (select yr from own_partial) is not null then 'customer_partial'
        when (select yr from linked_consensus) is not null then 'linked_policy'
        else 'none'
      end as src
  ) r
$$;

comment on function public.project_customer_dob_display(uuid) is
  'Best-available-precision DOB PARTS for the shared Customer Contact Card only '
  '(the scoped full-DOB exception). Precedence: exact customers.date_of_birth '
  '(the only source with a day), then customers.date_of_birth_approx (month/year), '
  'then the customer''s linked owner_dob_approx consensus (single agreed year, '
  'month only if all agree; conflicting years => none). Owner source only, never '
  'the policy insured. No day is ever fabricated from a partial source.';

grant execute on function public.project_customer_dob_display(uuid) to service_role;

notify pgrst, 'reload schema';
