---
inclusion: auto
name: Right Path workflow visual rules
description: Visual-prominence and reusable-component rules for Right Path workflow UI (queues, task views, assistant, and other operator-facing workflow screens).
---

# Right Path workflow visual rules

These rules govern operator-facing workflow UI: the queue boards, queue lists,
task screens, and the Assistant. They are a design standard about clarity,
prominence, and reuse, not about workflow logic. Tailwind and shadcn are the
implementation tools underneath this standard, not a replacement for it.

## The shared design system is the default for all UI

Right Path has one design system: the design tokens in
`src/app/globals.css` and the shared workflow components in
`src/components/workflow/`. Build new pages and workflows on top of it by
default. This is how the UI stays consistent and how a single visual change
reaches every screen at once; it is not an extra process, review gate, or
separate system to maintain.

In practice this means:

- Compose screens from the shared components (`WorkflowSurface`, `WorkflowPage`,
  `TaskShell`, `QueueSection`, `OperationalTag`, and the rest below) and the
  standard layouts they provide. A new page should inherit the look by using
  them, not by re-deriving it.
- Use the design tokens for color, typography, surface, and spacing rather than
  hardcoding raw Tailwind palette values. The tokens carry the meaning
  (`bg-brand`, `text-ink`/`text-ink-secondary`/`text-ink-supporting`/
  `text-ink-muted`, `bg-workflow-surface`, `bg-surface-card`,
  `border-surface-border`, the `status-*` and `tag-*` tones, `font-workflow`).
  Reach for a literal shade like `bg-teal-600` or `text-slate-700` only when no
  token expresses what you mean.
- Make changes to shared visual elements at the token or shared-component level,
  so they propagate everywhere. Do not fork the look with page-specific styling
  or local overrides that drift from the shared layer. If the shared teal, the
  text-contrast tiers, a card surface, or a status tone needs to change, change
  the token or the component once.
- Page-specific styling is allowed only for a genuinely unique requirement that
  no shared token or component covers. When you do it, keep it local to that one
  screen and prefer the tokens even there; a recurring need is a signal to lift
  it into the shared layer, not to copy it.
- Extend an existing shared component (a new `OperationalTag` tone, a new prop)
  rather than creating a near-duplicate. Duplicates are what let the look drift.

Storybook is the living reference for this system and must stay aligned with the
actual shared components and tokens. `Workflow Design System/Design Tokens`
(`src/components/workflow/DesignTokens.stories.tsx`) catalogs the tokens and
`Workflow Design System/Text Contrast`
(`src/components/workflow/TextContrast.stories.tsx`) shows the contrast ladder.
When you add or change a shared component or token, update its story in the same
change so the reference keeps matching the code.

## Clarity: every task screen answers three questions

Every task screen must make three things immediately obvious, without the worker
having to inspect the whole screen:

1. What am I doing? (a clear action heading)
2. Why am I doing it? (the reason, shown prominently)
3. What happens next? (the resulting next state)

Lead with the action. One task screen, one obvious primary action.

Task layout is action-first from the LEFT: a full-width customer header on top,
then the current action in the left column and the supporting customer context
(identity, routine contact, required signers, holdings) in the right column.
The worker should never scan across the page to find the next action. This is
the shape of the shared `TaskShell` (`action` left, `context` right).

## Primary emphasis is Right Path teal, never black

Primary actions and queue emphasis use the Right Path muted teal, not the
near-black shadcn default. The shared `PrimaryAction` already applies the teal
treatment, and queue counts use a substantial teal count treatment. Do not
restyle these per screen, and do not reach for the near-black `bg-primary`
default for workflow emphasis.

## Operational information must look important

Operational information must be visually prominent when it changes what the
worker should do. This includes:

- work reasons (why an item is in a queue right now)
- required actions
- exceptions and corrections
- contact failures and follow-up reasons
- contact status that changes the worker's action
- anything the worker needs to understand or perform the task

Render these with strong contrast: dark high-contrast text or a solid tinted
fill, bold weight, and enough size that the value reads at a glance. Never bury
this behind pale gray or a thin low-contrast outline.

## Reserve muted gray for incidental content

Use muted/low-contrast gray ONLY for:

- truly incidental information
- disabled states
- unavailable controls
- technical detail the worker does not need to act on

Never mute work reasons, required actions, exceptions, contact failures,
follow-up reasons, or any other information that changes what the worker should
do. When in doubt, make it readable.

## Operational information defaults to high contrast

Right Path defaults to dark, readable text. A worker should never have to squint
to understand the task.

Operational information defaults to high contrast. Low-contrast gray is reserved
for disabled, unavailable, or genuinely incidental information.

If removing or overlooking a piece of information could cause the worker to
perform the task incorrectly, that information must not be muted.

