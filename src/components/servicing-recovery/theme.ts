/**
 * Visual theme constants for the 1035 Workflow prototype. STORYBOOK-ONLY.
 *
 * These used to carry the prototype's own font stack and page background. Those
 * decisions are now consolidated into the shared Right Path design tokens
 * (globals.css: --font-workflow, --color-workflow-surface) and applied through
 * the shared `WorkflowSurface` wrapper, so every workflow surface inherits the
 * same look from one place.
 *
 * The exports below are kept as thin aliases over the token-backed Tailwind
 * utilities so existing references keep working. New code should prefer
 * `WorkflowSurface` (which applies all three: background, font, base text).
 */

/** Token-backed page background utility (was a raw slate-50 class). */
export const PAGE_BG = 'bg-workflow-surface'

/**
 * The workflow font is now a token (`--font-workflow`) applied via the
 * `font-workflow` utility and the shared `WorkflowSurface`. This empty inline
 * style is retained only so existing `style={prototypeFontStyle}` references
 * keep type-checking; it no longer sets the font itself.
 *
 * @deprecated Prefer `WorkflowSurface` or the `font-workflow` utility.
 */
export const prototypeFontStyle: Record<string, never> = {}
