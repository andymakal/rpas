-- =============================================================================
-- Owner-as-insured backfill for policies with no identified insured
-- Migration: 20261015000001_owner_as_insured_backfill.sql
--
-- Business rule (Right Path):
--   * A policy with an explicitly identified insured keeps that insured.
--   * A policy with NO identified insured has the owner/customer as the insured.
--   * We do NOT substitute owner information to patch an identified insured that
--     merely lacks a DOB or other detail. Payer is out of scope.
--
-- The signal for "no identified insured" is insured_last_name IS NULL. Live data
-- confirms this set is internally consistent: every such policy also has
-- insured_first_name NULL, insured_state NULL, and insured_dob_precision
-- 'missing'. (154 Cassidy rows already carry an identified insured at
-- month_year precision and are therefore NOT in this set.)
--
-- Source of owner identity: the linked customer (service_policies.customer_id ->
-- customers). customers.date_of_birth is a full DATE or NULL (no partial
-- precision), and customers.state is plain text. Policies with no linked
-- customer have only a free-text client_name (sometimes malformed) and are left
-- untouched — there is no reliable structured owner to copy.
--
-- What this writes, in ONE guarded statement, ONLY on no-identified-insured
-- policies (insured_last_name IS NULL) that have a linked customer with a name:
--   * insured_first_name / insured_last_name  <- customer first/last name
--   * insured_state                           <- customer.state, 2-letter only,
--                                                else left NULL
--   * insured_dob (+ year + month, precision 'exact') <- customer.date_of_birth,
--     and ONLY when the customer has a full exact date; otherwise precision
--     stays 'missing'. No day is ever invented.
--
-- Because the whole fill is gated on insured_last_name IS NULL, a policy that
-- already had an identified insured is never touched — including the case where
-- that insured merely lacks a DOB, and the case where the owner coincidentally
-- shares the insured's name.
--
-- Idempotent: after the statement runs, the affected rows have a non-null
-- insured_last_name, so the guard excludes them on any re-run (no-op). The
-- shape constraint (precision <-> which DOB components are set) is satisfied
-- because precision and components are chosen together per row. One transaction.
--
-- No stored age column is added or used. Insured age is derived at query time by
-- project_insured_age() (20261012000001) from the insured_dob components this
-- migration fills.
--
-- Additive and reversible as a single transaction. Depends on
-- 20261008000001 (the insured_* columns + shape constraint).
-- =============================================================================

begin;

update public.service_policies sp
set
  insured_first_name = cu.first_name,
  insured_last_name  = cu.last_name,

  -- Owner state only when it is a clean 2-letter code; otherwise leave NULL.
  insured_state = case
    when cu.state is not null and upper(cu.state) ~ '^[A-Z]{2}$'
      then upper(cu.state)
    else null
  end,

  -- Owner DOB only at exact precision from a full, PLAUSIBLE customer date. No
  -- day is invented: without a usable customer DOB, precision stays 'missing'
  -- and all DOB components stay NULL (shape constraint for 'missing').
  -- Implausible sentinel dates (e.g. 0001-01-01) are treated as no DOB — they
  -- fail service_policies_insured_dob_year_range_check (1900–2100) and, more to
  -- the point, carry no real birth information to copy.
  insured_dob = case
    when extract(year from cu.date_of_birth) between 1900 and 2100 then cu.date_of_birth
    else null
  end,
  insured_dob_year = case
    when extract(year from cu.date_of_birth) between 1900 and 2100
      then extract(year from cu.date_of_birth)::smallint
    else null
  end,
  insured_dob_month = case
    when extract(year from cu.date_of_birth) between 1900 and 2100
      then extract(month from cu.date_of_birth)::smallint
    else null
  end,
  insured_dob_precision = case
    when extract(year from cu.date_of_birth) between 1900 and 2100 then 'exact'
    else 'missing'
  end,

  updated_at = now()
from public.customers cu
where sp.customer_id = cu.id
  and sp.insured_last_name is null       -- no identified insured (idempotency guard)
  and cu.last_name is not null
  and cu.last_name <> ''
  and cu.is_test = false
  and sp.is_test = false;

commit;
