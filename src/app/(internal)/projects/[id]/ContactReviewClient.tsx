'use client'

/**
 * Contact Review — a fast look-up-and-complete pass over a project's customers
 * whose contact information is incomplete (missing a usable email or phone).
 *
 * The worker works the list continuously: open a customer, copy their name into
 * eAgent Quick Search, read what eAgent shows, type in the email and/or phone
 * they find, and Save & Next — or, if eAgent has nothing usable, Nothing Usable
 * & Next. Either action advances to the next customer in place; the worker never
 * returns to the queue between customers, and a customer already handled this
 * session is not presented again.
 *
 * Reuses the shared light-theme workflow design system (the same look as the
 * Stewardship research task) and the Assistant panel. It writes only to the
 * customer record and never creates stewardship work, duplicate customers, or a
 * separate contact record.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2, Mail, Phone, Copy, Check, Save, SkipForward,
  ClipboardCheck, UserRound,
} from 'lucide-react'
import {
  TaskShell, ActionPanel, PrimaryAction, WorkflowButton, NextNote,
  ContextHeader, type ContextField, SlimTaskHeader, AssistantPanel,
  QueueListHeader, CustomerQueueCard, QueueEmptyState, OperationalTag,
} from '@/components/workflow'

type ContactReviewCustomer = {
  customer_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  has_email: boolean
  has_phone: boolean
}

type Summary = { total: number; missing_both: number; one_usable: number }

function fullName(c: Pick<ContactReviewCustomer, 'first_name' | 'last_name'>): string {
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Unknown customer'
}

function usable(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0
}

/** The compact one-line summary of what the customer is missing. */
function gapDetail(c: ContactReviewCustomer): string {
  if (!c.has_email && !c.has_phone) return 'No email, no phone'
  if (!c.has_email) return 'Missing email'
  return 'Missing phone'
}

