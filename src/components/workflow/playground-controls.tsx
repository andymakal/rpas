'use client'

/**
 * Reusable Storybook design-playground convention for Right Path's shared
 * workflow components.
 *
 * This module is the ONE place the "design playground" pattern lives, so each
 * shared component's playground is assembly rather than reinvention. It gives:
 *
 *   1. Control FACTORIES that produce Storybook `argTypes` entries with a
 *      consistent look (grouped categories, labelled radios, ranged sliders,
 *      color pickers). A new component playground declares its args and maps
 *      each to one factory call — no bespoke control wiring.
 *   2. A `CopyDesignButton` that renders a "Copy Selected Design" action inside
 *      the playground itself (no separate story), capturing all current choices
 *      as readable plain text to paste into ChatGPT for permanent application.
 *   3. A `PlaygroundStage` surface wrapper so every playground centers its live
 *      component identically.
 *
 * It reuses established Storybook capabilities (native Args/Controls) and Right
 * Path tokens/components only. It is NOT a second styling system or a custom
 * visual editor: it only produces standard Storybook `argTypes` and a copy
 * button. The live preview is always the REAL component driven by its own
 * `appearance` prop.
 */

import { useRef, useState, type ReactNode } from 'react'
import type { ArgTypes } from '@storybook/react'
import { WorkflowSurface } from './index'

// ── Control factories ─────────────────────────────────────────────────────────
//
// Each returns a single Storybook argType. Pass a `name` (the human label shown
// in the Controls panel) and a `category` (the collapsible group). Grouping by
// category is the convention that keeps a large panel navigable the same way
// across components.

type ArgType = ArgTypes[string]

/** A boolean show/hide switch. Convention for every "Visibility" control. */
export function toggleControl(name: string, category = 'Visibility'): ArgType {
  return { name, control: { type: 'boolean' }, table: { category } }
}

/** A status-color vs plain-black switch. Convention for recolorable tokens that
 * must be able to differ from status (status token color vs true black). */
export function statusOrBlackControl(name: string, category = 'Colors'): ArgType {
  return {
    name,
    control: { type: 'inline-radio' },
    options: ['status', 'black'],
    table: { category },
  }
}

/** A proportional size slider (as a multiplier). Convention for all typography
 * and icon scaling, so every size knob reads in the same 60%–180% range. */
export function scaleControl(name: string, category = 'Typography', opts?: { min?: number; max?: number; step?: number }): ArgType {
  return {
    name,
    control: { type: 'range', min: opts?.min ?? 0.6, max: opts?.max ?? 1.8, step: opts?.step ?? 0.05 },
    table: { category },
  }
}

/** A pixel slider for an absolute size (icon override, border width, radius,
 * padding, spacing). */
export function pxControl(name: string, category: string, opts?: { min?: number; max?: number; step?: number }): ArgType {
  return {
    name,
    control: { type: 'range', min: opts?.min ?? 0, max: opts?.max ?? 48, step: opts?.step ?? 1 },
    table: { category },
  }
}

/** A font-weight selector. Convention for per-role weight. */
export function weightControl(name: string, category = 'Typography'): ArgType {
  return {
    name,
    control: { type: 'select' },
    options: ['default', 'normal', 'medium', 'semibold', 'bold'],
    table: { category },
  }
}

/** A free color picker (any CSS color). Used for per-role text / chrome colors. */
export function colorControl(name: string, category: string): ArgType {
  return { name, control: { type: 'color' }, table: { category } }
}

/** A labelled single-choice selector. Convention for layout arrangements and
 * other enumerated choices. */
export function choiceControl<T extends string>(
  name: string,
  options: readonly T[],
  labels: Record<T, string>,
  category: string,
): ArgType {
  return {
    name,
    control: { type: 'inline-radio' },
    options: options as unknown as string[],
    labels,
    table: { category },
  }
}

/** A free-text control (e.g. a font-family stack). */
export function textControl(name: string, category: string): ArgType {
  return { name, control: { type: 'text' }, table: { category } }
}

/** A date picker control (native Storybook `date` control, surfaced as a
 * YYYY-MM-DD string arg). Convention for date-only values such as a promised
 * callback date. */
export function dateControl(name: string, category: string): ArgType {
  return { name, control: { type: 'date' }, table: { category } }
}

/** Hide a required prop from the Controls panel (set by `render`). */
export const hiddenControl: ArgType = { table: { disable: true } }

// ── Copy Selected Design ───────────────────────────────────────────────────────

/**
 * A labelled line in the copyable design summary. The convention: group the
 * summary by the same categories as the Controls panel so what Bob copies maps
 * one-to-one to what he adjusted.
 */
export interface DesignLine {
  label: string
  value: string
}
export interface DesignGroup {
  title: string
  lines: DesignLine[]
}

/** Render a readable, paste-friendly plain-text summary from grouped lines,
 * optionally followed by a code block (e.g. the exact `appearance` prop). */
export function formatDesignSummary(
  heading: string,
  groups: DesignGroup[],
  codeBlock?: string,
): string {
  const pad = Math.max(
    0,
    ...groups.flatMap((g) => g.lines.map((l) => l.label.length)),
  )
  const out: string[] = [heading, '']
  for (const g of groups) {
    out.push(g.title)
    for (const l of g.lines) {
      out.push(`  ${l.label.padEnd(pad)}  ${l.value}`)
    }
    out.push('')
  }
  if (codeBlock) {
    out.push('Apply via the component\u2019s appearance prop:', codeBlock)
  }
  return out.join('\n').trimEnd() + '\n'
}

/**
 * The in-playground "Copy Selected Design" action. Renders a compact button plus
 * an on-demand preview of the exact text it copies, so the current appearance
 * and layout choices can be captured without leaving the playground.
 */
export function CopyDesignButton({ summary, className }: { summary: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const [showText, setShowText] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary)
    } catch {
      taRef.current?.select()
      try { document.execCommand?.('copy') } catch { /* ignore */ }
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={copy}
          className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700"
        >
          {copied ? 'Copied' : 'Copy Selected Design'}
        </button>
        <button
          type="button"
          onClick={() => setShowText((v) => !v)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {showText ? 'Hide text' : 'Preview text'}
        </button>
      </div>
      {showText && (
        <textarea
          ref={taRef}
          readOnly
          value={summary}
          rows={16}
          className="mt-2 w-full rounded-md border border-slate-300 bg-slate-50 p-2 font-mono text-xs leading-relaxed text-slate-700"
        />
      )}
    </div>
  )
}

// ── Stage ──────────────────────────────────────────────────────────────────────

/**
 * The shared playground surface: the Right Path light WorkflowSurface, a
 * floating Copy action pinned top-right, and the live component centered in a
 * readable column. Every component playground renders through this so they all
 * look and behave the same.
 */
export function PlaygroundStage({
  copyText,
  children,
}: {
  copyText: string
  children: ReactNode
}) {
  return (
    <WorkflowSurface className="min-h-screen">
      <div className="relative min-h-screen">
        <div className="pointer-events-none sticky top-0 z-10 flex justify-end p-4">
          <div className="pointer-events-auto rounded-xl border border-slate-200 bg-white/90 p-2 shadow-sm backdrop-blur">
            <CopyDesignButton summary={copyText} />
          </div>
        </div>
        <div className="flex items-start justify-center px-6 pb-10">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </div>
    </WorkflowSurface>
  )
}
