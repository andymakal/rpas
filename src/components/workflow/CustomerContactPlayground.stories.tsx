import type { Meta, StoryObj } from '@storybook/react'
import { useMemo, useRef, useState } from 'react'

import { WorkflowSurface } from './index'
import { MentoringProvider } from '@/lib/mentoring/MentoringProvider'
import {
  CustomerContactCard,
  type CustomerContact,
  type ContactPersistPayload,
} from './CustomerContactCard'

/**
 * Workflow Design System — Customer Contact → Design Playground.
 *
 * An interactive appearance lab for the REAL shared `CustomerContactCard`. It
 * renders the actual production component (no copy, no fork) and drives its
 * look from the OUTSIDE with scoped CSS. Nothing here changes the component's
 * source, its production defaults, customer records, or business data — the
 * card still runs on an in-memory `onPersist`, exactly like the functional
 * Customer Contact stories, so editing/verifying stay side-effect free.
 *
 * What you can tune, live, with no rebuild:
 *   - Three INDEPENDENT color controls — status indicator, contact icon, and
 *     field label — each either the field's status color (green/amber/red) or
 *     black.
 *   - A master font-size scale that grows/shrinks ALL card text together, plus
 *     independent nudges for the customer name, field labels, contact values,
 *     and buttons/verification labels.
 *
 * The "Compare 8 Color Combinations" story shows every on/off mix of the three
 * color controls side by side. The "Share Selected Settings" story turns the
 * current controls into a copyable summary you can hand back to apply to the
 * real component later.
 *
 * HOW THE OVERRIDE WORKS (so it stays honest about using the real component):
 * the real card renders each field heading as
 *   <p class="… text-ink"> <StatusIcon role="img"/> <ContactIcon aria-hidden/> label </p>
 * Icons inherit `currentColor`, so scoped CSS on `.cc-pg` can recolor the first
 * SVG (status indicator), the following SVG (contact icon), and the heading
 * text (field label) independently. Font sizes are scaled by multiplying the
 * exact Tailwind size utilities the card already uses. "Status color" means we
 * leave the component's own token color alone; "Black" means we override it.
 */

const base: CustomerContact = {
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
  // One of each status so all three status colors are visible at once:
  // email verified (green), phone on-file (amber), address missing (red).
  email_verified_at: '2026-10-10T15:00:00.000Z',
  phone_verified_at: null,
  address_verified_at: null,
}

const missingAddress: CustomerContact = {
  ...base,
  street: null,
  city: null,
  state: null,
  zip: null,
}

// ── Appearance model ─────────────────────────────────────────────────────────

type ColorChoice = 'status' | 'black'

interface Appearance {
  statusIndicatorColor: ColorChoice
  contactIconColor: ColorChoice
  fieldLabelColor: ColorChoice
  fontScale: number // master multiplier
  nameScale: number
  labelScale: number
  valueScale: number
  controlScale: number // buttons + verification labels
}

const DEFAULT_APPEARANCE: Appearance = {
  statusIndicatorColor: 'status',
  contactIconColor: 'status',
  fieldLabelColor: 'black',
  fontScale: 1,
  nameScale: 1,
  labelScale: 1,
  valueScale: 1,
  controlScale: 1,
}

/**
 * Build the scoped CSS that drives the real card. Everything is confined to the
 * `.cc-pg` scope passed in, so it cannot leak to other stories or the app.
 *
 * Colors: only emit a rule when the choice is "black"; "status" is the absence
 * of an override, so the component's own status token wins.
 *
 * Sizes: the card uses a fixed set of Tailwind utilities. We recompute each as
 * (base px * master * group) so the slider moves everything together while the
 * per-group nudges fine-tune a single text role. Values are the Tailwind
 * defaults (text-sm 14, text-base 16, text-lg 18, the name's text-[22px]).
 */
function buildScopedCss(scope: string, a: Appearance): string {
  const rules: string[] = []
  const px = (base: number, group: number) => `${(base * a.fontScale * group).toFixed(3)}px`

  // Field label = the heading <p> text. The two icons sit inside it, so we set
  // the label color on the <p> and then let the icon rules below win for the
  // SVGs via higher specificity.
  if (a.fieldLabelColor === 'black') {
    rules.push(`${scope} section > div.divide-y > div > div:first-child > p { color: #000; }`)
  }

  // Status indicator = the first SVG in the heading (role="img", carries the
  // accessible status label). Contact icon = the SVG marked aria-hidden that
  // follows it. Target each precisely so they move independently.
  if (a.statusIndicatorColor === 'black') {
    rules.push(`${scope} section > div.divide-y > div > div:first-child > p > svg[role="img"] { color: #000; }`)
  }
  if (a.contactIconColor === 'black') {
    rules.push(`${scope} section > div.divide-y > div > div:first-child > p > svg[aria-hidden="true"] { color: #000; }`)
  }

  // ── Font sizes ──
  // Customer name (text-[22px]).
  rules.push(`${scope} section > h3 { font-size: ${px(22, a.nameScale)}; }`)
  // Field labels (section heading <p>, text-base) and the small address
  // sub-labels / status key (text-sm).
  rules.push(`${scope} section > div.divide-y > div > div:first-child > p { font-size: ${px(16, a.labelScale)}; }`)
  rules.push(`${scope} .text-sm { font-size: ${px(14, a.labelScale)}; }`)
  // Contact values (text-lg).
  rules.push(`${scope} .text-lg { font-size: ${px(18, a.valueScale)}; }`)
  // Buttons + verification labels (text-base elsewhere: Edit/Save/Cancel,
  // Verified). Applied broadly to text-base then the heading label rule above
  // re-sizes the label with its own group, so labels and controls stay
  // independently adjustable.
  rules.push(`${scope} button, ${scope} label { font-size: ${px(16, a.controlScale)}; }`)

  return rules.join('\n')
}

