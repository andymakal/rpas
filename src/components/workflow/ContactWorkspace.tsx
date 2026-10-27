'use client'

/**
 * Universal Contact Workspace — STORYBOOK DESIGN ARTIFACT (not wired to any
 * route, schema, or business rule).
 *
 * This component is a presentational composition of the EXISTING Right Path
 * shared layer, assembled into one operator-facing "contact this customer"
 * surface that is purpose-agnostic. It reuses, without forking:
 *
 *   - the action-first `TaskShell` (context left is wrong — context right;
 *     action left) and the workflow primitives (`ActionPanel`,
 *     `PrimaryAction`, `WorkflowButton`, `OperationalTag`, `NextNote`),
 *   - the shared `CustomerContactCard` for the customer's identity + verifiable
 *     contact facts (driven by an in-memory `onPersist`),
 *   - the `AssistantPanel` identity treatment for purpose-specific guidance,
 *   - the established scripts/templates vocabulary (`SCRIPTS`/`TEMPLATES` shape)
 *     surfaced as copy cards in the light theme,
 *   - the established communication-history + call-outcome vocabulary
 *     (`CallOutcome`, the attempt/touch channels, the date-only callback
 *     commitment) exactly as the Stewardship workflow models them.
 *
 * It intentionally performs NO business judgment, NO data access, and NO
 * persistence beyond local React state. Every "action" is a local callback the
 * story wires to a no-op. The point is to show the SHAPE of a universal contact
 * workspace that keeps customer context, history, and commitments accessible
 * while leading with purpose-specific guidance, communication options, outcome
 * recording, and the resulting next action — reusing what already exists rather
 * than inventing a parallel design.
 *
 * Nothing here changes `CustomerContactCard`, the workflow primitives, the
 * scripts, the queue/outcome types, or any production route. It only arranges
 * them.
 */

import { useMemo, useState } from 'react'
import {
  Phone,
  Mail,
  MessageSquare,
  Copy,
  Check,
  Clock,
  History,
  CalendarClock,
  CircleAlert,
  PhoneCall,
  Voicemail,
  PhoneOff,
  CornerUpRight,
} from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import {
  TaskShell,
  ActionPanel,
  ContextLabel,
  PrimaryAction,
  WorkflowButton,
  OperationalTag,
  NextNote,
  type OperationalTone,
} from './primitives'
import { ContextHeader, AssistantPanel, type ContextField } from './panels'
import {
  CustomerContactCard,
  type CustomerContact,
  type ContactPersistPayload,
  type ContactCardAppearance,
} from './CustomerContactCard'

// Re-export the shared card's types so this artifact's public surface
// (component + stories) imports them from one place. These are the SAME types
// the production card defines; nothing is redeclared.
export type { CustomerContact, ContactPersistPayload, ContactCardAppearance }

/**
 * Which communication channels the workspace offers, independent of the stored
 * record. `auto` (the default for each) derives availability from the contact
 * facts, exactly as production does; `on`/`off` force the channel so a
 * playground can show the offered/disabled treatments deliberately.
 */
export type ChannelAvailability = 'auto' | 'on' | 'off'

export interface CommunicationMethodOverrides {
  call?: ChannelAvailability
  text?: ChannelAvailability
  email?: ChannelAvailability
}

/** Which workspace blocks are shown. All default to visible; a playground can
 * hide any to study the surface without it. These are presentation toggles,
 * not business logic. */
export interface WorkspaceVisibility {
  guidance?: boolean
  communication?: boolean
  outcome?: boolean
  scripts?: boolean
  contactCard?: boolean
  history?: boolean
  commitment?: boolean
}

type IconType = ComponentType<{ className?: string }>

// ─────────────────────────────────────────────────────────────────────────────
// Shared vocabulary — mirrors the EXISTING types so a real wiring maps 1:1.
//
// CallOutcome and the contact channels are the same values the Stewardship
// workflow already uses (src/lib/stewardship/queues.ts). They are re-declared
// here only so this Storybook artifact has no import dependency on server-only
// modules; the names and meanings are identical by design.
// ─────────────────────────────────────────────────────────────────────────────

/** The recorded result of a call, matching the production `CallOutcome`. */
export type CallOutcome = 'reached' | 'voicemail' | 'bad-number' | 'not-interested' | 'callback'

/** The communication channels offered, matching the production touch channels. */
export type ContactChannel = 'call' | 'voicemail' | 'text' | 'email'

