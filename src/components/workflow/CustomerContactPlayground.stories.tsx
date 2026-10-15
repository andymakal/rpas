import type { Meta, StoryObj } from '@storybook/react'
import { useMemo, useRef, useState } from 'react'

import { WorkflowSurface } from './index'
import { MentoringProvider } from '@/lib/mentoring/MentoringProvider'
import {
  CustomerContactCard,
  type CustomerContact,
  type ContactPersistPayload,
  type ContactCardAppearance,
  type ColorChoice,
} from './CustomerContactCard'

/**
 * Workflow Design System — Customer Contact → Design Playground.
 *
 * An interactive appearance lab for the REAL shared `CustomerContactCard`. It
 * renders the actual production component (no copy, no fork) and tunes its look
 * through the component's own `appearance` prop, driven by Storybook's native
 * Args/Controls. Move a slider or flip a switch in the Controls panel and the
 * real card re-renders immediately — no rebuild, redeploy, or Kiro involvement.
 *
 * Nothing here changes the component's production defaults, its source, or any
 * customer record. The card runs on an in-memory `onPersist` (identical rules
 * to the functional Customer Contact stories), so editing and verifying stay
 * fully interactive and completely side-effect free. The `appearance` prop is
 * presentation-only; omitting it (as every production call site does) yields
 * the exact current look.
 *
 * CONTROLS (native Storybook Controls panel):
 *   - Three INDEPENDENT color switches — status indicator, contact icon, field
 *     label — each either the field's status color (green/amber/red) or black.
 *   - Font-size sliders — a master scale for all card text, plus independent
 *     nudges for the customer name, field labels, contact values, and
 *     buttons/verification labels.
 *   - Contact status selector — show the card Verified (green), On file not
 *     verified (amber), or Missing (red).
 *
 * The "Compare 8 Color Combinations" story shows every on/off mix of the three
 * color switches side by side. The "Share Selected Settings" story turns the
 * current controls into a copyable plain-text summary to hand to ChatGPT for a
 * permanent implementation.
 */

// ── Sample records (one per contact-status choice) ───────────────────────────

const baseRecord: Omit<
  CustomerContact,
  'email_verified_at' | 'phone_verified_at' | 'address_verified_at'
> = {
  id: 'playground-customer',
  first_name: 'Jordan',
  last_name: 'Rivera',
  email: 'jordan.rivera@example.com',
  phone: '(215) 555-0142',
  street: '1420 Chestnut St',
  address_line1: null,
  city: 'Philadelphia',
  state: 'PA',
  zip: '19102',
}

type ContactStatus = 'verified' | 'onfile' | 'missing'

const VERIFIED_AT = '2026-10-10T15:00:00.000Z'

/** Build a sample record for the chosen contact status. `verified` → all three
 * fields green; `onfile` → all present but unverified (amber); `missing` → all
 * values cleared (red). */
function recordForStatus(status: ContactStatus): CustomerContact {
  if (status === 'missing') {
    return {
      ...baseRecord,
      email: null, phone: null, street: null, city: null, state: null, zip: null,
      email_verified_at: null, phone_verified_at: null, address_verified_at: null,
    }
  }
  const stamp = status === 'verified' ? VERIFIED_AT : null
  return {
    ...baseRecord,
    email_verified_at: stamp,
    phone_verified_at: stamp,
    address_verified_at: stamp,
  }
}

// ── Story args ───────────────────────────────────────────────────────────────

/** Flat args, each mapped to a native Storybook control, then assembled into
 * the real component's `appearance` prop by `render`. */
interface PlaygroundArgs {
  contactStatus: ContactStatus
  statusIndicatorColor: ColorChoice
  contactIconColor: ColorChoice
  fieldLabelColor: ColorChoice
  fontScale: number
  nameScale: number
  labelScale: number
  valueScale: number
  controlScale: number
}

/** Defaults mirror the production component exactly (status/status/black, all
 * scales 1), so the playground opens on the real current appearance. */
