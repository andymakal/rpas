import type { Meta, StoryObj } from '@storybook/react'
import {
  CalendarDays, Mail, Phone, ShieldCheck, Database, CircleAlert, FileText,
} from 'lucide-react'

import {
  WorkflowPage,
  ContextLabel,
  ActionPanel,
  OperationalTag,
  FieldStatusDot,
  NextNote,
} from './index'

/**
 * Workflow Design System — Text contrast hierarchy.
 *
 * THE visual reference for text contrast across every Right Path workflow
 * surface (queues, task screens, Customer Context, the Assistant). Operational
 * information defaults to HIGH CONTRAST. Pale gray is reserved for disabled,
 * unavailable, or genuinely incidental content.
 *
 * The approved tiers, mapped to Tailwind slate:
 *
 *   - Primary task text        -> text-slate-900   (headings, values, directives)
 *   - Secondary operational    -> text-slate-700   (clearly readable dark slate)
 *   - Supporting operational   -> text-slate-600   (labels, supporting phrases)
 *   - Muted / incidental ONLY  -> text-slate-400   (disabled, empty, unavailable)
 *
 * Rule of thumb: if removing or overlooking a piece of information could cause
 * the worker to perform the task incorrectly, it must NOT be muted.
 *
 * STORYBOOK-ONLY. No data, APIs, or production workflow logic.
 */
const meta = {
  title: 'Workflow Design System/Text Contrast',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function Tier({
  swatch, name, token, use, children,
}: {
  swatch: string
  name: string
  token: string
  use: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-4">
      <span className={`mt-1 size-6 shrink-0 rounded-md ${swatch}`} aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="text-base font-semibold text-slate-900">{name}</span>
          <span className="font-mono text-xs text-slate-600">{token}</span>
        </p>
        <p className="text-sm text-slate-600">{use}</p>
        <div className="pt-1">{children}</div>
      </div>
    </div>
  )
}

/**
 * The four approved tiers side by side. This is the canonical contrast ladder:
 * three readable operational tiers, and pale gray reserved for incidental.
 */
export const ContrastHierarchy: Story = {
  render: () => (
    <WorkflowPage>
      <div className="space-y-4">
        <ContextLabel>Approved text contrast hierarchy</ContextLabel>

        <Tier
          swatch="bg-slate-900"
          name="Primary task text"
          token="text-slate-900"
          use="Task headings, directives, and the values the worker acts on. The darkest, most prominent tier."
        >
          <p className="text-lg font-semibold text-slate-900">Attach the servicing-agent form for:</p>
          <p className="font-mono text-base text-slate-900">POL-4471190 {'\u00b7'} POL-5582204</p>
        </Tier>

        <Tier
          swatch="bg-slate-700"
          name="Secondary operational text"
          token="text-slate-700"
          use="Clearly readable dark slate for operational detail that supports the primary action: relationships, preview copy, routine-contact lines."
        >
          <p className="text-base text-slate-700">
            Routine contact: Jo Sample (spouse)
          </p>
        </Tier>

        <Tier
          swatch="bg-slate-600"
          name="Supporting operational text"
          token="text-slate-600"
          use="Still clearly readable. Field labels, section labels, supporting phrases, and 'what happens next' notes."
        >
          <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Date of birth</p>
          <NextNote>Email sent moves this customer to Waiting for Response.</NextNote>
        </Tier>

        <Tier
          swatch="bg-slate-400"
          name="Muted / incidental ONLY"
          token="text-slate-400"
          use="Reserved for disabled controls, unavailable information, and genuinely incidental metadata. Never for anything needed to perform the task."
        >
          <p className="text-base italic text-slate-400">Not on file</p>
        </Tier>
      </div>
    </WorkflowPage>
  ),
}

/**
 * The same hierarchy as it reads in a real Customer Context block: dark values
 * with readable supporting labels, status cues paired with text, and only the
 * genuinely empty field muted.
 */
export const CustomerContextExample: Story = {
  render: () => (
    <WorkflowPage>
      <div className="max-w-md space-y-3">
        <ContextLabel>Customer context</ContextLabel>
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Contact facts</p>

          <ContextFact
            icon={<CalendarDays className="size-3.5" aria-hidden />}
            label="Date of birth"
            value="March 14, 1958"
            tone="confirmed"
            statusIcon={ShieldCheck}
            statusLabel="Customer verified"
          />
          <ContextFact
            icon={<Mail className="size-3.5" aria-hidden />}
            label="Email"
            value="jo.sample@example.com"
            tone="known"
            statusIcon={Database}
            statusLabel="Allstate record"
          />
          <ContextFact
            icon={<Phone className="size-3.5" aria-hidden />}
            label="Personal phone"
            value="Checked, not found"
            empty
            tone="missing"
            statusIcon={CircleAlert}
            statusLabel="Missing or unusable"
          />
        </section>
      </div>
    </WorkflowPage>
  ),
}

function ContextFact({
  icon, label, value, empty, tone, statusIcon, statusLabel,
}: {
  icon: React.ReactNode
  label: string
  value: string
  empty?: boolean
  tone: 'confirmed' | 'known' | 'missing'
  statusIcon: React.ComponentType<{ className?: string }>
  statusLabel: string
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        {/* Operational label: supporting tier, high-contrast slate-600. */}
        <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-600">
          <span className="text-slate-600">{icon}</span>
          {label}
        </p>
        {/* Value: primary tier slate-900, UNLESS genuinely empty -> muted. */}
        <p className={empty ? 'text-base italic text-slate-400' : 'text-base text-slate-900'}>{value}</p>
      </div>
      <FieldStatusDot tone={tone} icon={statusIcon} label={statusLabel} />
    </div>
  )
}

/**
 * The Ready to Email attachment directive — critical operational information.
 * It must read as important: a dark heading, dark policy numbers, and readable
 * product names. Never pale gray.
 */
export const CriticalDirectiveExample: Story = {
  render: () => (
    <WorkflowPage>
      <div className="max-w-lg space-y-4">
        <ActionPanel heading="Email Jo Sample">
          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <FileText className="size-4 text-slate-600" aria-hidden />
              Attach the servicing-agent form for:
            </p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-base text-slate-900">
                <span className="font-mono">POL-4471190</span>
                <span className="text-sm text-slate-600">Whole life</span>
              </div>
              <div className="flex items-center gap-2 text-base text-slate-900">
                <span className="font-mono">POL-5582204</span>
                <span className="text-sm text-slate-600">Fixed annuity</span>
              </div>
            </div>
          </div>

          <OperationalTag tone="reason">Email on file</OperationalTag>
        </ActionPanel>
      </div>
    </WorkflowPage>
  ),
}
