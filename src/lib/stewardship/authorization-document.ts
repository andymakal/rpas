/**
 * Signed servicing-agent authorization document — storage helpers.
 *
 * This REUSES Right Path's one existing document repository: the private
 * Supabase Storage bucket `rightpath-documents` and the `policy_documents`
 * table (the same ones the 1035 Operations Preparation documents use — see
 * src/lib/projects/review-1035.ts). It does NOT create a second storage system.
 *
 * What is new here is only a DOCUMENT TYPE: `servicing_authorization`, the
 * signed servicing-agent authorization form the customer returns. It is stored
 * exactly like any other policy document (bytes in the bucket, the durable row
 * in policy_documents with storage_location = the object path), so it is
 * downloadable, supersedable, and auditable through the same machinery.
 *
 * Anchoring: the authorization is a servicing-REQUEST document (one signed form
 * can cover several policies), but policy_documents requires a policy_id, so the
 * form is anchored to the request's representative policy (the servicing-request
 * policy the caller names). project_id is carried when the customer belongs to a
 * project and left null otherwise — the standalone intake path (a signed
 * authorization that simply arrives) has no project. Because the table's unique
 * key includes project_id and Postgres treats NULL as distinct, the route
 * dedupes a re-upload itself on (customer_id, policy_id, document_type) rather
 * than relying solely on the upsert conflict target.
 */

import { DOCUMENTS_BUCKET } from '@/lib/projects/review-1035'

export { DOCUMENTS_BUCKET }

/** The document type for the signed servicing-agent authorization form. */
export const SERVICING_AUTHORIZATION_TYPE = 'servicing_authorization' as const

/**
 * Deterministic object path for a signed authorization, stable per
 * (customer, policy) so a re-upload supersedes the prior object for THAT
 * servicing request (same key, overwrite) rather than leaving duplicates. The
 * original file extension is preserved for correct content handling on
 * download. Kept separate from the 1035 `1035/...` path prefix so the two
 * document kinds never collide in the bucket.
 */
export function authorizationObjectPath(
  customerId: string,
  policyId: string,
  ext: string,
): string {
  const safeExt = ext.replace(/[^a-z0-9.]/gi, '').replace(/^\.?/, '.')
  return `servicing-authorization/${customerId}/${policyId}/authorization${safeExt}`
}