const DEFAULT_ARGS: PlaygroundArgs = {
  contactStatus: 'onfile',
  statusIndicatorColor: 'status',
  contactIconColor: 'status',
  fieldLabelColor: 'black',
  fontScale: 1,
  nameScale: 1,
  labelScale: 1,
  valueScale: 1,
  controlScale: 1,
}

function appearanceFromArgs(a: PlaygroundArgs): ContactCardAppearance {
  return {
    statusIndicatorColor: a.statusIndicatorColor,
    contactIconColor: a.contactIconColor,
    fieldLabelColor: a.fieldLabelColor,
    fontScale: a.fontScale,
    nameScale: a.nameScale,
    labelScale: a.labelScale,
    valueScale: a.valueScale,
    controlScale: a.controlScale,
  }
}

// ── In-memory persistence (identical rules to the functional stories) ─────────

function makeInteractivePersist(
  record: CustomerContact,
  setRecord: (c: CustomerContact) => void,
) {
  return async (_id: string, payload: ContactPersistPayload): Promise<CustomerContact> => {
    const now = new Date().toISOString()
    let next = record
    if ('verified' in payload) {
      const col =
        payload.field === 'email' ? 'email_verified_at'
        : payload.field === 'phone' ? 'phone_verified_at'
        : 'address_verified_at'
      next = { ...record, [col]: payload.verified ? now : null }
    } else if (payload.field === 'email') {
      const changed = (payload.email ?? null) !== (record.email ?? null)
      next = { ...record, email: payload.email, email_verified_at: changed ? null : record.email_verified_at }
    } else if (payload.field === 'phone') {
      const changed = (payload.phone ?? null) !== (record.phone ?? null)
      next = { ...record, phone: payload.phone, phone_verified_at: changed ? null : record.phone_verified_at }
    } else {
      next = {
        ...record,
        street: payload.street, city: payload.city, state: payload.state, zip: payload.zip,
        address_verified_at: null,
      }
    }
    setRecord(next)
    return next
  }
}

/** The REAL card wired to in-memory persistence, driven by the given appearance.
 * `key` on the caller resets the in-memory record when the contact-status arg
 * changes, so flipping status reloads the matching sample. */
function LiveCard({
  initial,
  appearance,
}: {
  initial: CustomerContact
  appearance: ContactCardAppearance
}) {
  const [record, setRecord] = useState<CustomerContact>(initial)
  const onPersist = useMemo(() => makeInteractivePersist(record, setRecord), [record])
  return <CustomerContactCard customer={record} onPersist={onPersist} appearance={appearance} />
}

// ── Shared argTypes (the native Controls panel) ──────────────────────────────

const COLOR_CONTROL = {
  control: { type: 'inline-radio' as const },
  options: ['status', 'black'] as ColorChoice[],
  labels: { status: 'Status color', black: 'Black' },
}

const SCALE_CONTROL = {
  control: { type: 'range' as const, min: 0.6, max: 1.8, step: 0.05 },
}

const sharedArgTypes = {
  contactStatus: {
    name: 'Contact status',
    control: { type: 'inline-radio' as const },
    options: ['verified', 'onfile', 'missing'] as ContactStatus[],
    labels: {
      verified: 'Verified (green)',
      onfile: 'On file, not verified (amber)',
      missing: 'Missing (red)',
    },
    table: { category: 'Contact status' },
  },
  statusIndicatorColor: { name: 'Status indicator', ...COLOR_CONTROL, table: { category: 'Colors' } },
  contactIconColor: { name: 'Contact icon', ...COLOR_CONTROL, table: { category: 'Colors' } },
  fieldLabelColor: { name: 'Field label', ...COLOR_CONTROL, table: { category: 'Colors' } },
  fontScale: { name: 'All text (master)', ...SCALE_CONTROL, table: { category: 'Font size' } },
  nameScale: { name: 'Customer name', ...SCALE_CONTROL, table: { category: 'Font size' } },
  labelScale: { name: 'Field labels', ...SCALE_CONTROL, table: { category: 'Font size' } },
  valueScale: { name: 'Contact values', ...SCALE_CONTROL, table: { category: 'Font size' } },
  controlScale: { name: 'Buttons / verify', ...SCALE_CONTROL, table: { category: 'Font size' } },
  // The required prop is set by `render`; hide it from the Controls panel so the
  // panel shows only the design knobs.
  customer: { table: { disable: true } },
}