/**
 * One past communication, matching the shape `case_touches` carries once its
 * note marker is parsed (channel + when + outcome + optional reached + who).
 * This is display-only; the workspace never writes history.
 */
export interface CommunicationEntry {
  id: string
  channel: ContactChannel | 'postal' | 'research'
  /** Human date label, already formatted for display. */
  when: string
  /** Short description of what happened, markers already stripped. */
  summary: string
  /** Who recorded it (touched_by), when known. */
  by?: string
  /** True when a call reached the customer (the [reached] marker). */
  reached?: boolean
}

/**
 * A promised callback commitment. DATE-ONLY by design — Right Path records no
 * clock time and no preferred window for a callback, so the workspace shows a
 * date, never a time of day.
 */
export interface CallbackCommitment {
  /** YYYY-MM-DD. */
  date: string
  /** Optional free-text note the worker left with the promise. */
  note?: string
}

/** A copy-to-use talk track / canned message, matching the SCRIPTS shape. */
export interface ContactScript {
  label: string
  body: string
}

/**
 * The PURPOSE of this contact: why the workspace is open on this customer. This
 * is what makes the surface universal — a 1035 servicing-onboarding call and a
 * general customer check-in are the same workspace with a different purpose
 * block. It carries the reason (shown prominently), the guidance prose, and the
 * purpose-specific scripts. It does NOT carry any routing or state-machine
 * logic; that stays in the real workflow.
 */
export interface ContactPurpose {
  /** Short origin label, e.g. "1035 servicing onboarding" or "Policy review". */
  origin: string
  /** The one-line action heading, e.g. "Call Stephen Remy". */
  actionHeading: string
  /** The prominent reason tag text (the WHY). */
  reason: string
  /** Tone for the reason tag. */
  reasonTone?: OperationalTone
  /** Purpose-specific guidance prose shown in the Assistant block. */
  guidance: ReactNode
  /** The resulting next state, shown as the "what happens next" note. */
  nextNote: ReactNode
  /** Purpose-specific talk tracks surfaced as copy cards. */
  scripts: ContactScript[]
}

// ─────────────────────────────────────────────────────────────────────────────
// LightScriptCard — the ScriptCard interaction, retoned for the light workflow
// theme. The existing src/components/ScriptCard.tsx is dark-themed (slate-800
// fill); this keeps the identical copy-to-clipboard behavior but uses the
// light-theme surface/ink tokens so it belongs on a workflow task screen. It
// does not replace ScriptCard; it is the light-theme sibling the design calls
// for.
// ─────────────────────────────────────────────────────────────────────────────

