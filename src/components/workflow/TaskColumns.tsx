'use client'

/**
 * TaskColumns — the three-column working-screen row (work · context · history)
 * that fits the ACTUAL available space beneath the page heading and scrolls each
 * column independently, with no guessed viewport offset.
 *
 * Why this exists as its own client component: the layout primitives in
 * `primitives.tsx` are server components (many task/queue screens render them on
 * the server), so they cannot hold the layout effect this needs. `TaskShell`
 * stays a server component and delegates the three-column row to this client
 * child.
 *
 * Fit first, constrain only when needed (durable, offset-free):
 *   The internal shell scrolls inside a `<main>` whose height is the viewport
 *   (its ancestor is fixed inset:0). Everything above this row — the surface
 *   gutter, the WorkflowPageHeader, and any client-specific chrome —
 *   is ordinary flow of varying height per screen, so a hardcoded "100vh minus N"
 *   is always a guess. Instead we MEASURE this row's own distance from the top of
 *   the viewport and the real available space below it.
 *
 *   Crucially, the row is only CAPPED when it needs to be. We compare the tallest
 *   column's natural content height against the available space:
 *     - Everything fits: the columns keep their NATURAL height. No cap, no
 *       scrollbars, no empty space forced below them. The page does not scroll
 *       because the content genuinely fits.
 *     - A column would overflow: the row is capped to the available height and
 *       each column scrolls independently within its own bounds. A shorter
 *       column sits at the top of its full-height track (stationary); the taller
 *       one scrolls. The page never grows, so the heading stays visible.
 *
 *   The decision re-runs on window resize, browser/visual-viewport zoom, and any
 *   change to the row's position or a column's content (ResizeObserver), so it
 *   tracks reality and flips between natural and scrolling modes automatically.
 *
 *   Desktop only: this applies at the `xl` breakpoint, where the layout is three
 *   columns. Below `xl` the columns stack and the height is left to normal flow,
 *   so small screens keep ordinary page scrolling.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** The Tailwind `xl` breakpoint (px). The fill behavior is desktop-only; below
 * this width the columns stack and scroll with the page. */
const XL_BREAKPOINT = 1280

/** The nearest scroll-CAPABLE ancestor — one whose computed overflow-y is auto
 * or scroll — REGARDLESS of whether it currently overflows. This is the stable
 * scroll viewport (the page work area, or the internal shell's `<main>`). It is
 * deliberately NOT gated on "currently overflows": gating on overflow makes the
 * chosen scroller flip as the row caps/uncaps, which feeds the row's own height
 * back into the available-height measurement and traps it at the capped size. */
function nearestScrollParent(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el.parentElement
  while (node) {
    const oy = getComputedStyle(node).overflowY
    if (oy === 'auto' || oy === 'scroll') return node
    node = node.parentElement
  }
  return document.scrollingElement as HTMLElement
}

/** A small tolerance (px) so sub-pixel rounding never flips a column that
 * genuinely fits into the constrained/scrolling mode. */
const FIT_TOLERANCE = 2

/**
 * Named column-ratio presets for the three-column working screen. These are a
 * DESIGN-TIME tuning vocabulary: a page opts into a preset by name, and the
 * actual proportions live here in one place (not inline on each page) so the
 * whole set is visible at a glance and tuned once. The value is only the `xl`
 * three-column grid track; the one-column (narrow) and two-column (medium)
 * responsive fallbacks are unaffected, so stacking behavior never changes.
 *
 *   even          — equal thirds (1/1/1). The default; today's layout.
 *   wide-context  — 27/46/27, a wider CENTER for screens where the center
 *                   column (customer context) carries the weight and the left
 *                   action is mostly click-through.
 */
export type TaskColumnRatio = 'even' | 'wide-context'

const COLUMN_TEMPLATES: Record<TaskColumnRatio, string> = {
  even: 'repeat(3,minmax(0,1fr))',
  'wide-context': 'minmax(0,27fr) minmax(0,46fr) minmax(0,27fr)',
}

