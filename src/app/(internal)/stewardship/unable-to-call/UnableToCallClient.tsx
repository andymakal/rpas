'use client'

/**
 * People We Can't Call — the continuous working screen for active outreach
 * customers with NO usable phone. Same shape as the other outreach working
 * screens (Calls Due, Introductory Emails): land straight on the first eligible
 * customer, work them, advance automatically.
 *
 * Per customer (the panel is UnableToCallAction, driven by forceUnableToCall):
 *   1. Research for a phone (Gateway + the other lookup sources).
 *   2. Found one -> save it on the Customer Contact card; the customer becomes
 *      callable and the task hands off to the guided call flow RIGHT HERE, so
 *      the worker calls now. On the next pass they are in the normal Calls Due
 *      queue and never appear on this screen again.
 *   3. No phone -> generate the authorization email + form AND the postal packet
 *      (Option B: both at once), record the send, and advance.
 *
 * Reuses the shared reservation + direct-candidate machinery so two workers
 * never land on the same customer, exactly like Calls Due.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, CheckCircle2, ArrowLeft, RefreshCw, PhoneOff } from 'lucide-react'
import { MentorCapButton, MentorCapPanel, useMentorDisclosure } from '@/lib/mentoring/MentorUi'
import { useWorkReservation } from '@/lib/reservations/useWorkReservation'
import { reserveNextDirectCandidate } from '@/lib/reservations/reserveNextDirectCandidate'
import { StewardshipTask } from '../StewardshipClient'

type PopulationCustomer = { id: string; first_name: string | null; last_name: string | null }
type PopulationItem = {
  id: string | null
  virtual?: boolean
  customer_id?: string | null
  customer: PopulationCustomer
}

export function UnableToCallClient({
  projectId = null,
}: {
  projectId?: string | null
}) {
  const [items, setItems] = useState<PopulationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const openCustomerIdRef = useRef<string | null>(null)
  const [handled, setHandled] = useState<Set<string>>(() => new Set())
  const [skipOrder, setSkipOrder] = useState<string[]>([])
  const { open: mentorOpen, setOpen: setMentorOpen } = useMentorDisclosure()

  // The no-phone customers are worked on the SAME reservation key as calling
  // ('available_to_call'): recovering a phone hands straight into the call, so a
  // customer reserved here must look busy to the calling activity too.
  const { reserveNext, release } = useWorkReservation({
    activity: 'available_to_call',
    subjectType: 'stewardship_outreach',
  })

  const load = useCallback(async () => {
    setError(null)
    try {
      const params = new URLSearchParams({ population: 'unable-to-call' })
      if (projectId) params.set('project_id', projectId)
      const res = await fetch(`/api/stewardship?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? 'Failed to load.'); return }
      setItems((json.data.items ?? []) as PopulationItem[])
    } catch {
      setError('Network error loading the population. Try again.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const candidateKey = useCallback(
    (it: PopulationItem): string => it.id ?? `virtual:${it.customer_id ?? ''}`,
    [],
  )

  const remaining = useMemo(
    () => items.filter(it => !handled.has(candidateKey(it))),
    [items, handled, candidateKey],
  )

  const orderedCandidates = useMemo(() => {
    if (skipOrder.length === 0) return remaining
    const skipIndex = new Map(skipOrder.map((key, i) => [key, i]))
    const notSkipped = remaining.filter(it => !skipIndex.has(candidateKey(it)))
    const skipped = remaining
      .filter(it => skipIndex.has(candidateKey(it)))
      .sort((a, b) => (skipIndex.get(candidateKey(a)) ?? 0) - (skipIndex.get(candidateKey(b)) ?? 0))
    return [...notSkipped, ...skipped]
  }, [remaining, skipOrder, candidateKey])

  const directOpenedRef = useRef(false)
  useEffect(() => {
    if (loading || error || directOpenedRef.current) return
    directOpenedRef.current = true
    void reserveNextDirectCandidate(orderedCandidates, reserveNext)
      .then(reserved => {
        if (reserved) {
          openCustomerIdRef.current = reserved.customerId
          setOpenId(reserved.outreachId)
        }
      })
      .catch(() => {
        directOpenedRef.current = false
        setError('Could not reserve a customer. Try again.')
      })
  }, [loading, error, orderedCandidates, reserveNext])

  const advanceAfterSend = useCallback(() => {
    if (!openId) return
    const handledId = openId
    const handledCustomerId = openCustomerIdRef.current
    setHandled(prev => {
      const next = new Set(prev)
      next.add(handledId)
      if (handledCustomerId) next.add(`virtual:${handledCustomerId}`)
      return next
    })
    void release()
    const candidates = orderedCandidates.filter(
      it => it.id !== handledId && candidateKey(it) !== (handledCustomerId ? `virtual:${handledCustomerId}` : ''),
    )
    void reserveNextDirectCandidate(candidates, reserveNext)
      .then(reserved => {
        openCustomerIdRef.current = reserved?.customerId ?? null
        setOpenId(reserved?.outreachId ?? null)
      })
      .catch(() => {
        setOpenId(null)
        setError('Could not advance to the next customer. Try again.')
      })
    void load()
  }, [openId, orderedCandidates, load, release, reserveNext, candidateKey])

  const advanceAfterSkip = useCallback(() => {
    if (!openId) return
    const openCustomerId = openCustomerIdRef.current
    const stillVirtual =
      !!openCustomerId && remaining.some(it => it.id === null && it.customer_id === openCustomerId)
    const skippedKey = stillVirtual ? `virtual:${openCustomerId}` : openId
    setSkipOrder(prev => [...prev.filter(k => k !== skippedKey), skippedKey])
    void release()
    const skipIndex = new Map(
      [...skipOrder.filter(k => k !== skippedKey), skippedKey].map((key, i) => [key, i]),
    )
    const resequenced = [
      ...remaining.filter(it => !skipIndex.has(candidateKey(it))),
      ...remaining
        .filter(it => skipIndex.has(candidateKey(it)))
        .sort((a, b) => (skipIndex.get(candidateKey(a)) ?? 0) - (skipIndex.get(candidateKey(b)) ?? 0)),
    ]
    void reserveNextDirectCandidate(resequenced, reserveNext)
      .then(reserved => {
        openCustomerIdRef.current = reserved?.customerId ?? null
        setOpenId(reserved?.outreachId ?? null)
      })
      .catch(() => {
        setOpenId(null)
        setError('Could not advance to the next customer. Try again.')
      })
  }, [openId, skipOrder, remaining, release, reserveNext, candidateKey])

  const handledCount = handled.size

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-surface-border bg-surface-card p-6 text-ink-supporting">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4 rounded-2xl border border-tag-blocked-border bg-tag-blocked-fill p-6 text-tag-blocked-text">
        <p>{error}</p>
        <button
          type="button"
          onClick={() => { setError(null); setHandled(new Set()); directOpenedRef.current = false; setLoading(true); void load() }}
          className="inline-flex items-center gap-2 rounded-xl border border-surface-border-strong bg-surface-card px-4 py-2 text-base font-medium text-ink-secondary transition-colors hover:bg-surface-muted"
        >
          <RefreshCw className="size-4" aria-hidden /> Try again
        </button>
      </div>
    )
  }

  if (openId) {
    const otherRemaining = remaining.filter(it => it.id !== null && it.id !== openId)
    const remainingVirtuals = remaining.filter(it => it.id === null)
    const hasNext = otherRemaining.length > 0 || remainingVirtuals.length > 1
    return (
      <StewardshipTask
        key={openId}
        itemId={openId}
        forceUnableToCall
        hideBackHeader
        hasNextInActivity={hasNext}
        onAdvanceToNext={advanceAfterSend}
        onSkip={advanceAfterSkip}
        onBack={() => { void load() }}
      />
    )
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <p className="text-base font-semibold text-ink">About Find Missing Phone Numbers</p>
        {!mentorOpen && (
          <MentorCapButton size="text-base" onOpen={() => setMentorOpen(true)} label="Show mentoring on finding missing phone numbers" />
        )}
      </div>
      {mentorOpen && (
        <MentorCapPanel onClose={() => setMentorOpen(false)}>
          Find a working phone number for customers we cannot currently call. If none is available,
          use email or postal mail to reach them.
        </MentorCapPanel>
      )}

      <div className="flex flex-col items-center gap-4 rounded-2xl border border-surface-border bg-surface-card p-10 text-center">
        <CheckCircle2 className="size-12 text-status-confirmed-strong" aria-hidden />
        <div className="space-y-1">
          <p className="text-xl font-semibold text-ink">
            {handledCount > 0 ? 'All handled' : 'Nobody is unreachable by phone right now'}
          </p>
          <p className="text-lg text-ink-secondary">
            {handledCount > 0
              ? `You handled ${handledCount} ${handledCount === 1 ? 'customer' : 'customers'} this session.`
              : 'Everyone in outreach has a phone on file, or is being worked elsewhere.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/my-work"
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-lg font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            <ArrowLeft className="size-5" aria-hidden /> Back to My Work
          </Link>
          <button
            type="button"
            onClick={() => { setHandled(new Set()); directOpenedRef.current = false; setLoading(true); void load() }}
            className="inline-flex items-center gap-2 rounded-xl border border-surface-border-strong px-5 py-3 text-lg font-medium text-ink-secondary transition-colors hover:bg-surface-muted"
          >
            <RefreshCw className="size-5" aria-hidden /> Check again
          </button>
        </div>
        <p className="inline-flex items-center gap-1.5 text-sm text-ink-supporting">
          <PhoneOff className="size-4" aria-hidden /> People We Can&apos;t Call
        </p>
      </div>
    </section>
  )
}
