'use client'

/**
 * Shared presentational building blocks for the 1035 Workflow prototype.
 * STORYBOOK-ONLY. Nothing here touches the DB, APIs, or production workflow.
 *
 * This workflow uses a LIGHT interface and does not inherit the dark
 * internal-app appearance. Status is never conveyed by color alone: each status
 * cue pairs a tone with an icon and a text label.
 */

import {
  ShieldCheck, Database, ShieldQuestion, CircleAlert, ExternalLink,
  Mail, Phone, Briefcase, PenLine, MapPin, CalendarDays, Pencil,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FieldStatusDot, type FieldStatusTone, VerificationKey } from '@/components/workflow'
import {
  type Dob,
  type Holding,
  type Person,
  type VerificationStatus,
  type WorkItem,
  dobPrecisionLabel,
  formatDob,
  fullName,
  hasUsableEmail,
  personName,
  preferredPhoneField,
  statusTone,
  verificationLabel,
} from './data'

// ─────────────────────────────────────────────────────────────────────────────
// Status badge — accessible: tone + icon + text, never color alone.
// ─────────────────────────────────────────────────────────────────────────────

export function StatusBadge({ status }: { status: VerificationStatus }) {
  const label = verificationLabel(status)

  if (status === 'customer-verified') {
    return (
      <Badge className="bg-emerald-100 text-emerald-800" title="Confirmed directly with the customer">
        <ShieldCheck className="size-3" aria-hidden /> {label}
      </Badge>
    )
  }
  if (status === 'allstate-record') {
    return (
      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800"
        title="Found in a current Allstate system. Not yet confirmed with the customer.">
        <Database className="size-3" aria-hidden /> {label}
      </Badge>
    )
  }
  if (status === 'not-found') {
    return (
      <Badge variant="outline" className="border-rose-300 bg-rose-50 text-rose-800"
        title="Checked and nothing usable was found">
        <CircleAlert className="size-3" aria-hidden /> {label}
      </Badge>
    )
  }
  // unverified
  return (
    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800"
      title="Known but not yet confirmed with the customer">
      <ShieldQuestion className="size-3" aria-hidden /> {label}
    </Badge>
  )
}

/** Small round status dot with an icon inside, for compact header rows. */
export function StatusDot({ status }: { status: VerificationStatus }) {
  const tone = statusTone(status)
  const label = verificationLabel(status)
  const cls =
    tone === 'confirmed' ? 'bg-emerald-100 text-emerald-700'
      : tone === 'missing' ? 'bg-rose-100 text-rose-700'
        : 'bg-amber-100 text-amber-700'
  const Icon =
    tone === 'confirmed' ? ShieldCheck
      : tone === 'missing' ? CircleAlert
        : ShieldQuestion
  return (
    <span
      className={cn('inline-flex size-5 items-center justify-center rounded-full', cls)}
      title={label}
      role="img"
      aria-label={label}
    >
      <Icon className="size-3" aria-hidden />
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Field + DOB display
// ─────────────────────────────────────────────────────────────────────────────

export function Field({
  label, value, missing, children,
}: {
  label: string
  value?: string | null
  missing?: boolean
  children?: React.ReactNode
}) {
  const empty = missing ?? (value == null || value === '')
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">{label}</p>
      {children ?? (
        <p className={cn('text-sm', empty ? 'italic text-slate-400' : 'text-slate-900')}>
          {empty ? 'Not on file' : value}
        </p>
      )}
    </div>
  )
}

/**
 * DOB display separating two orthogonal facts:
 *   1. PRECISION — how much of the date we hold. Neutral badge. Never invented.
 *   2. SOURCE / CONFIRMATION STATUS — Allstate record / Customer verified /
 *      Unverified. Separate badge.
 */
export function DobDisplay({ dob, status }: { dob: Dob; status: VerificationStatus }) {
  const missing = dob.precision === 'unknown'
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Date of birth</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('text-sm', missing ? 'italic text-slate-400' : 'text-slate-900')}>
          {formatDob(dob)}
        </span>
        <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-600"
          title="How much of the date of birth is on file">
          {dobPrecisionLabel(dob)}
        </Badge>
        <StatusBadge status={status} />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ContactFacts — the customer's durable contact facts, for the right-side
// Customer Context column. DOB, email, preferred phone, and mailing address,
// each with its own field-level verification cue, plus the compact
// verification key. These facts belong here, NOT in the slim task header, and
// are never duplicated above the task.
// ─────────────────────────────────────────────────────────────────────────────

/** Map a 1035 VerificationStatus onto the shared field-status cue. */
function factCue(status: VerificationStatus): { tone: FieldStatusTone; icon: typeof ShieldCheck; label: string } {
  const tone = statusTone(status) as FieldStatusTone
  const icon = tone === 'confirmed' ? ShieldCheck : tone === 'missing' ? CircleAlert : ShieldQuestion
  return { tone, icon, label: verificationLabel(status) }
}

function emptyFact(value: string | null, status: VerificationStatus): boolean {
  return !value || value.trim() === '' || status === 'not-found'
}

function factValue(value: string | null, status: VerificationStatus): string {
  if (emptyFact(value, status)) return status === 'not-found' ? 'Checked, not found' : 'Not on file'
  return value as string
}

function addressLine(a: WorkItem['address']): string | null {
  const parts = [a.line1, [a.city, a.state].filter(Boolean).join(', '), a.zip]
    .filter(Boolean)
    .join(' \u00b7 ')
  return parts || null
}

function FactRow({
  icon, label, value, empty, status,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  empty: boolean
  status?: VerificationStatus
}) {
  const cue = status ? factCue(status) : null
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        {/* Operational field labels stay high-contrast (slate-600): they tell
            the worker which fact they are reading. Only genuinely empty values
            fall back to muted slate-400. */}
        <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-600">
          <span className="text-slate-600">{icon}</span>
          {label}
        </p>
        <p className={cn('text-base', empty ? 'italic text-slate-400' : 'text-slate-900')}>{value}</p>
      </div>
      {cue && <FieldStatusDot tone={cue.tone} icon={cue.icon} label={cue.label} />}
    </div>
  )
}