/** Human-readable + copyable summary of the current appearance. */
function describeAppearance(a: Appearance): string {
  const color = (c: ColorChoice) => (c === 'status' ? 'Status color' : 'Black')
  const pct = (n: number) => `${Math.round(n * 100)}%`
  return [
    'Customer Contact — selected appearance',
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
  ].join('\n')
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

/** The real card, wired to in-memory persistence, inside a uniquely-scoped
 * wrapper so the playground CSS applies to just this instance. */
function ScopedCard({
  scopeId,
  initial = base,
}: {
  scopeId: string
  initial?: CustomerContact
}) {
  const [record, setRecord] = useState<CustomerContact>(initial)
  const onPersist = useMemo(() => makeInteractivePersist(record, setRecord), [record])
  return (
    <div className={scopeId}>
      <CustomerContactCard customer={record} onPersist={onPersist} />
    </div>
  )
}

// ── Control UI ────────────────────────────────────────────────────────────────

function ColorToggle({
  label, value, onChange,
}: {
  label: string
  value: ColorChoice
  onChange: (v: ColorChoice) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
        {(['status', 'black'] as ColorChoice[]).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={
              'px-3 py-1 text-sm font-medium ' +
              (value === opt ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')
            }
          >
            {opt === 'status' ? 'Status color' : 'Black'}
          </button>
        ))}
      </div>
    </div>
  )
}

function SizeSlider({
  label, value, onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="range"
          min={0.6}
          max={1.8}
          step={0.05}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-40 accent-teal-600"
        />
        <span className="w-12 text-right text-sm tabular-nums text-slate-600">
          {Math.round(value * 100)}%
        </span>
      </span>
    </label>
  )
}

// ── Stories ────────────────────────────────────────────────────────────────────

const meta = {
  title: 'Workflow Design System/Customer Contact/Design Playground',
  component: CustomerContactCard,
  args: { customer: base },
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'An interactive appearance lab for the real shared CustomerContactCard. Experiment with status/icon/label colors and font sizes; nothing here changes the component defaults or any data.',
      },
    },
  },
} satisfies Meta<typeof CustomerContactCard>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Live playground: adjust colors and font sizes on the left and watch the real
 * card on the right update immediately. The settings panel is Storybook-only;
 * the card is the production component.
 */
export const Playground: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [a, setA] = useState<Appearance>(DEFAULT_APPEARANCE)
    const scopeId = 'cc-pg-live'
    const css = buildScopedCss(`.${scopeId}`, a)

    return (
      <WorkflowSurface className="min-h-screen">
        <MentoringProvider>
          <style>{css}</style>
          <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[22rem_1fr]">
            {/* Controls (Storybook-only) */}
            <aside className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Appearance controls</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Experimental. Affects this preview only — not the component defaults or any data.
                </p>
              </div>

              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Colors</h3>
                <ColorToggle
                  label="Status indicator"
                  value={a.statusIndicatorColor}
                  onChange={(v) => setA((p) => ({ ...p, statusIndicatorColor: v }))}
                />
                <ColorToggle
                  label="Contact icon"
                  value={a.contactIconColor}
                  onChange={(v) => setA((p) => ({ ...p, contactIconColor: v }))}
                />
                <ColorToggle
                  label="Field label"
                  value={a.fieldLabelColor}
                  onChange={(v) => setA((p) => ({ ...p, fieldLabelColor: v }))}
                />
              </div>

              <div className="space-y-3 border-t border-slate-200 pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Font size</h3>
                <SizeSlider label="All text (master)" value={a.fontScale} onChange={(v) => setA((p) => ({ ...p, fontScale: v }))} />
                <SizeSlider label="Customer name" value={a.nameScale} onChange={(v) => setA((p) => ({ ...p, nameScale: v }))} />
                <SizeSlider label="Field labels" value={a.labelScale} onChange={(v) => setA((p) => ({ ...p, labelScale: v }))} />
                <SizeSlider label="Contact values" value={a.valueScale} onChange={(v) => setA((p) => ({ ...p, valueScale: v }))} />
                <SizeSlider label="Buttons / verify" value={a.controlScale} onChange={(v) => setA((p) => ({ ...p, controlScale: v }))} />
              </div>

              <button
                type="button"
                onClick={() => setA(DEFAULT_APPEARANCE)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Reset to component defaults
              </button>
            </aside>

            {/* The real component */}
            <div className="flex justify-center">
              <div className="w-full max-w-md">
                <ScopedCard scopeId={scopeId} />
              </div>
            </div>
          </div>
        </MentoringProvider>
      </WorkflowSurface>
    )
  },
}

