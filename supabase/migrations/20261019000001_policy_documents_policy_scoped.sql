-- =============================================================================
-- 1035 Exchange Review — Step 3 documents become POLICY-specific
-- Migration: 20261019000001_policy_documents_policy_scoped.sql
--
-- CORRECTION to the Step 3 document model. A project customer can have MULTIPLE
-- policies being evaluated, so the carrier statement and the reprojection are
-- per POLICY, not merely per customer. The prior uniqueness rule
--   (project_id, customer_id, document_type)   [20261017000001]
-- let a document for Policy B overwrite the document for Policy A. The correct
-- durable rule is
--   (project_id, customer_id, policy_id, document_type).
--
-- This is the smallest additive change: policy_id already exists on
-- policy_documents (NOT NULL, references service_policies). We only swap the
-- unique index to include it. No new table, no new column, no new bucket.
--
-- Storage object paths also become policy-specific in application code
-- (1035/<project>/<customer>/<policy>/<type>.<ext>); that is handled by the
-- route and does not require DDL. Existing object paths, if any, are reconciled
-- by the app on next upload (upsert overwrites at the new, policy-scoped key).
--
-- Depends on: 20261017000001 (project/customer context + the index this replaces)
--             and the pre-existing policy_documents.policy_id column
--             (20260927000002). Idempotent and safe to re-run.
-- =============================================================================


-- =============================================================================
-- 1. SAFETY BACKFILL — ensure every project-scoped row has a policy_id.
-- policy_id is already NOT NULL on this table, so this is defensive only: if a
-- future/legacy row ever lacked one, anchor it to a permanent policy for that
-- customer (else any policy for that customer). No-op on a well-formed table.
-- =============================================================================
update public.policy_documents d
set policy_id = sub.policy_id
from (
  select distinct on (sp.customer_id) sp.customer_id, sp.id as policy_id
  from public.service_policies sp
  where sp.is_test = false
  order by
    sp.customer_id,
    -- prefer a permanent (non-term) policy, then stable by id
    (case
       when upper(regexp_replace(coalesce(sp.product_type, ''), '[\s_-]', '', 'g')) like 'TERM%'
         then 1 else 0
     end),
    sp.id
) sub
where d.policy_id is null
  and d.customer_id is not null
  and d.customer_id = sub.customer_id;


-- =============================================================================
-- 2. SWAP THE UNIQUE INDEX — customer-scoped -> policy-scoped.
-- Drop the old (project, customer, type) key and create the policy-aware key.
-- A plain (non-partial) unique index so it can back an INSERT ... ON CONFLICT
-- (project_id, customer_id, policy_id, document_type) upsert from PostgREST.
-- The columns project_id/customer_id are nullable; Postgres treats NULLs as
-- distinct, so pre-1035 rows (null project/customer) never collide here, which
-- is the intended behavior — exactly as before, now with policy granularity.
-- =============================================================================
drop index if exists public.policy_documents_project_customer_type_key;

create unique index if not exists policy_documents_project_customer_policy_type_key
  on public.policy_documents (project_id, customer_id, policy_id, document_type);


-- Keep the existing lookup index on (project_id, customer_id) — it still serves
-- "all documents for this customer in this project" reads in the workflow build.


-- Refresh PostgREST's schema cache so the new index-backed upsert arbiter is
-- usable via the API immediately.
notify pgrst, 'reload schema';