/**
 * The customer's durable contact facts for the right-side context column. This
 * is the single home for DOB, email, phone, address, and their verification
 * status; the task header stays slim and does not repeat these.
 */
export function ContactFacts({ item }: { item: WorkItem }) {
  const email = item.contact.email
  const phone = preferredPhoneField(item.contact)
  const phoneLabel = item.contact.preferredPhone === 'work' ? 'Work phone' : 'Personal phone'
  const addr = addressLine(item.address)
  const dobMissing = item.dob.precision === 'unknown'

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Contact facts</p>

      <div className="space-y-3">
        <FactRow
          icon={<CalendarDays className="size-3.5" aria-hidden />}
          label={`Date of birth \u00b7 ${dobPrecisionLabel(item.dob)}`}
          value={formatDob(item.dob)}
          empty={dobMissing}
          status={item.dobStatus}
        />
        <FactRow
          icon={<Mail className="size-3.5" aria-hidden />}
          label="Email"
          value={factValue(email.value, email.status)}
          empty={emptyFact(email.value, email.status)}
          status={email.status}
        />
        <FactRow
          icon={item.contact.preferredPhone === 'work'
            ? <Briefcase className="size-3.5" aria-hidden />
            : <Phone className="size-3.5" aria-hidden />}
          label={phoneLabel}
          value={factValue(phone.value, phone.status)}
          empty={emptyFact(phone.value, phone.status)}
          status={phone.status}
        />
        <FactRow
          icon={<MapPin className="size-3.5" aria-hidden />}
          label="Mailing address"
          value={addr ?? 'Not on file'}
          empty={!addr}
        />
      </div>

      <div className="pt-1">
        <VerificationKey />
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Holding row
// ─────────────────────────────────────────────────────────────────────────────

export function currency(n: number | null): string {
  if (n == null) return '\u2014'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export function HoldingRow({
  holding, owner, selectable, selected, onToggle,
}: {
  holding: Holding
  owner: WorkItem
  selectable?: boolean
  selected?: boolean
  onToggle?: () => void
}) {
  const showInsured = holding.insuredName != null && holding.insuredName !== fullName(owner)
  const context = !holding.inRequest
  return (
    <div className={cn(
      'rounded-lg border p-3 transition-colors',
      selected
        ? 'border-teal-400 bg-teal-50'
        : context
          ? 'border-dashed border-slate-200 bg-slate-50'
          : 'border-slate-200 bg-white',
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base text-slate-900">{holding.policyNumber}</span>
            <Badge variant="outline" className="border-slate-300 text-slate-700">{holding.productType}</Badge>
            <Badge variant="outline" className="border-slate-300 text-slate-700">{holding.coverageStatus}</Badge>
          </div>
          <p className="text-sm text-slate-600">
            Face amount <span className="font-medium text-slate-900">{currency(holding.faceAmount)}</span>
            <span className="text-slate-300"> {'\u00b7'} </span>
            {holding.carrier}
          </p>
          {showInsured && (
            <p className="text-xs text-amber-700">
              Insured: {holding.insuredName} <span className="text-slate-500">(not the owner)</span>
            </p>
          )}
          <p className="text-xs text-slate-600">{holding.servicingContext}</p>
        </div>
        {selectable && (
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-slate-700">
            <input type="checkbox" checked={!!selected} onChange={onToggle} className="size-4 accent-teal-600" />
            Include
          </label>
        )}
      </div>
    </div>
  )
}

/**
 * The holdings panel: holdings included in the current request, then other
 * stewarded holdings shown for relationship context. Spreadsheet provenance is
 * never shown.
 */
export function HoldingsPanel({
  item, request, context, selectableRequest, selectedIds, onToggle,
}: {
  item: WorkItem
  request: Holding[]
  context: Holding[]
  selectableRequest?: boolean
  selectedIds?: string[]
  onToggle?: (id: string) => void
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-600">
          Included in this servicing-agent request
        </p>
        {request.length > 0 ? request.map(h => (
          <HoldingRow
            key={h.id} holding={h} owner={item}
            selectable={selectableRequest}
            selected={selectedIds?.includes(h.id)}
            onToggle={() => onToggle?.(h.id)}
          />
        )) : (
          <p className="text-sm italic text-slate-400">No holdings in this request.</p>
        )}
      </div>

      {context.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-600">
            Other stewarded holdings
            <span className="ml-1 normal-case text-slate-500">(relationship context, not part of this request)</span>
          </p>
          {context.map(h => <HoldingRow key={h.id} holding={h} owner={item} />)}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Contact + signer building blocks
// ─────────────────────────────────────────────────────────────────────────────

function ContactLine({
  icon, label, value, status,
}: {
  icon: React.ReactNode
  label: string
  value: string | null
  status: VerificationStatus
}) {
  const empty = !value || value.trim() === '' || status === 'not-found'
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-slate-500">{icon}</span>
        <span className="text-[11px] uppercase tracking-wide text-slate-600">{label}</span>
        <span className={cn('truncate text-base', empty ? 'italic text-slate-400' : 'text-slate-900')}>
          {empty ? (status === 'not-found' ? 'Checked, not found' : 'Not on file') : value}
        </span>
      </div>
      <StatusBadge status={status} />
    </div>
  )
}

/**
 * A person's minimal contact card: one email and the single preferred phone
 * (personal OR work), each with its own field-level status. Only the person's
 * OWN details, never borrowed.
 */
export function PersonContact({ person }: { person: Person }) {
  const c = person.contact
  const pref = preferredPhoneField(c)
  const prefIsWork = c.preferredPhone === 'work'
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <ContactLine icon={<Mail className="size-3.5" aria-hidden />} label="Email"
        value={c.email.value} status={c.email.status} />
      <ContactLine
        icon={prefIsWork ? <Briefcase className="size-3.5" aria-hidden /> : <Phone className="size-3.5" aria-hidden />}
        label={prefIsWork ? 'Work phone, preferred' : 'Personal phone, preferred'}
        value={pref.value} status={pref.status}
      />
    </div>
  )
}

/**
 * Who handles routine communication, with their own contact details. When a
 * linked person handles it, that is stated plainly. The customer's own fields
 * are never overwritten with the linked person's.
 *
 * When the routine contact IS the customer, their email and phone already
 * appear in Contact Facts, so we do not repeat them in a separate detail card:
 * the line simply confirms the customer is the routine contact. When the
 * routine contact is a DIFFERENT linked person, their own contact details are
 * operationally meaningful and are shown in full.
 *
 * EDITABLE mode (`editable`): wherever a worker can set or change the routine
 * contact, we ALWAYS show the current routine contact (even when it is the
 * customer themselves) alongside a clear Change action. Routine contact is a
 * durable workflow concept and must stay changeable, e.g. routing routine
 * communication to a linked spouse. Changing it never overwrites the
 * customer's own email or phone, never changes policy ownership, and never
 * changes required signers; routine communication and required-signature
 * responsibility stay separate (see RequiredSigners).
 */
export function RoutineContact({
  item, routinePerson, editable, onChange,
}: {
  item: WorkItem
  routinePerson: Person | null
  /** Show the always-visible current contact plus a Change action. */
  editable?: boolean
  /** Invoked when the worker chooses to change the routine contact. */
  onChange?: () => void
}) {
  const linked = item.communication?.mode === 'linked'
  const isCustomer = !!routinePerson && routinePerson.id === item.id
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Routine contact</p>
        {editable && (
          <Button
            variant="ghost"
            size="xs"
            className="-mr-1 h-6 shrink-0 text-slate-500 hover:text-slate-800"
            onClick={() => (onChange ? onChange() : console.log('[prototype] change routine contact', item.id))}
          >
            <Pencil className="size-3.5" aria-hidden />
            Change
          </Button>
        )}
      </div>
      {routinePerson ? (
        <>
          {/* Explicit relationship language, e.g. "Routine contact: Jo Sample
              (spouse)". The routine contact is who we communicate with; it is a
              separate concept from who must sign (see Required signers). */}
          <p className="text-base text-slate-900">
            <span className="font-medium">Routine contact:</span> {personName(routinePerson)}
            {isCustomer ? (
              <span className="ml-1 text-xs text-slate-600">{'\u2014'} the customer (see Contact facts)</span>
            ) : (
              <>
                {routinePerson.relationship && (
                  <span className="text-slate-700"> ({routinePerson.relationship.toLowerCase()})</span>
                )}
                {linked && (
                  <span className="ml-1 text-xs text-slate-600">{'\u2014'} communication handled on the customer{'\u2019'}s behalf</span>
                )}
              </>
            )}
          </p>
          {/* A different linked person needs their own contact card. When the
              routine contact is the customer, Contact facts already carries the
              same email and phone, so we do not restate it here in either mode:
              editable mode adds the Change action, not a repeat of Contact
              facts, so the customer's own email/phone is never duplicated. */}
          {!isCustomer && <PersonContact person={routinePerson} />}
        </>
      ) : (
        <p className="text-sm italic text-slate-400">No routine-contact person resolved.</p>
      )}
    </section>
  )
}

/**
 * Required signers. Driven by the request's required signers, independent of
 * who handles routine contact. A signer without a usable email is flagged in
 * red with an icon and text, never by borrowing another person's email.
 */
export function RequiredSigners({ signers }: { signers: Person[] }) {
  return (
    <section className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">
        Required signers
        {signers.length > 1 && <span className="ml-1 normal-case text-slate-600">(all must sign)</span>}
      </p>
      <div className="space-y-2">
        {signers.map(s => {
          const emailOk = hasUsableEmail(s.contact)
          return (
            <div key={s.id} className={cn(
              'rounded-lg border p-3',
              emailOk ? 'border-slate-200 bg-white' : 'border-rose-200 bg-rose-50',
            )}>
              <div className="flex items-center gap-2">
                <PenLine className="size-4 text-slate-500" aria-hidden />
                <span className="text-base text-slate-900">
                  <span className="font-medium">Required signer:</span> {personName(s)}
                </span>
                {s.relationship && <span className="text-xs text-slate-600">({s.relationship.toLowerCase()})</span>}
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-3 pl-5">
                {emailOk ? (
                  <span className="flex items-center gap-1.5 text-base text-slate-900">
                    <Mail className="size-4 text-slate-500" aria-hidden /> {s.contact.email.value}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-base font-medium text-rose-700">
                    <CircleAlert className="size-4" aria-hidden /> No usable email, cannot e-sign
                  </span>
                )}
                {emailOk && <StatusBadge status={s.contact.email.status} />}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Script block + View full customer escape hatch
// ─────────────────────────────────────────────────────────────────────────────

export function ScriptBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">{label}</p>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-base leading-relaxed text-slate-800">
        {text}
      </div>
    </div>
  )
}

/**
 * A small escape hatch to the existing customer page. In the prototype it is a
 * no-op. It does NOT reproduce the customer page, Fact Finder, or application
 * questions. It only points at them.
 */
export function ViewFullCustomer({ item }: { item: WorkItem }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-slate-500 hover:text-slate-800"
      onClick={() => console.log('[prototype] View full customer', item.id)}
    >
      <ExternalLink className="size-3.5" aria-hidden />
      View full customer
    </Button>
  )
}