export function ContactReviewClient({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<ContactReviewCustomer[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // The customer open right now. null means the list is showing.
  const [openId, setOpenId] = useState<string | null>(null)
  // Customers handled during THIS session (saved or skipped). They are not
  // presented again, so the worker moves forward continuously. Session-local by
  // design: the requirement is "not during the current review session", and the
  // durable truth is simply whether the customer still lacks contact info.
  const [handled, setHandled] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/contact-review`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to load'); return }
      setRows(json.data.customers as ContactReviewCustomer[])
      setSummary(json.data.summary as Summary)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  // The still-to-do list: project customers missing contact info, minus the
  // ones handled this session. Saved-and-still-incomplete customers stay out of
  // the list for the session because they are in `handled`.
  const remaining = useMemo(
    () => rows.filter(r => !handled.has(r.customer_id)),
    [rows, handled],
  )

  const openCustomer = useMemo(
    () => rows.find(r => r.customer_id === openId) ?? null,
    [rows, openId],
  )

  // Mark a customer handled for this session and advance to the next unhandled
  // customer. If none remain, return to the (now empty) list so the worker sees
  // the done state. Used by both Save & Next and Nothing Usable & Next.
  const markHandledAndAdvance = useCallback((customerId: string) => {
    setHandled(prev => {
      const next = new Set(prev)
      next.add(customerId)
      return next
    })
    // `remaining`/`handled` update on the next render; compute the next target
    // from the current rows excluding this one and the already-handled set.
    const next = rows.find(
      r => r.customer_id !== customerId && !handled.has(r.customer_id),
    )
    setOpenId(next ? next.customer_id : null)
  }, [rows, handled])

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-surface-border bg-surface-card p-6 text-ink-supporting">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading contact review…
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

  // ── Single-customer task ───────────────────────────────────────────────────
  if (openId && openCustomer) {
    return (
      <ContactReviewTask
        key={openCustomer.customer_id}
        projectId={projectId}
        customer={openCustomer}
        remainingCount={remaining.length}
        onBack={() => setOpenId(null)}
        onSaved={(updated) => {
          // Reflect the saved values in the local rows so the list/summary stay
          // accurate without a full reload, then advance.
          setRows(prev => prev.map(r => r.customer_id === updated.customer_id
            ? { ...r, email: updated.email, phone: updated.phone,
                has_email: usable(updated.email), has_phone: usable(updated.phone) }
            : r))
          markHandledAndAdvance(updated.customer_id)
        }}
        onSkipped={() => markHandledAndAdvance(openCustomer.customer_id)}
      />
    )
  }

  // ── The list ─────────────────────────────────────────────────────────────
  const total = summary?.total ?? rows.length
  const handledCount = total - remaining.length

  return (
    <section className="space-y-5">
      <AssistantPanel heading="Complete the contact information eAgent is missing">
        <div className="space-y-3 text-lg leading-relaxed text-ink-secondary">
          <p>
            The Cassidy import left these customers without a complete way to reach them.
            Open a customer, copy their name into eAgent Quick Search, and fill in whatever
            email or phone eAgent shows. Each save writes straight to the customer record.
          </p>
          <p className="text-base text-ink-supporting">
            Work straight down the list. Save &amp; Next moves you to the next customer; if eAgent
            has nothing usable, Nothing Usable &amp; Next keeps you moving. Customers you have
            already handled this session will not come back around.
          </p>
        </div>
        {remaining.length > 0 && (
          <PrimaryAction
            icon={ClipboardCheck}
            label={handledCount > 0 ? 'Continue where you left off' : 'Start the first customer'}
            onClick={() => setOpenId(remaining[0].customer_id)}
          />
        )}
      </AssistantPanel>

      <QueueListHeader
        icon={UserRound}
        label="Needs contact information"
        count={remaining.length}
        blurb="Project customers missing a usable email or phone"
      />

      {remaining.length === 0 ? (
        <QueueEmptyState>
          {total === 0
            ? 'Every customer in this project already has a usable email and phone.'
            : 'All caught up for this session — every customer has been handled.'}
        </QueueEmptyState>
      ) : (
        <div className="space-y-3">
          {remaining.map(c => (
            <CustomerQueueCard
              key={c.customer_id}
              name={fullName(c)}
              detail={gapDetail(c)}
              trailing={
                <OperationalTag tone={!c.has_email && !c.has_phone ? 'blocked' : 'reason'} className="px-3 py-1 text-sm">
                  {!c.has_email && !c.has_phone ? 'No contact' : 'Needs one'}
                </OperationalTag>
              }
              onOpen={() => setOpenId(c.customer_id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ContactReviewTask — one customer: current contact, Copy Name, edit, advance.
// ─────────────────────────────────────────────────────────────────────────────

function ContactReviewTask({
  projectId, customer, remainingCount, onBack, onSaved, onSkipped,
}: {
  projectId: string
  customer: ContactReviewCustomer
  remainingCount: number
  onBack: () => void
  onSaved: (updated: { customer_id: string; email: string | null; phone: string | null }) => void
  onSkipped: () => void
}) {
  const name = fullName(customer)

  // Inputs start from the stored values so existing information is preserved
  // unless the worker changes it. Email and phone are edited independently.
  const [email, setEmail] = useState(customer.email ?? '')
  const [phone, setPhone] = useState(customer.phone ?? '')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  const copyName = useCallback(() => {
    void navigator.clipboard.writeText(name)
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 2000)
  }, [name])

  // Which fields the worker actually changed. Only changed fields are sent, so
  // an untouched field is never written and its stored value is preserved.
  const emailChanged = email.trim() !== (customer.email ?? '').trim()
  const phoneChanged = phone.trim() !== (customer.phone ?? '').trim()
  const hasChanges = emailChanged || phoneChanged

  const save = useCallback(async () => {
    if (!hasChanges) return
    setBusy(true); setSaveError(null)
    const body: { email?: string; phone?: string } = {}
    if (emailChanged) body.email = email.trim()
    if (phoneChanged) body.phone = phone.trim()
    try {
      const res = await fetch(`/api/projects/${projectId}/contact-review/${customer.customer_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { setSaveError(json.error ?? 'Could not save'); return }
      onSaved({
        customer_id: customer.customer_id,
        email: json.data.email ?? null,
        phone: json.data.phone ?? null,
      })
    } catch {
      setSaveError('Network error')
    } finally {
      setBusy(false)
    }
  }, [hasChanges, emailChanged, phoneChanged, email, phone, projectId, customer.customer_id, onSaved])

  const emailStatus = usable(customer.email)
  const phoneStatus = usable(customer.phone)

  const contextFields: ContextField[] = [
    {
      label: 'Email on file',
      value: emailStatus ? customer.email : 'Not on file',
      empty: !emailStatus,
      statusTone: emailStatus ? 'known' : 'missing',
      statusIcon: Mail,
      statusLabel: emailStatus ? 'Email on file (not customer-confirmed)' : 'No email on file',
    },
    {
      label: 'Phone on file',
      value: phoneStatus ? customer.phone : 'Not on file',
      empty: !phoneStatus,
      statusTone: phoneStatus ? 'known' : 'missing',
      statusIcon: Phone,
      statusLabel: phoneStatus ? 'Phone on file (not customer-confirmed)' : 'No phone on file',
    },
  ]

  return (
    <TaskShell
      header={<SlimTaskHeader onBack={onBack} backLabel="Back to the list" />}
      action={
        <ActionPanel heading={`Complete contact for ${name}`}>
          {/* Why this is here — a prominent, high-contrast operational reason. */}
          <div className="flex items-center gap-2 rounded-xl border border-status-missing-border bg-status-missing-soft p-4 text-base text-status-missing-strong">
            <UserRound className="size-5" aria-hidden /> {gapDetail(customer)} — look this customer up in eAgent.
          </div>

          {/* Step 1: copy the name for eAgent Quick Search. */}
          <div className="space-y-2 rounded-xl border border-surface-border bg-surface-muted/40 p-4">
            <p className="text-sm font-medium text-ink-secondary">1. Search eAgent</p>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-lg font-semibold text-ink">{name}</span>
              <WorkflowButton icon={copied ? Check : Copy} selected={copied} onClick={copyName}>
                {copied ? 'Name copied' : 'Copy Name'}
              </WorkflowButton>
            </div>
            <p className="text-sm text-ink-supporting">
              Paste the name into eAgent Quick Search, then type what you find below.
            </p>
          </div>

          {/* Step 2: enter / correct email and phone independently. */}
          <div className="space-y-4 rounded-xl border border-surface-border bg-surface-card p-4">
            <p className="text-sm font-medium text-ink-secondary">2. Enter what eAgent shows</p>

            <div className="space-y-1.5">
              <label htmlFor="cr-email" className="flex items-center gap-1.5 text-sm font-medium text-ink-secondary">
                <Mail className="size-4" aria-hidden /> Email
              </label>
              <input
                id="cr-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full rounded-lg border border-surface-border-strong px-3 py-2 text-base text-ink focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-wash"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cr-phone" className="flex items-center gap-1.5 text-sm font-medium text-ink-secondary">
                <Phone className="size-4" aria-hidden /> Phone
              </label>
              <input
                id="cr-phone"
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="215-555-0100"
                className="w-full rounded-lg border border-surface-border-strong px-3 py-2 text-base text-ink focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-wash"
              />
            </div>
          </div>

          {saveError && (
            <p className="rounded-lg border border-tag-blocked-border bg-tag-blocked-fill px-3 py-2 text-sm text-tag-blocked-text">
              {saveError}
            </p>
          )}

          {/* The two advancing actions. */}
          <div className="space-y-3">
            <PrimaryAction
              icon={Save}
              label={busy ? 'Saving…' : 'Save & Next'}
              onClick={save}
              disabled={busy || !hasChanges}
            />
            <WorkflowButton icon={SkipForward} onClick={onSkipped} disabled={busy} className="w-full justify-start">
              Nothing Usable &amp; Next
            </WorkflowButton>
          </div>

          <NextNote>
            Save &amp; Next writes only the fields you changed to the customer record and opens the next
            customer. Nothing Usable &amp; Next leaves the record unchanged and continues.
            {remainingCount > 0
              ? ` ${remainingCount} more after this one.`
              : ' This is the last one in the list.'}
          </NextNote>
        </ActionPanel>
      }
      context={
        <ContextHeader
          eyebrow="Contact Review"
          title={name}
          fields={contextFields}
        />
      }
    />
  )
}
