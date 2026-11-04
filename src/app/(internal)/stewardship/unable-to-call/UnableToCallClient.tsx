'use client'

/**
 * People We Can't Call — PLACEHOLDER.
 *
 * The outreach surface for customers we cannot reach by phone: an active
 * outreach customer (not decided, not declined) with NO usable phone on file.
 * This is the dead-end sibling of "Make the Calls That Are Due": calling is
 * blocked, so the work is to recover a way to reach them.
 *
 * INTENDED WORKFLOW (not built yet — this placeholder only lists the population
 * so it surfaces and nobody is stranded):
 *   1. Prompt the operator: "Can you find a phone number by any means?" using
 *      Gateway and the other sources Angie provided.
 *   2. YES -> update the customer's phone, then open the SAME guided call card
 *      used by Calls Due (Reached / Didn't reach / log the attempt) RIGHT HERE,
 *      so the operator tries the call while they are on the record. The customer
 *      then flows into the normal Calls Due queue on the next pass. (This is a
 *      branch, deliberately NOT a silent drop back into the queue.)
 *   3. NO -> the email / postal-mail workflow (generate, operator sends on
 *      Allstate's rails, confirm). Deferred: the customer-facing scripts need
 *      Bob's approval before anything is generated.
 *
 * For now: list the population with a link to each customer so the work is
 * visible. The guided recover-a-phone branch and the email/postal workflow are
 * the next build.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, PhoneOff } from 'lucide-react'

type UnableCustomer = {
  id: string
  customer_id: string | null
  customer: { id: string; first_name: string | null; last_name: string | null; email: string | null }
}

export function UnableToCallClient({ projectId = null }: { projectId?: string | null }) {
  const [items, setItems] = useState<UnableCustomer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const params = new URLSearchParams({ population: 'unable-to-call' })
      if (projectId) params.set('project_id', projectId)
      const res = await fetch(`/api/stewardship?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? 'Failed to load.'); return }
      setItems((json.data.items ?? []) as UnableCustomer[])
    } catch {
      setError('Network error. Try again.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-surface-border bg-surface-card p-6 text-ink-supporting">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-tag-blocked-border bg-tag-blocked-fill p-6 text-tag-blocked-text">
        {error}
      </div>
    )
  }

  const name = (c: UnableCustomer) =>
    [c.customer?.first_name, c.customer?.last_name].filter(Boolean).join(' ') || 'Unknown customer'

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
        <p className="text-base text-ink-secondary">
          These customers are active in outreach but have no phone number on file, so we cannot call
          them. The workflow to recover a phone (and fall back to email or postal mail when none can
          be found) is being built. For now they are listed here so none are overlooked. Open a
          customer to research a phone; once one is on file, they return to the calls that are due.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <PhoneOff className="size-5 text-ink-supporting" aria-hidden />
        <h2 className="text-[22px] font-semibold leading-tight text-ink">People We Can&apos;t Call</h2>
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-sm font-medium text-ink-supporting">
          {items.length}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-surface-border bg-surface-card p-6 text-ink-supporting">
          Nobody is unreachable by phone right now.
        </div>
      ) : (
        <ul className="divide-y divide-surface-border rounded-2xl border border-surface-border bg-surface-card">
          {items.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-base font-medium text-ink">{name(c)}</p>
                <p className="text-sm text-ink-supporting">
                  {c.customer?.email?.trim() ? `Email on file: ${c.customer.email}` : 'No email on file'}
                  {' · '}No phone
                </p>
              </div>
              {c.customer?.id && (
                <Link
                  href={`/customers/${c.customer.id}`}
                  className="shrink-0 text-sm font-medium text-brand transition-colors hover:text-brand-hover"
                >
                  Open customer
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
