'use client'

/**
 * Divider — the ONE divider for step/section boundaries.
 *
 * The visible-divider standard (2px weight + the `surface-border-section`
 * token, currently slate-500) lives HERE, in one place, so no screen hand-writes
 * `border-t-2 border-surface-border-section` and drifts. Change the look once in
 * this component (or the token) and every boundary follows. See
 * `.kiro/steering/workflow-visual-rules.md`.
 *
 * Two forms:
 *   - `<Divider />` — a single horizontal rule between two blocks.
 *   - `<DividerStack>...</DividerStack>` — wrap a set of sibling blocks to place
 *     the SAME standard rule between each (replaces a hand-written
 *     `divide-y-2 divide-surface-border-section`).
 *
 * Do not reach for a raw `border-*`/`divide-*` divider class for a step/section
 * boundary; use this so the boundary looks identical everywhere, in display and
 * edit alike.
 */

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Divider({ className }: { className?: string }) {
  return <hr className={cn('border-0 border-t-2 border-surface-border-section', className)} />
}

export function DividerStack({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('divide-y-2 divide-surface-border-section', className)}>
      {children}
    </div>
  )
}