// ── Meta ─────────────────────────────────────────────────────────────────────

const meta = {
  title: 'Workflow Design System/Customer Contact/Design Playground',
  component: CustomerContactCard,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Interactive appearance lab for the real shared CustomerContactCard. Use the Controls panel to flip the three color switches, move the font-size sliders, and pick a contact status; the real card updates immediately. Nothing here changes the component defaults or any data.',
      },
    },
  },
} satisfies Meta<typeof CustomerContactCard>

export default meta
type Story = StoryObj<PlaygroundArgs>

// ── Playground (native Args/Controls) ────────────────────────────────────────

/**
 * Live playground. Open the Controls panel (bottom/side) and adjust the color
 * switches, font-size sliders, and contact status. Each change re-renders the
 * REAL card instantly. The card itself stays interactive — edit a value or tick
 * Verified and the in-memory record updates, exactly like the app, with no data
 * written anywhere.
 */
export const Playground: Story = {
  args: DEFAULT_ARGS,
  argTypes: sharedArgTypes,
  render: (args) => {
    const appearance = appearanceFromArgs(args)
    const initial = recordForStatus(args.contactStatus)
    return (
      <WorkflowSurface className="min-h-screen">
        <MentoringProvider>
          <div className="flex min-h-screen items-start justify-center p-6">
            <div className="w-full max-w-md">
              {/* Keyed by contact status so switching the status arg reloads the
                  matching sample record into the card's in-memory state. */}
              <LiveCard key={args.contactStatus} initial={initial} appearance={appearance} />
            </div>
          </div>
        </MentoringProvider>
      </WorkflowSurface>
    )
  },
}

// ── Compare 8 color combinations ─────────────────────────────────────────────

/**
 * All eight combinations of the three color switches side by side (status
 * indicator × contact icon × field label, each Status color or Black). Font
 * sizes and contact status come from the Controls panel and apply to every
 * tile, so the comparison isolates color while still letting you resize or
 * switch status across the whole grid. Each tile is its own REAL card instance.
 */
export const CompareColorCombinations: Story = {
  name: 'Compare 8 Color Combinations',
  args: { ...DEFAULT_ARGS, contactStatus: 'onfile' },
  argTypes: {
    ...sharedArgTypes,
    // The three color switches are enumerated by the grid itself; hide them.
    statusIndicatorColor: { table: { disable: true } },
    contactIconColor: { table: { disable: true } },
    fieldLabelColor: { table: { disable: true } },
  },
  render: (args) => {
    const choices: ColorChoice[] = ['status', 'black']
    const combos: Array<Pick<PlaygroundArgs, 'statusIndicatorColor' | 'contactIconColor' | 'fieldLabelColor'>> = []
    for (const si of choices)
      for (const ci of choices)
        for (const fl of choices)
          combos.push({ statusIndicatorColor: si, contactIconColor: ci, fieldLabelColor: fl })

    const short = (c: ColorChoice) => (c === 'status' ? 'Status' : 'Black')
    const initial = recordForStatus(args.contactStatus)

    return (
      <WorkflowSurface className="min-h-screen">
        <MentoringProvider>
          <div className="p-6">
            <h2 className="text-lg font-semibold text-slate-900">Compare 8 color combinations</h2>
            <p className="mt-1 text-sm text-slate-500">
              Status indicator / Contact icon / Field label — every on-off mix. Font size and
              contact status follow the Controls panel. The same real card in every tile.
            </p>
            <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {combos.map((combo, i) => {
                const appearance = appearanceFromArgs({ ...args, ...combo })
                return (
                  <div key={i} className="space-y-2">
                    <div className="flex flex-wrap gap-1 text-xs">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                        Indicator: {short(combo.statusIndicatorColor)}
                      </span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                        Icon: {short(combo.contactIconColor)}
                      </span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                        Label: {short(combo.fieldLabelColor)}
                      </span>
                    </div>
                    <LiveCard key={`${i}-${args.contactStatus}`} initial={initial} appearance={appearance} />
                  </div>
                )
              })}
            </div>
          </div>
        </MentoringProvider>
      </WorkflowSurface>
    )
  },
}