export function TaskColumns({
  action,
  context,
  history,
  columns = 'even',
}: {
  action: ReactNode
  context: ReactNode
  history: ReactNode
  /** Named column-ratio preset for the xl three-column track. Default 'even'
   * (equal thirds). See {@link TaskColumnRatio}. */
  columns?: TaskColumnRatio
}) {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const actionRef = useRef<HTMLDivElement | null>(null)
  const contextRef = useRef<HTMLDivElement | null>(null)
  const historyRef = useRef<HTMLDivElement | null>(null)
  // The measured fill height in px, or null when the columns should use their
  // NATURAL height (below xl, not yet measured, or content that already fits the
  // available space). A non-null value means the content exceeds the viewport,
  // so the row is capped to the available height and each column scrolls.
  const [fillHeight, setFillHeight] = useState<number | null>(null)
  // Whether the layout is at the xl (three-column) breakpoint. Driven by the
  // same measure() pass so it stays reactive to resize/zoom and SSR-safe (false
  // on the server; corrected on mount). The ratio preset only applies when true.
  const [isDesktop, setIsDesktop] = useState(false)

  const measure = useCallback(() => {
    const el = rowRef.current
    if (!el) return
    // Desktop only. Below xl the columns stack; leave the height to normal flow
    // so small screens scroll the page as usual.
    if (window.innerWidth < XL_BREAKPOINT) {
      setIsDesktop(prev => (prev === false ? prev : false))
      setFillHeight(prev => (prev === null ? prev : null))
      return
    }
    setIsDesktop(prev => (prev === true ? prev : true))
    // The ACTUAL available height below this row's top, measured purely from box
    // geometry of the scroll VIEWPORT — never from content-derived scrollHeight,
    // so the measurement does not collapse when the row is currently capped
    // (which would otherwise trap it at the capped size):
    //   innerBottom = the scroller's inner content-area bottom in viewport
    //       coordinates = scRect.top + clientHeight - paddingBottom. clientHeight
    //       is the padding-box inner height; subtracting the scroller's own
    //       bottom padding (the surface/work-area bottom gutter) leaves the point
    //       the row's content should reach so the page never grows past it.
    // available is then the span from the row's top to that inner bottom.
    const scroller = nearestScrollParent(el)
    const rowRect = el.getBoundingClientRect()
    const scRect = scroller.getBoundingClientRect()
    const scStyle = getComputedStyle(scroller)
    const scPadBottom = parseFloat(scStyle.paddingBottom) || 0
    const innerBottom = scRect.top + scroller.clientHeight - scPadBottom
    const available = Math.max(0, Math.round(innerBottom - rowRect.top))

    // The NATURAL content height of the tallest column. scrollHeight reports the
    // full content height whether or not the column is currently constrained, so
    // this comparison is stable across the fit/overflow transition. Only when a
    // column would genuinely overflow the available space do we constrain the
    // row and turn on per-column scrolling; when everything fits, the columns
    // keep their natural height and the row is left to flow (no cap, no unused
    // space below, no scrollbars).
    const tallest = Math.max(
      actionRef.current?.scrollHeight ?? 0,
      contextRef.current?.scrollHeight ?? 0,
      historyRef.current?.scrollHeight ?? 0,
    )
    const needsConstraint = tallest > available + FIT_TOLERANCE
    const next = needsConstraint ? available : null
    setFillHeight(prev => (prev === next ? prev : next))
  }, [])

  useEffect(() => {
    measure()
    // Re-measure on viewport resize AND browser zoom. Zoom changes the layout
    // viewport, which fires 'resize'; visualViewport 'resize'/'scroll' covers
    // pinch-zoom and mobile toolbars where the window event may not fire.
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('scroll', measure)
    // Re-measure when layout above the row shifts its position, when the row's
    // own size changes, or when a COLUMN's content grows/shrinks as the workflow
    // advances (so a screen that starts short and later grows past the viewport
    // switches into scrolling mode, and vice-versa).
    const ro = new ResizeObserver(() => measure())
    if (rowRef.current) ro.observe(rowRef.current)
    if (rowRef.current?.offsetParent instanceof Element) ro.observe(rowRef.current.offsetParent)
    if (actionRef.current) ro.observe(actionRef.current)
    if (contextRef.current) ro.observe(contextRef.current)
    if (historyRef.current) ro.observe(historyRef.current)
    // document.body catches chrome above the row changing height (e.g. the
    // heading wrapping) that would move the row's top.
    ro.observe(document.body)
    return () => {
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('scroll', measure)
      ro.disconnect()
    }
  }, [measure])

  const active = fillHeight !== null

  // The xl three-column TRACK is applied as a direct inline grid-template-columns
  // (not a Tailwind arbitrary class or a CSS variable), gated on the measured
  // desktop width. This is deliberate: a Tailwind `xl:grid-cols-[...]` arbitrary
  // value only works for values Tailwind can statically see at build time, and a
  // `var()`-based arbitrary value does not reliably resolve here. Applying the
  // template string straight to the element guarantees the named ratio takes
  // effect. Below xl we apply NO inline template, so the Tailwind
  // `grid-cols-1 lg:grid-cols-2` responsive fallbacks drive the stacked layout
  // exactly as before.
  const rowStyle: CSSProperties = {
    ...(isDesktop ? { gridTemplateColumns: COLUMN_TEMPLATES[columns] } : {}),
    ...(active ? { height: `${fillHeight}px` } : {}),
  }

  return (
    <div
      ref={rowRef}
      className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:items-start"
      style={rowStyle}
    >
      <div ref={actionRef} className={cn('space-y-5', active && 'xl:h-full xl:min-h-0 xl:overflow-y-auto xl:pr-1')}>{action}</div>
      <div ref={contextRef} className={cn('space-y-5', active && 'xl:h-full xl:min-h-0 xl:overflow-y-auto xl:pr-1')}>{context}</div>
      <div ref={historyRef} className={cn('space-y-5', active && 'xl:h-full xl:min-h-0 xl:overflow-y-auto xl:pr-1')}>{history}</div>
    </div>
  )
}
