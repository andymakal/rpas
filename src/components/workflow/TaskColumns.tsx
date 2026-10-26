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
 * How the height is derived (durable, offset-free):
 *   The internal shell scrolls inside a `<main>` whose height is the viewport
 *   (its ancestor is fixed inset:0). Everything above this row — the surface
 *   gutter, the Back link, the WorkflowHeader, and any client-specific chrome —
 *   is ordinary flow of varying height per screen, so a hardcoded "100vh minus N"
 *   is always a guess. Instead we MEASURE this row's own distance from the top of
 *   the viewport (`getBoundingClientRect().top`) and set its height to the rest
 *   of the viewport below that point. The heading therefore stays exactly where
 *   it is and visible, and the row claims precisely the remaining space. The
 *   measurement re-runs on resize and when the row's content/position changes
 *   (ResizeObserver on the row and its offset parent), so it tracks reality
 *   rather than assuming it.
 *
 *   Desktop only: the fill + per-column scroll apply at the `xl` breakpoint,
 *   where the layout is three columns. Below `xl` the columns stack and the
 *   height is left to normal flow, so small screens keep ordinary page
 *   scrolling. The height is applied via inline style ONLY when active, so the
 *   responsive (stacked) layout is never constrained.
 *
 *   A column taller than the available height scrolls within its own bounds; a
 *   shorter column simply sits at the top of its full-height track (stationary,
 *   nothing to scroll). The outer page never grows, so the heading never scrolls
 *   away.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** The Tailwind `xl` breakpoint (px). The fill behavior is desktop-only; below
 * this width the columns stack and scroll with the page. */
const XL_BREAKPOINT = 1280

/** The nearest scrollable ancestor is the real height authority (the internal
 * shell's `<main>`). Walking to it lets the row fit the ACTUAL scroll viewport,
 * including any gutter/padding below the row, with nothing guessed. */
function nearestScrollParent(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el.parentElement
  while (node) {
    const oy = getComputedStyle(node).overflowY
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node
    node = node.parentElement
  }
  return document.scrollingElement as HTMLElement
}

export function TaskColumns({
  action,
  context,
  history,
}: {
  action: ReactNode
  context: ReactNode
  history: ReactNode
}) {
  const rowRef = useRef<HTMLDivElement | null>(null)
  // The measured fill height in px, or null when inactive (below xl / not yet
  // measured) so the stacked responsive layout keeps its natural height.
  const [fillHeight, setFillHeight] = useState<number | null>(null)

  const measure = useCallback(() => {
    const el = rowRef.current
    if (!el) return
    // Desktop only. Below xl the columns stack; leave the height to normal flow
    // so small screens scroll the page as usual.
    if (window.innerWidth < XL_BREAKPOINT) {
      setFillHeight(prev => (prev === null ? prev : null))
      return
    }
    // Fit the row to the ACTUAL scroll viewport, every term measured from live
    // geometry (no guessed offsets):
    //   visibleBottom = the bottom of the scroller's visible content area, in
    //       viewport coordinates = scRect.top + clientHeight. (clientHeight is
    //       the padding-box inner height; <main> has no border.)
    //   belowRow      = content that sits BELOW this row in the same scroll flow
    //       (e.g. the WorkflowSurface bottom gutter). It is INDEPENDENT of the
    //       row's own height, so it is a stable amount to reserve. In viewport
    //       coordinates the end of all scrollable content is
    //       (scRect.top - scrollTop + scrollHeight); subtract the row's current
    //       bottom to get what trails beneath it.
    // The row should fill from its top down to (visibleBottom - belowRow), so
    // the row plus its trailing gutter exactly fill the viewport and the page
    // never grows past it.
    const scroller = nearestScrollParent(el)
    const rowRect = el.getBoundingClientRect()
    const scRect = scroller.getBoundingClientRect()
    const visibleBottom = scRect.top + scroller.clientHeight
    const contentEnd = scRect.top - scroller.scrollTop + scroller.scrollHeight
    const belowRow = Math.max(0, contentEnd - rowRect.bottom)
    const next = Math.max(0, Math.round(visibleBottom - rowRect.top - belowRow))
    setFillHeight(prev => (prev === next ? prev : next))
  }, [])

  useEffect(() => {
    measure()
    // Re-measure on viewport resize (width may cross the breakpoint; height may
    // change the available space).
    window.addEventListener('resize', measure)
    // Re-measure when layout above the row shifts its position or when the row's
    // own size changes (content growing/shrinking as the workflow advances).
    const ro = new ResizeObserver(() => measure())
    if (rowRef.current) ro.observe(rowRef.current)
    if (rowRef.current?.offsetParent instanceof Element) ro.observe(rowRef.current.offsetParent)
    // document.body catches chrome above the row changing height (e.g. the
    // heading wrapping) that would move the row's top.
    ro.observe(document.body)
    return () => {
      window.removeEventListener('resize', measure)
      ro.disconnect()
    }
  }, [measure])

  const active = fillHeight !== null

  return (
    <div
      ref={rowRef}
      className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))] xl:items-start"
      style={active ? { height: `${fillHeight}px` } : undefined}
    >
      <div className={cn('space-y-5', active && 'xl:h-full xl:min-h-0 xl:overflow-y-auto xl:pr-1')}>{action}</div>
      <div className={cn('space-y-5', active && 'xl:h-full xl:min-h-0 xl:overflow-y-auto xl:pr-1')}>{context}</div>
      <div className={cn('space-y-5', active && 'xl:h-full xl:min-h-0 xl:overflow-y-auto xl:pr-1')}>{history}</div>
    </div>
  )
}
