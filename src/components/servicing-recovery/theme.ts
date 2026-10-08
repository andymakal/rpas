/**
 * Visual theme tokens for the 1035 Workflow prototype. STORYBOOK-ONLY.
 *
 * This prototype uses a clean modern sans-serif throughout and a muted-teal
 * accent, independent of the host app's theme. The font stack is applied via an
 * inline style on the prototype root so it does not depend on the Next.js font
 * CSS variables (which Storybook does not inject). Nothing here changes global
 * tokens or any shared UI primitive.
 */

import type { CSSProperties } from 'react'

/** A clean, modern sans-serif stack. No serif anywhere in this workflow. */
export const PROTOTYPE_FONT_STACK =
  '"Inter", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif'

/** Inline style for the prototype root, so every surface inherits the sans font. */
export const prototypeFontStyle: CSSProperties = {
  fontFamily: PROTOTYPE_FONT_STACK,
}

/** The calm page background shared by every prototype surface. */
export const PAGE_BG = 'bg-slate-50'