function LightScriptCard({ label, body }: ContactScript) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-2 rounded-xl border border-surface-border bg-surface-muted p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-supporting">{label}</p>
        <button
          type="button"
          onClick={() => { navigator.clipboard?.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-surface-border-strong bg-surface-card px-2 py-0.5 text-xs font-medium text-ink-secondary transition-colors hover:border-brand-ring hover:bg-brand-wash hover:text-brand-subtle-foreground"
        >
          {copied ? <><Check className="size-3 text-status-confirmed" aria-hidden /> Copied</> : <><Copy className="size-3" aria-hidden /> Copy</>}
        </button>
      </div>
      <p className="text-sm leading-relaxed text-ink-secondary">{body}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Communication options — the channels the worker can actually use. Protocol
// links only (tel:/sms:/mailto:), exactly as the app does today: launching the
// channel is NOT proof of contact. The worker records the outcome below. A
// channel with no usable value is shown disabled and plainly, never hidden.
// ─────────────────────────────────────────────────────────────────────────────

function resolveChannel(available: boolean, override?: ChannelAvailability): boolean {
  if (override === 'on') return true
  if (override === 'off') return false
  return available
}

function CommunicationOptions({
  customer,
  methods,
}: {
  customer: CustomerContact
  methods?: CommunicationMethodOverrides
}) {
  const phoneDigits = (customer.phone ?? '').replace(/\D/g, '')
  const canCall = resolveChannel(phoneDigits.length >= 10, methods?.call)
  const canText = resolveChannel(phoneDigits.length >= 10, methods?.text)
  const canEmail = resolveChannel(!!customer.email, methods?.email)

  return (
    <div className="space-y-2">
      <ContextLabel>Reach the customer</ContextLabel>
      {/* The single primary action is dialing: the dominant thing to do on a
          call-purpose workspace. Launching the dialer is not completion. */}
      {canCall ? (
        <a href={`tel:${phoneDigits}`} className="block">
          <PrimaryAction icon={Phone} label={`Call ${customer.phone}`} />
        </a>
      ) : (
        <PrimaryAction icon={Phone} label="No phone on file" disabled />
      )}
      <div className="flex flex-wrap gap-2">
        {canText ? (
          <a href={`sms:${phoneDigits}`}>
            <WorkflowButton icon={MessageSquare}>Text</WorkflowButton>
          </a>
        ) : (
          <WorkflowButton icon={MessageSquare} disabled>Text</WorkflowButton>
        )}
        {canEmail ? (
          <a href={`mailto:${customer.email}`}>
            <WorkflowButton icon={Mail}>Email</WorkflowButton>
          </a>
        ) : (
          <WorkflowButton icon={Mail} disabled>No email on file</WorkflowButton>
        )}
      </div>
      <p className="text-sm text-ink-supporting">
        Launching a channel opens your own phone or Outlook. It does not record contact — record what happened below.
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// OutcomeRecorder — record the result of the contact. Reuses the production
// CallOutcome vocabulary and the date-only callback commitment. Local state
// only: selecting an outcome calls `onRecord`, which the story wires to a
// no-op. The callback outcome reveals a DATE field (no time of day), matching
// Right Path's date-only commitment model.
// ─────────────────────────────────────────────────────────────────────────────

const OUTCOME_META: Record<CallOutcome, { label: string; icon: IconType }> = {
  reached: { label: 'Reached', icon: PhoneCall },
  voicemail: { label: 'Voicemail', icon: Voicemail },
  'bad-number': { label: 'Bad number', icon: PhoneOff },
  'not-interested': { label: 'Not interested', icon: CircleAlert },
  callback: { label: 'Callback later', icon: CalendarClock },
}

const OUTCOME_ORDER: CallOutcome[] = ['reached', 'voicemail', 'callback', 'bad-number', 'not-interested']

/** The resulting-state note for each outcome, mirroring the settled transitions
 * (no automatic lost/closed state; a callback resurfaces on its date; a
 * voicemail schedules the next attempt; not-interested is a reversible stop). */
const OUTCOME_NEXT: Record<CallOutcome, string> = {
  reached: 'Reached. Capture what you agreed and move to the next step for this purpose.',
  voicemail: 'Voicemail recorded. The next attempt is scheduled; nothing is closed.',
  callback: 'The customer stays active and resurfaces on the promised date.',
  'bad-number': 'Routed to contact research to find a usable number. Nothing is closed.',
  'not-interested': 'Recorded as not interested. Outreach stops; a human decides any next step, and this is reversible.',
}

function OutcomeRecorder({
  initialOutcome,
  initialCallbackDate,
  onRecord,
}: {
  initialOutcome?: CallOutcome | null
  initialCallbackDate?: string
  onRecord?: (outcome: CallOutcome, callbackDate?: string) => void
}) {
  const [outcome, setOutcome] = useState<CallOutcome | null>(initialOutcome ?? null)
  const [callbackDate, setCallbackDate] = useState(initialCallbackDate ?? '')

  return (
    <div className="space-y-3 border-t border-surface-divider pt-5">
      <ContextLabel>Record the outcome</ContextLabel>
      <div className="flex flex-wrap gap-2">
        {OUTCOME_ORDER.map((id) => {
          const meta = OUTCOME_META[id]
          return (
            <WorkflowButton
              key={id}
              icon={meta.icon}
              selected={outcome === id}
              onClick={() => {
                setOutcome(id)
                if (id !== 'callback') onRecord?.(id)
              }}
            >
              {meta.label}
            </WorkflowButton>
          )
        })}
      </div>

      {outcome === 'callback' && (
        <div className="space-y-2 rounded-xl border border-surface-border bg-surface-muted p-4">
          <label htmlFor="cw-callback" className="flex items-center gap-2 text-base font-medium text-ink">
            <Clock className="size-4 text-ink-supporting" aria-hidden /> Promised callback date
          </label>
          {/* Date only. Right Path records no clock time for a callback. */}
          <input
            id="cw-callback"
            type="date"
            value={callbackDate}
            onChange={(e) => setCallbackDate(e.target.value)}
            className="w-full max-w-xs rounded-lg border border-surface-border-strong bg-surface-card px-3 py-2 text-base text-ink focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/40"
          />
          <WorkflowButton icon={Check} selected disabled={!callbackDate} onClick={() => onRecord?.('callback', callbackDate)}>
            Set callback
          </WorkflowButton>
        </div>
      )}

      {outcome && <NextNote>{OUTCOME_NEXT[outcome]}</NextNote>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CommunicationHistory — the customer's past touches, newest first. Display
// only; it reflects the case_touches history the app already keeps. A reached
// call is marked distinctly, matching how the attempt model flags [reached].
// ─────────────────────────────────────────────────────────────────────────────

const CHANNEL_ICON: Record<CommunicationEntry['channel'], IconType> = {
  call: PhoneCall,
  voicemail: Voicemail,
  text: MessageSquare,
  email: Mail,
  postal: CornerUpRight,
  research: History,
}

function CommunicationHistory({ entries }: { entries: CommunicationEntry[] }) {
  return (
    <section className="space-y-3 rounded-xl border border-surface-border bg-surface-card p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-ink-supporting">
        <History className="size-4" aria-hidden /> Communication history
      </p>
      {entries.length === 0 ? (
        <p className="text-sm italic text-ink-muted">No recorded contact yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {entries.map((e) => {
            const Icon = CHANNEL_ICON[e.channel]
            return (
              <li key={e.id} className="flex gap-2.5">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-supporting">
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-base text-ink">
                    <span>{e.summary}</span>
                    {e.reached && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-status-confirmed-border bg-status-confirmed-soft px-2 py-0.5 text-xs font-semibold text-status-confirmed-strong">
                        <Check className="size-3" aria-hidden /> Reached
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-ink-supporting">
                    {e.when}{e.by ? ` · ${e.by}` : ''}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CommitmentBanner — a date-only promised callback, surfaced prominently as due
// work when present. Carries the WHY-to-contact-now the Assistant cares about.
// ─────────────────────────────────────────────────────────────────────────────

function formatDateOnly(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function CommitmentBanner({ commitment }: { commitment: CallbackCommitment }) {
  return (
    <div className="rounded-xl border border-brand-subtle bg-brand-wash p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-brand-hover">
        <CalendarClock className="size-4" aria-hidden /> Promised callback
      </p>
      <p className="mt-1 text-lg font-semibold text-ink">Due {formatDateOnly(commitment.date)}</p>
      {commitment.note && <p className="mt-0.5 text-base text-ink-secondary">{commitment.note}</p>}
      <p className="mt-1 text-sm text-ink-supporting">A promised callback outranks focus-based ordering. Date only, no time of day is recorded.</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ContactWorkspace — the universal surface. Purpose drives the left column
// (guidance, communication, outcome, next); the customer's durable context
// (identity, verifiable contact facts, commitments, history) stays accessible
// on the right. Same shape for every purpose; only `purpose` changes.
// ─────────────────────────────────────────────────────────────────────────────

export interface ContactWorkspaceProps {
  customer: CustomerContact
  purpose: ContactPurpose
  /** Past communications, newest first. Display only. */
  history?: CommunicationEntry[]
  /** An active promised callback, if any. Shown prominently. */
  commitment?: CallbackCommitment
  /** Preselected outcome, to render a specific recorded state in a story. */
  recordedOutcome?: CallOutcome | null
  /** Preset callback date for the callback state. */
  recordedCallbackDate?: string
  /** Local no-op the story supplies; never persists. */
  onRecordOutcome?: (outcome: CallOutcome, callbackDate?: string) => void
  /** In-memory persistence for the shared contact card (story supplies it). */
  onPersistContact?: (customerId: string, payload: ContactPersistPayload) => Promise<CustomerContact>
  /** Presentation-only overrides forwarded to the embedded shared card. The
   * same `appearance` prop the Customer Contact playground drives. */
  cardAppearance?: ContactCardAppearance
  /** Force/clear which communication channels are offered. */
  methods?: CommunicationMethodOverrides
  /** Which workspace blocks are shown. */
  visibility?: WorkspaceVisibility
  onBack?: () => void
}

export function ContactWorkspace({
  customer,
  purpose,
  history = [],
  commitment,
  recordedOutcome,
  recordedCallbackDate,
  onRecordOutcome,
  onPersistContact,
  cardAppearance,
  methods,
  visibility,
  onBack,
}: ContactWorkspaceProps) {
  const [record, setRecord] = useState<CustomerContact>(customer)

  const fields = useMemo<ContextField[]>(() => contextFieldsFor(record), [record])

  // Every block defaults to visible; a playground can hide any.
  const show = {
    guidance: visibility?.guidance ?? true,
    communication: visibility?.communication ?? true,
    outcome: visibility?.outcome ?? true,
    scripts: visibility?.scripts ?? true,
    contactCard: visibility?.contactCard ?? true,
    history: visibility?.history ?? true,
    commitment: visibility?.commitment ?? true,
  }

  return (
    <TaskShell
      header={
        <ContextHeader
          eyebrow={purpose.origin}
          title={fullName(record)}
          fields={fields}
          onBack={onBack}
          backLabel="Back to work"
        />
      }
      action={
        <>
          {/* Purpose-specific guidance, in the Assistant identity treatment.
              This is the "why am I contacting this person, and how to handle
              it" block that makes the workspace universal. */}
          {show.guidance && (
            <AssistantPanel heading={purpose.actionHeading} label="Guidance" density="compact">
              <OperationalTag tone={purpose.reasonTone ?? 'reason'}>{purpose.reason}</OperationalTag>
              <div className="max-w-prose text-base leading-relaxed text-ink-secondary">{purpose.guidance}</div>
            </AssistantPanel>
          )}

          {(show.communication || show.outcome) && (
            <ActionPanel heading="Contact and record">
              {show.communication && <CommunicationOptions customer={record} methods={methods} />}
              {show.outcome && (
                <OutcomeRecorder
                  initialOutcome={recordedOutcome}
                  initialCallbackDate={recordedCallbackDate}
                  onRecord={onRecordOutcome}
                />
              )}
              <NextNote>{purpose.nextNote}</NextNote>
            </ActionPanel>
          )}

          {show.scripts && purpose.scripts.length > 0 && (
            <ActionPanel heading="Talk tracks">
              <p className="text-base text-ink-secondary">Copy a script to use on the call or paste into a message. Nothing sends automatically.</p>
              <div className="space-y-2.5">
                {purpose.scripts.map((s) => <LightScriptCard key={s.label} {...s} />)}
              </div>
            </ActionPanel>
          )}
        </>
      }
      context={
        <>
          {show.commitment && commitment && <CommitmentBanner commitment={commitment} />}

          {show.contactCard && (
            <div className="space-y-2">
              <ContextLabel>Customer contact</ContextLabel>
              {/* The REAL shared card, running on in-memory persistence. Editing
                  and verifying stay fully interactive and side-effect free. The
                  appearance prop is the same one the Customer Contact playground
                  drives. */}
              <CustomerContactCard
                customer={record}
                onChange={setRecord}
                onPersist={onPersistContact}
                appearance={cardAppearance}
              />
            </div>
          )}

          {show.history && <CommunicationHistory entries={history} />}
        </>
      }
    />
  )
}

// ── Local helpers (display only) ─────────────────────────────────────────────

function fullName(c: CustomerContact): string {
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Customer'
}

/** Map the customer's contact facts onto the header field cues, using the same
 * green/amber/red meaning the verification key explains (verified / on file /
 * missing). Icons mirror the field types. */
function contextFieldsFor(c: CustomerContact): ContextField[] {
  const hasAddress = !!(c.street || c.address_line1) && !!c.city && !!c.state && !!c.zip
  return [
    fieldCue('Phone', c.phone, !!c.phone, c.phone_verified_at, Phone),
    fieldCue('Email', c.email, !!c.email, c.email_verified_at, Mail),
    fieldCue(
      'Mailing address',
      hasAddress ? `${c.street ?? c.address_line1}, ${c.city} ${c.state} ${c.zip}` : null,
      hasAddress,
      c.address_verified_at,
      CornerUpRight,
    ),
  ]
}

function fieldCue(
  label: string,
  value: string | null,
  present: boolean,
  verifiedAt: string | null,
  icon: IconType,
): ContextField {
  const tone = !present ? 'missing' : verifiedAt ? 'confirmed' : 'known'
  const statusLabel = tone === 'confirmed' ? 'Customer verified' : tone === 'known' ? 'On file, not verified' : 'Missing'
  return {
    label,
    value: present ? value : 'Not on file',
    empty: !present,
    statusTone: tone,
    statusIcon: icon,
    statusLabel,
  }
}