// ── Share selected settings ──────────────────────────────────────────────────

/** Human-readable + copyable summary of the current settings. */
function describeSettings(a: PlaygroundArgs): string {
  const color = (c: ColorChoice) => (c === 'status' ? 'Status color' : 'Black')
  const pct = (n: number) => `${Math.round(n * 100)}%`
  const status =
    a.contactStatus === 'verified' ? 'Verified (green)'
    : a.contactStatus === 'onfile' ? 'On file, not verified (amber)'
    : 'Missing (red)'
  return [
    'Customer Contact Card — selected design settings',
    '',
    `Contact status shown:   ${status}`,
    '',
    `Status indicator color: ${color(a.statusIndicatorColor)}`,
    `Contact icon color:     ${color(a.contactIconColor)}`,
    `Field label color:      ${color(a.fieldLabelColor)}`,
    '',
    `Master font scale:  ${pct(a.fontScale)}`,
    `Customer name:      ${pct(a.nameScale)}`,
    `Field labels:       ${pct(a.labelScale)}`,
    `Contact values:     ${pct(a.valueScale)}`,
    `Buttons / verify:   ${pct(a.controlScale)}`,
    '',
    'Font-size baselines (px) these percentages scale:',
    '  Customer name 22, Field labels 16, Contact values 18, Buttons/verify 16.',
    '',
    'Applies to the shared CustomerContactCard via its appearance prop:',
    `  appearance={{ statusIndicatorColor: '${a.statusIndicatorColor}', contactIconColor: '${a.contactIconColor}',`,
    `    fieldLabelColor: '${a.fieldLabelColor}', fontScale: ${a.fontScale}, nameScale: ${a.nameScale},`,
    `    labelScale: ${a.labelScale}, valueScale: ${a.valueScale}, controlScale: ${a.controlScale} }}`,
  ].join('\n')
}

/**
 * Tune everything in the Controls panel, then copy the generated settings
 * summary to hand back for a permanent implementation. The card on the right
 * reflects the current controls live; the summary text is plain and
 * paste-friendly (it even includes the exact `appearance` prop to apply).
 */
export const ShareSelectedSettings: Story = {
  name: 'Share Selected Settings',
  args: DEFAULT_ARGS,
  argTypes: sharedArgTypes,
  render: (args) => {
    const appearance = appearanceFromArgs(args)
    const initial = recordForStatus(args.contactStatus)
    const summary = describeSettings(args)
    return <SharePanel summary={summary} initial={initial} appearance={appearance} contactStatusKey={args.contactStatus} />
  },
}

function SharePanel({
  summary, initial, appearance, contactStatusKey,
}: {
  summary: string
  initial: CustomerContact
  appearance: ContactCardAppearance
  contactStatusKey: string
}) {
  const [copied, setCopied] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary)
    } catch {
      taRef.current?.select()
      document.execCommand?.('copy')
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <WorkflowSurface className="min-h-screen">
      <MentoringProvider>
        <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[24rem_1fr]">
          <aside className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Selected settings</h2>
              <p className="mt-1 text-sm text-slate-500">
                Adjust the Controls panel; this summary updates live. Copy it and send it to
                ChatGPT to make the look permanent.
              </p>
            </div>
            <textarea
              ref={taRef}
              readOnly
              value={summary}
              rows={18}
              className="w-full rounded-md border border-slate-300 bg-slate-50 p-2 font-mono text-xs text-slate-700"
            />
            <button
              type="button"
              onClick={copy}
              className="w-full rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700"
            >
              {copied ? 'Copied' : 'Copy settings'}
            </button>
          </aside>

          <div className="flex items-start justify-center">
            <div className="w-full max-w-md">
              <LiveCard key={contactStatusKey} initial={initial} appearance={appearance} />
            </div>
          </div>
        </div>
      </MentoringProvider>
    </WorkflowSurface>
  )
}
