-- =============================================================================
-- Right Path document storage — private Supabase Storage bucket
-- Migration: 20261018000001_rightpath_documents_storage.sql
--
-- Creates the single PRIVATE bucket that holds the actual uploaded file bytes
-- for Right Path policy/review documents. The first consumer is the 1035
-- Exchange Review Step 3 flow (carrier statement + reprojection), but the bucket
-- is the durable Right Path document store, not a 1035-only or dev-only artifact.
--
-- Design (production-intended, promotable as-is):
--   * One bucket `rightpath-documents`, public = false. Never public.
--   * policy_documents remains the durable DOCUMENT RECORD. storage_location on
--     that row holds the object PATH within this bucket (e.g.
--     "1035/<project>/<customer>/carrier_statement.pdf"). No second document
--     system is introduced.
--   * All uploads/downloads go through server routes using the service-role
--     client (which bypasses storage RLS), exactly like every other table in
--     this app. Downloads are issued as short-lived SIGNED URLs so the bucket
--     stays private — no public URL is ever exposed.
--   * storage.objects RLS policies below are defense-in-depth so that, even if a
--     non-service-role client reached the bucket, only internal admins could
--     read/write it and anon/agency users get nothing. This matches the
--     admin-only posture of the projects / stewardship / service modules.
--
-- Depends on: Supabase Storage (storage.buckets, storage.objects — provided by
--             the platform) and public.jwt_is_admin() (20260516000002).
-- Idempotent: safe to re-run (on conflict / drop-if-exists guards).
-- =============================================================================


-- =============================================================================
-- 1. BUCKET — private, single Right Path document store.
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('rightpath-documents', 'rightpath-documents', false)
on conflict (id) do update set public = false;


-- =============================================================================
-- 2. STORAGE.OBJECTS RLS — admin read/write for this bucket; service_role all.
-- storage.objects has RLS enabled by the platform. We add scoped policies for
-- the rightpath-documents bucket only; other buckets are unaffected. The server
-- uses the service-role client (bypasses RLS); these policies ensure that even a
-- direct authenticated client is limited to internal admins, and anon/agency
-- users are denied entirely (no matching policy).
-- =============================================================================

-- Internal admins may read objects in this bucket (e.g. if a future authenticated
-- client reads directly; the current app uses signed URLs via the server).
drop policy if exists rightpath_documents_admin_select on storage.objects;
create policy rightpath_documents_admin_select
  on storage.objects for select to authenticated
  using (bucket_id = 'rightpath-documents' and public.jwt_is_admin());

-- Internal admins may insert objects in this bucket.
drop policy if exists rightpath_documents_admin_insert on storage.objects;
create policy rightpath_documents_admin_insert
  on storage.objects for insert to authenticated
  with check (bucket_id = 'rightpath-documents' and public.jwt_is_admin());

-- Internal admins may update objects in this bucket (overwrite / supersede).
drop policy if exists rightpath_documents_admin_update on storage.objects;
create policy rightpath_documents_admin_update
  on storage.objects for update to authenticated
  using (bucket_id = 'rightpath-documents' and public.jwt_is_admin())
  with check (bucket_id = 'rightpath-documents' and public.jwt_is_admin());

-- Internal admins may delete objects in this bucket.
drop policy if exists rightpath_documents_admin_delete on storage.objects;
create policy rightpath_documents_admin_delete
  on storage.objects for delete to authenticated
  using (bucket_id = 'rightpath-documents' and public.jwt_is_admin());

-- service_role: full access (the server upload/download/supersede path).
drop policy if exists rightpath_documents_service_all on storage.objects;
create policy rightpath_documents_service_all
  on storage.objects for all to service_role
  using (bucket_id = 'rightpath-documents')
  with check (bucket_id = 'rightpath-documents');


-- Refresh PostgREST schema cache (harmless for storage; keeps convention).
notify pgrst, 'reload schema';
