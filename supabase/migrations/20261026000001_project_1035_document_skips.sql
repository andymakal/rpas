-- =============================================================================
-- 1035 Exchange Review — Step 3 document SKIPS (durable "unavailable" marker).
--
-- Operations Preparation requires, for each PERMANENT policy, a Carrier
-- Statement and a Reprojection. A document can either be UPLOADED (a row in
-- policy_documents) or explicitly SKIPPED as UNAVAILABLE. A skip is NOT a
-- received document: it is a durable, reversible record that operations
-- affirmatively marked this (policy, document type) unavailable so the customer
-- can still advance. Keeping skips in their own table leaves policy_documents
-- strictly about real files (its storage_location / document_date stay NOT NULL
-- and honest), and makes a skip reversible by deleting its row.
--
-- Grain matches a real document exactly: one row per
-- (project_id, customer_id, policy_id, document_type). A real upload and a skip
-- for the same tuple are mutually exclusive by workflow (the UI/route clears one
-- when setting the other), and the gating logic treats a (policy, type) as
-- ADDRESSED when either a document exists OR a skip row exists.
-- =============================================================================
create table if not exists public.project_customer_document_skips (
  id            uuid primary key default gen_random_uuid(),

  project_id    uuid not null references public.projects (id)          on delete cascade,
  customer_id   uuid not null references public.customers (id)         on delete cascade,
  policy_id     uuid not null references public.service_policies (id)  on delete cascade,

  -- The required Step-3 document type being marked unavailable. Mirrors
  -- REQUIRED_DOCUMENT_TYPES in src/lib/projects/review-1035.ts.
  document_type text not null
    check (document_type in ('carrier_statement', 'reprojection')),

  -- Why it is unavailable (optional free text) and provenance of the skip.
  reason        text,
  skipped_by    uuid references public.producers (id) on delete set null,
  skipped_at    timestamptz not null default now(),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.project_customer_document_skips is
  'Durable, reversible "document unavailable" markers for 1035 Step 3. A row '
  'means operations explicitly SKIPPED a required document (carrier_statement or '
  'reprojection) for a specific permanent policy because it is unavailable. This '
  'is NOT a received document — real files live in policy_documents. A (policy, '
  'type) counts as ADDRESSED for the handoff gate when a policy_documents row '
  'exists OR a skip row exists. Reversible by deleting the row.';

comment on column public.project_customer_document_skips.document_type is
  'carrier_statement | reprojection — the required Step-3 document marked '
  'unavailable for this policy.';

-- One current skip per (project, customer, policy, document_type) — the same
-- grain as a policy_documents row, so a skip is per-policy-per-type and upserts
-- cleanly on this arbiter.
create unique index if not exists project_customer_document_skips_unique
  on public.project_customer_document_skips (project_id, customer_id, policy_id, document_type);

create index if not exists project_customer_document_skips_project_customer_idx
  on public.project_customer_document_skips (project_id, customer_id);

create trigger project_customer_document_skips_set_updated_at
  before update on public.project_customer_document_skips
  for each row execute function public.set_updated_at();


-- =============================================================================
-- TABLE PRIVILEGES — match every existing public table (DML is granted
-- explicitly or PostgREST returns 403). RLS below gates row access.
-- =============================================================================
grant all on public.project_customer_document_skips to anon, authenticated, service_role;


-- =============================================================================
-- ROW LEVEL SECURITY — internal staff (admin) read; all writes via service_role.
-- Matches project_customer_reviews and the rest of the project module.
-- =============================================================================
alter table public.project_customer_document_skips enable row level security;

create policy project_customer_document_skips_admin_select
  on public.project_customer_document_skips for select to authenticated
  using (public.jwt_is_admin());

create policy project_customer_document_skips_all
  on public.project_customer_document_skips for all to service_role
  using (true) with check (true);


-- Refresh PostgREST's schema cache so the new table is visible via the API.
notify pgrst, 'reload schema';