/**
 * All eight combinations of the three color controls side by side (status
 * indicator × contact icon × field label, each Status color or Black). Font
 * sizes are left at the component default so the comparison isolates color.
 * Each tile renders its own real card instance under its own scope.
 */
export const CompareColorCombinations: Story = {
  name: 'Compare 8 Color Combinations',
  render: () => {
    const choices: ColorChoice[] = ['status', 'black']
    const combos: Appearance[] = []
    for (const si of choices)
      for (const ci of choices)
        for (const fl of choices)
          combos.push({
            ...DEFAULT_APPEARANCE,
            statusIndicatorColor: si,
            contactIconColor: ci,
            fieldLabelColor: fl,
          })

    const short = (c: ColorChoice) => (c === 'status' ? 'Status' : 'Black')

    return (
      <WorkflowSurface className="min-h-screen">
        <MentoringProvider>
          <div className="p-6">
            <h2 className="text-lg font-semibold text-slate-900">Compare 8 color combinations</h2>
            <p className="mt-1 text-sm text-slate-500">
              Status indicator / Contact icon / Field label. The same real card in every tile.
            </p>
            <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {combos.map((combo, i) => {
                const scopeId = `cc-pg-combo-${i}`
                return (
                  <div key={scopeId} className="space-y-2">
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
                    <style>{buildScopedCss(`.${scopeId}`, combo)}</style>
                    <ScopedCard scopeId={scopeId} />
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

/**
 * Tune the appearance, then copy the settings summary to hand back for applying
 * to the real component. The preview on the right reflects the current
 * settings; the summary text is plain and paste-friendly.
 */
export const ShareSelectedSettings: Story = {
  name: 'Share Selected Settings',
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [a, setA] = useState<Appearance>({ ...DEFAULT_APPEARANCE, fieldLabelColor: 'black' })
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [copied, setCopied] = useState(false)
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const taRef = useRef<HTMLTextAreaElement>(null)
    const scopeId = 'cc-pg-share'
    const summary = describeAppearance(a)

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
          <style>{buildScopedCss(`.${scopeId}`, a)}</style>
          <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[22rem_1fr]">
            <aside className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Colors</h3>
                <ColorToggle label="Status indicator" value={a.statusIndicatorColor} onChange={(v) => setA((p) => ({ ...p, statusIndicatorColor: v }))} />
                <ColorToggle label="Contact icon" value={a.contactIconColor} onChange={(v) => setA((p) => ({ ...p, contactIconColor: v }))} />
                <ColorToggle label="Field label" value={a.fieldLabelColor} onChange={(v) => setA((p) => ({ ...p, fieldLabelColor: v }))} />
              </div>
              <div className="space-y-3 border-t border-slate-200 pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Font size</h3>
                <SizeSlider label="All text (master)" value={a.fontScale} onChange={(v) => setA((p) => ({ ...p, fontScale: v }))} />
                <SizeSlider label="Customer name" value={a.nameScale} onChange={(v) => setA((p) => ({ ...p, nameScale: v }))} />
                <SizeSlider label="Field labels" value={a.labelScale} onChange={(v) => setA((p) => ({ ...p, labelScale: v }))} />
                <SizeSlider label="Contact values" value={a.valueScale} onChange={(v) => setA((p) => ({ ...p, valueScale: v }))} />
                <SizeSlider label="Buttons / verify" value={a.controlScale} onChange={(v) => setA((p) => ({ ...p, controlScale: v }))} />
              </div>

              <div className="space-y-2 border-t border-slate-200 pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected settings</h3>
                <textarea
                  ref={taRef}
                  readOnly
                  value={summary}
                  rows={12}
                  className="w-full rounded-md border border-slate-300 bg-slate-50 p-2 font-mono text-xs text-slate-700"
                />
                <button
                  type="button"
                  onClick={copy}
                  className="w-full rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700"
                >
                  {copied ? 'Copied' : 'Copy settings'}
                </button>
              </div>
            </aside>

            <div className="flex justify-center">
              <div className="w-full max-w-md">
                <ScopedCard scopeId={scopeId} initial={missingAddress} />
              </div>
            </div>
          </div>
        </MentoringProvider>
      </WorkflowSurface>
    )
  },
}
