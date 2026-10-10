/**
 * Shared permanent-vs-term policy classification.
 *
 * This is the single source of truth for whether a service_policies.product_type
 * is a permanent (cash-value) policy or a term policy. The stewardship start
 * route and the 1035 project workflow both classify policies, and they must
 * agree, so the rule lives here rather than being copied into each caller.
 *
 * Rule: Term (and anything starting "Term") is never permanent. The known
 * permanent product codes are permanent, as are free-text names that read as
 * Universal / Whole / Permanent life. Anything else (an unknown non-term
 * product) is treated as NOT permanent — it is relationship context, never
 * auto-added to servicing-agent request work.
 */

const PERMANENT_PRODUCT_TYPES = new Set(['UL', 'VUL', 'IUL', 'GUL', 'SUL', 'SVUL', 'WL', 'PERM', 'FA', 'MVA'])

export function isPermanent(productType: string | null): boolean {
  if (!productType) return false
  const p = productType.toUpperCase().replace(/[\s_-]/g, '')
  if (p === 'TERM' || p.startsWith('TERM')) return false
  if (PERMANENT_PRODUCT_TYPES.has(p)) return true
  if (p.includes('UNIVERSAL') || p.includes('WHOLE') || p.includes('PERMANENT')) return true
  // Unknown non-term product: treat as context, not a permanent request policy.
  return false
}

export function isTerm(productType: string | null): boolean {
  if (!productType) return false
  const p = productType.toUpperCase().replace(/[\s_-]/g, '')
  return p === 'TERM' || p.startsWith('TERM')
}
