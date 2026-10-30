-- =============================================================================
-- Customer DOB display resolver — ENRICH by merging compatible precisions
-- Migration: 20261030170000_customer_dob_display_enrich.sql
--
-- Supersedes the body of project_customer_dob_display (20261030160000), which
-- picked exactly ONE source by precedence (exact -> customer partial -> linked
-- consensus) and therefore could not COMBINE compatible information. The agreed
-- behavior is to show the most complete RELIABLE DOB by merging across the
-- customer's own stored DOB and the customer's linked-policy owner DOB:
--
--   If the customer record holds only a YEAR (e.g. 1959) and a linked policy
--   reliably establishes a MONTH + YEAR for the SAME year (e.g. July 1959),
--   display July 1959. Missing information is never a conflict; only
--   contradictory KNOWN information is.
--
-- Merge rules (customer-as-OWNER sources only; the policy INSURED DOB is a
-- different person and is NEVER consulted):
--
--   Sources, each contributing only what it actually knows:
--     A. exact   customers.date_of_birth            (year + month + day)
--     B. partial customers.date_of_birth_approx     (year [+ month], no day)
--     C. linked  consensus of owner_dob_approx       (year [+ month], no day)
--        across the customer's policies, where the policies must themselves
--        agree on a single year (month only if all agreeing rows share it),
--        else C contributes NOTHING (its own internal conflict is not the
--        customer's DOB).
--
--   YEAR:  distinct known years across A/B/C.
--            * 0 known      -> no DOB (precision none)
--            * all the same -> that year (a source silent on the year is not a
--                              conflict)
--            * 2+ distinct  -> CONTRADICTION -> no DOB (we never guess a year)
--   MONTH: among sources that know the agreed year, the distinct known months.
--            * 0 known      -> month unknown (year-only result)
--            * all the same -> that month
--            * 2+ distinct  -> the MONTH contradicts; keep the reliable YEAR and
--                              drop the month (year-only), never picking a winner
--   DAY:   only from the exact date A, and only when A agrees with the merged
--          year and month. A partial or linked source never yields a day.
--
-- SOURCE label (drives the card's confirmed/unconfirmed treatment):
--   'exact'            a day is present, i.e. the confirmed full stored date is
--                      the result (nothing can be more complete than a full
--                      date, so this is never "enriched")
--   'linked_policy'    linked-policy info supplied the year or added a month the
--                      customer's own record lacked -> shown but UNCONFIRMED
--   'customer_partial' the result rests on the customer's own partial, with no
--                      linked enrichment -> UNCONFIRMED
--   'none'             nothing reliable to show
--
-- Read-only; no stored column changes; project_customer_age and the population
-- engine are untouched. Development clone only.
-- =============================================================================

create or replace function public.project_customer_dob_display(p_customer_id uuid)
returns table (
  dob_year      integer,
  dob_month     integer,
  dob_day       integer,
  dob_precision text,
  dob_source    text
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
  -- A. exact stored date (the only source that can carry a day)
  a as (
    select
      extract(year  from date_of_birth)::int as yr,
      extract(month from date_of_birth)::int as mo,
      extract(day   from date_of_birth)::int as dy
    from cust
    where date_of_birth is not null
  ),
  -- B. the customer's own partial DOB (year [+ month], never a day)
  b as (
    select
      public.project_masked_dob_year(date_of_birth_approx)  as yr,
      public.project_masked_dob_month(date_of_birth_approx) as mo
    from cust
    where date_of_birth is null
      and date_of_birth_approx is not null
      and public.project_masked_dob_year(date_of_birth_approx) is not null
  ),
  -- C. linked owner_dob_approx consensus (year [+ month], never a day).
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
  c as (
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
    having count(*) > 0
  ),
  -- The exact stored date is AUTHORITATIVE. When present it IS the DOB — a full
  -- date is already the most complete precision, and a lower-precision linked or
  -- partial source can neither improve it nor contradict it into nothing. So the
  -- year/month MERGE below applies only to the customer's PARTIAL record (B) and
  -- the linked consensus (C); A short-circuits in `merged`.
  --
  -- Merge the YEAR across the partial sources: known years must agree (a source
  -- silent on the year is not a conflict).
  years as (
    select yr from b where yr is not null
    union all select yr from c where c.yr is not null
  ),
  year_agg as (
    select case when count(distinct yr) = 1 then min(yr) else null end as yr
    from years
  ),
  -- Merge the MONTH among partial sources that know the agreed year; agree or drop.
  months as (
    select b.mo from b, year_agg y where b.mo is not null and y.yr is not null and b.yr = y.yr
    union all
    select c.mo from c, year_agg y where c.mo is not null and y.yr is not null and c.yr = y.yr
  ),
  month_agg as (
    select case when count(distinct mo) = 1 then min(mo) else null end as mo
    from months
  ),
  -- The final merged parts: the authoritative exact date when present, else the
  -- enriched partial merge.
  merged as (
    select
      coalesce((select yr from a), (select yr from year_agg)) as yr,
      case
        when (select yr from a) is not null then (select mo from a)
        when (select yr from year_agg) is null then null
        else (select mo from month_agg)
      end as mo
    from (select 1) _
  ),
  -- The day comes only from the exact date, and only when it agrees with the
  -- merged year and month.
  day_pick as (
    select a.dy
    from a, merged m
    where m.yr is not null and a.yr = m.yr and (m.mo is null or a.mo = m.mo)
  ),
  -- Did linked policies SUPPLY the year (no stored year at all) or ADD the
  -- merged month that neither stored source knew? Either is enrichment.
  linked_enriched as (
    select exists (
      select 1 from c, merged m
      where c.yr is not null and m.yr is not null and c.yr = m.yr
        and (
          -- C supplied the only year
          (not exists (select 1 from a) and not exists (select 1 from b))
          -- or C provided the merged month and no stored source had a month
          or (m.mo is not null and c.mo = m.mo
              and not exists (select 1 from a where a.mo is not null)
              and not exists (select 1 from b where b.mo is not null))
        )
    ) as yes
  )
  select
    m.yr as dob_year,
    m.mo as dob_month,
    (select dy from day_pick) as dob_day,
    case
      when m.yr is null then 'none'
      when (select dy from day_pick) is not null then 'exact'
      when m.mo is not null then 'month_year'
      else 'year_only'
    end as dob_precision,
    case
      when m.yr is null then 'none'
      -- a full confirmed date is the most complete possible; never "enriched"
      when (select dy from day_pick) is not null then 'exact'
      -- linked policies supplied or completed the shown value -> unconfirmed
      when (select yes from linked_enriched) then 'linked_policy'
      -- the shown value rests on the customer's own partial
      when exists (select 1 from b where b.yr is not null) then 'customer_partial'
      -- no stored customer DOB at all; the value came from linked policies
      else 'linked_policy'
    end as dob_source
  from merged m
$$;

comment on function public.project_customer_dob_display(uuid) is
  'Best-available-precision DOB PARTS for the shared Customer Contact Card only, '
  'ENRICHED by merging the customer''s own DOB (exact date, else partial) with '
  'the customer''s linked owner_dob_approx consensus. Missing parts never '
  'conflict; contradictory known years -> none, contradictory months -> year '
  'only. A day comes only from a consistent exact stored date. Owner source '
  'only, never the policy insured.';

grant execute on function public.project_customer_dob_display(uuid) to service_role;

notify pgrst, 'reload schema';