Apply this contrast hierarchy (Tailwind slate underneath, but the hierarchy is
the standard, not the token):

- Primary task text: very dark, slate-900 equivalent. Task headings, directives,
  and the values the worker acts on (policy numbers, product names, amounts).
- Secondary operational text: clearly readable dark slate, roughly slate-700.
  Supporting operational detail such as relationships, prepared-message preview
  copy, and routine-contact lines.
- Supporting operational text: still clearly readable, roughly slate-600. Field
  labels, section labels, supporting phrases, and "what happens next" notes.
- Pale gray (slate-400 and lighter): only for disabled controls, unavailable or
  empty information ("Not on file"), or truly incidental metadata.

Use dark shades to create hierarchy, not low contrast. Keep hierarchy by varying
weight and darkness among readable tiers; do not fade task-relevant information
toward the background to make it feel secondary. Do not render every item at
identical weight either.

The approved dark-text hierarchy is demonstrated in the shared Storybook
reference (`Workflow Design System/Text Contrast`,
`src/components/workflow/TextContrast.stories.tsx`). Treat that story as the
visual reference for future workflow components, and apply the correction
through the shared workflow component layer (`src/components/workflow/`, and the
1035 shared parts) rather than restyling individual screens.

## Do not add redundant labels

When the meaning is already obvious, do not add an explanatory prefix or label.
Show the value itself ("No email", "Email bounced", "Callback due"), not
"WHY CALL: No email". The value is the signal.

## Status cues carry a compact key

Green / amber / red field-status cues are not self-explanatory on their own, so
the customer/task header carries a compact inline key: green = customer
verified, amber = Allstate record / known but not customer-confirmed, red =
missing or unusable. Keep it concise and inline (the shared `VerificationKey`),
never a large legend panel.

## Routine contact and required signer are distinct

Routine contact (who we communicate with) and required signer (who must sign)
are separate concepts. Use explicit language: "Routine contact: Jo Sample
(spouse)" and "Required signer: Sam Sample". Never use vague wording like
"Handled by Jo Sample", and never borrow one person's email or phone and
present it as another person's. When a required signer has no usable contact
method, show that gap plainly rather than hiding or inventing a resolution; the
worker needs to see what is missing and what must happen next.

## Scale and density

- Favor generous typography, spacing, and click targets over information density.
- Scrolling is acceptable. Do not shrink the UI merely to fit more above the fold.
- Workflow screens are task surfaces, not comprehensive customer records. Show
  only what the current task needs, with a small escape hatch to the full record.

## Visual language

- Light neutral background, dark slate text by default. Operational text defaults
  to high contrast (see "Operational information defaults to high contrast").
- Muted teal primary accent.
- Accessible status colors, and never color alone: pair tone with an icon or text.
- Modern sans-serif typography (no serif in workflow UI).
- Desktop-first working width, roughly 1280-1400px. Task screens use a
  context-left / action-right two-column layout that stacks on narrow screens.

## Reuse the shared workflow component layer

Where a visual treatment recurs across screens, use the shared workflow
components rather than restyling per screen. The durable layer lives in
`src/components/workflow/` (exported from its `index.ts`):

- `WorkflowSurface` — the outer page surface (workflow background, font, and
  base text), so a page inherits the look without re-declaring it.
- `WorkflowPage` / `WorkflowHeader` — centered page body shell and prominent
  page heading. `WorkflowPage` renders on `WorkflowSurface`.
- `QueueSection` — grouped queue section with a label.
- `QueueRow` — a compact queue-board row (icon, label, count).
- `CustomerQueueCard` — one-line customer card in an opened queue list.
- `QueueListHeader` / `QueueEmptyState` — opened-queue heading and empty state.
- `OperationalTag` — prominent reason/status/exception tag (tones: reason,
  exception, blocked, info).
- `ContextHeader` — customer/task identity + field-status header, with a
  built-in compact `VerificationKey`.
- `FieldStatusDot` — field-level verification/status treatment (icon + text).
- `TaskShell` — desktop task layout with context left and action right.
- `ActionPanel` / `ContextLabel` — the action-first panel with a large action
  heading, and the small uppercase column label.
- `PrimaryAction` — the single unmistakable primary action button.
- `WorkflowButton` — a secondary workflow action / selectable control that still
  carries the brand treatment (not the near-black shadcn default).
- `NextNote` — the "what happens next" line.
- `ExternalActionConfirm` — launch an external action, then confirm completion
  (launching is never completion).
- `SlimTaskHeader` / `AssistantPanel` — the minimal task-screen top row and the
  Assistant briefing shell.

Extend an existing component (for example, add an `OperationalTag` tone) rather
than re-implementing its look on a new screen. Do not replace Tailwind or
shadcn; build these components on top of them. Keep this list and the Storybook
stories in step with the actual exports as the shared layer evolves.
