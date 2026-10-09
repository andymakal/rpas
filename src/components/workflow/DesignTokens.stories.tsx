import type { Meta, StoryObj } from '@storybook/react'

import { WorkflowSurface, WorkflowHeader, ContextLabel, PrimaryAction, WorkflowButton, OperationalTag } from './index'
import { ArrowRight } from 'lucide-react'

/**
 * Workflow Design System — Design Tokens.
 *
 * THE single visual reference for the consolidated Right Path workflow tokens.
 * Every value shown here is driven by a design token defined once in
 * globals.css, so these swatches render exactly what new workflow surfaces
 * inherit. See .kiro/steering/workflow-visual-rules.md for the standard.
 *
 * Tokens → Tailwind utilities:
 *   --brand            → bg-brand / text-brand / border-brand   (teal-600)
 *   --brand-hover      → bg-brand-hover                         (teal-700)
 *   --brand-subtle     → bg-brand-subtle                        (teal-100)
 *   --workflow-surface → bg-workflow-surface                    (slate-50)
 *   --text-primary     → text-ink                               (slate-900)
 *   --text-secondary   → text-ink-secondary                     (slate-700)
 *   --text-supporting  → text-ink-supporting                    (slate-600)
 *   --text-muted       → text-ink-muted                         (slate-400)
 *   --font-workflow    → font-workflow                          (sans stack)
 *
 * STORYBOOK-ONLY. No data, APIs, or production workflow logic.
 */
const meta = {
  title: 'Workflow Design System/Design Tokens',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function Swatch({ cls, name, token, note }: { cls: string; name: string; token: string; note?: string }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4">
      <span className={`size-12 shrink-0 rounded-lg border border-black/5 ${cls}`} aria-hidden />
      <div className="min-w-0">
        <p className="text-base font-semibold text-ink">{name}</p>
        <p className="font-mono text-xs text-ink-supporting">{token}</p>
        {note && <p className="text-sm text-ink-supporting">{note}</p>}
      </div>
    </div>
  )
}

/** The complete token catalog as it renders through the shared surface. */
export const Tokens: Story = {
  render: () => (
    <WorkflowSurface>
      <div className="mx-auto w-full max-w-[1360px] space-y-10">
        <WorkflowHeader primary="Right Path Design Tokens" secondary="the shared visual foundation" />

        <section className="space-y-4">
          <ContextLabel>Brand accent (muted teal)</ContextLabel>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Swatch cls="bg-brand" name="Brand" token="--brand / bg-brand" note="Primary workflow emphasis. teal-600." />
            <Swatch cls="bg-brand-hover" name="Brand hover" token="--brand-hover / bg-brand-hover" note="Hover/active. teal-700." />
            <Swatch cls="bg-brand-subtle" name="Brand subtle" token="--brand-subtle / bg-brand-subtle" note="Tinted fill. teal-100." />
          </div>
        </section>

        <section className="space-y-4">
          <ContextLabel>Surface</ContextLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            <Swatch cls="bg-workflow-surface" name="Workflow surface" token="--workflow-surface / bg-workflow-surface" note="Light neutral page background. slate-50." />
            <Swatch cls="bg-white" name="Card / panel" token="bg-white" note="Panels and cards sit above the surface." />
          </div>
        </section>

        <section className="space-y-4">
          <ContextLabel>Operational text contrast ladder</ContextLabel>
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-lg font-semibold text-ink">text-ink — primary task text (slate-900)</p>
            <p className="text-base text-ink-secondary">text-ink-secondary — secondary operational text (slate-700)</p>
            <p className="text-base text-ink-supporting">text-ink-supporting — labels &amp; supporting phrases (slate-600)</p>
            <p className="text-base italic text-ink-muted">text-ink-muted — incidental / unavailable only (slate-400)</p>
          </div>
        </section>

        <section className="space-y-4">
          <ContextLabel>Typography</ContextLabel>
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 font-workflow">
            <p className="text-ink-supporting text-sm">font-workflow — modern sans-serif, no serif in workflow UI.</p>
            <p className="text-4xl font-semibold tracking-tight text-ink">Heading 4xl semibold</p>
            <p className="text-2xl font-semibold text-ink">Heading 2xl semibold</p>
            <p className="text-lg text-ink-secondary">Body large</p>
            <p className="text-base text-ink-secondary">Body base</p>
            <p className="font-mono text-base text-ink">POL-4471190 (mono for identifiers)</p>
          </div>
        </section>

        <section className="space-y-4">
          <ContextLabel>Emphasis components (token-driven)</ContextLabel>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
              <PrimaryAction icon={ArrowRight} label="Primary action" />
              <div className="flex flex-wrap gap-2">
                <WorkflowButton selected>Selected</WorkflowButton>
                <WorkflowButton>Unselected</WorkflowButton>
              </div>
            </div>
            <div className="flex flex-wrap items-start gap-2 rounded-xl border border-slate-200 bg-white p-5">
              <OperationalTag tone="reason">Reason</OperationalTag>
              <OperationalTag tone="exception">Exception</OperationalTag>
              <OperationalTag tone="blocked">Blocked</OperationalTag>
              <OperationalTag tone="info">Info</OperationalTag>
            </div>
          </div>
        </section>
      </div>
    </WorkflowSurface>
  ),
}
