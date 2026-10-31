# Handoff: contact-card "Lego" components (Name done; Email, Phone, DOB next)

Status date: 2026-10-31. Branch: `development`. All work below is live on the
preview `https://bobdev.therightpathagency.com` (development clone only; nothing
in production).

## What this effort is

We are turning the shared Customer Contact card's edit sections into a set of
self-contained, reusable "Lego" components. Each field group (Name, Email,
Phone, Date of birth, Mailing address) should be ONE shared component that owns
its own editing, validation, required indicators, error messages, formatting,
and display — so any screen that needs to edit/show that field calls the
component instead of re-implementing the logic. The host page supplies data and
a save handler; it owns no field logic of its own.

**Name is complete and is the reference pattern.** Build Email, Phone, and Date
of birth the same way. After each, verify and deploy to the development preview
only (never production), using the delivery workflow in AGENTS.md /
`.kiro/steering/delivery-workflow.md` (`vercel deploy` + alias `bobdev` +
`vercel inspect`).

## The Name pattern to copy (the reference Lego)

Rules/presentation module (pure, no React): `src/lib/person-name.ts`
- Types + presentation (familiar / greeting / full-recorded), the suffix
  dropdown model (`SUFFIX_OPTIONS`, `suffixSelectionFrom`,
  `resolveSuffixSelection`), and `validatePersonName` returning a structured
  result with a per-field error map. Normalization preserves caps/accents/
  multi-word names; nothing is inferred.

UI component: `src/components/workflow/PersonName.tsx` (exported from
`src/components/workflow/index.ts`):
- `PersonNameDisplay` — familiar name prominent; full recorded name beneath ONLY
  when it differs.
- `PersonNameFields` — headless of Save/Cancel: the controlled field rows +
  compact live preview. Designed to embed inside a larger coordinated form.
- `usePersonNameDraft` — shared draft state + validation hook backing the
  fields, so every host validates identically.
- `PersonNameEditor` — `PersonNameFields` wrapped with its own Save/Cancel for a
  standalone edit.

The split that made consolidation work: a pure rules module + a headless fields
component + a draft hook + a thin standalone editor. Reproduce this shape for
each new Lego (e.g. `src/lib/contact-email.ts` already has normalization in
`src/lib/contact-input.ts` — reuse it; add an `EmailFields`/`useEmailDraft` in a
new `src/components/workflow/ContactEmail.tsx`, etc.). Reuse the existing
normalizers in `src/lib/contact-input.ts` (`normalizeEmailInput`,
`normalizePhoneInput`, `formatPhoneDisplay`) and `src/lib/stewardship/dob.ts`
(`normalizeDobParts`, `wouldDowngradeExactDob`, `formatDobDisplay`,
`dobToParts`) rather than re-deriving.

How the card consumes a Lego (do the same for the next ones): the unified editor
in `src/components/workflow/CustomerContactCard.tsx` embeds the headless fields
via the draft hook (search for `usePersonNameDraft` / `PersonNameFields` and the
`buildChange` name section), keeps ONE coordinated Save/Cancel, save-only-
changed, and one history entry. The server enforces the same validation in
`src/app/api/customers/[id]/contact/route.ts` (the `field === 'contact'` and
per-field branches). History/preview shape lives in
`src/lib/stewardship/customer-history.ts` (`ContactSnapshot`, `diffContact`,
`describeContactUpdate`, `buildContactUpdateHistoryNote`).

Host owns no field logic: the Contact Research page
`src/app/(internal)/projects/[id]/ContactReviewClient.tsx` renders
`<CustomerContactCard customerId=.../>` and routes name DISPLAY through the
shared `familiarName` (no page-local `fullName`). Its data layer
`src/lib/projects/contact-review.ts` selects the field columns and folds the
saved record back into local rows. When you build Email/Phone/DOB, confirm no
page-local formatting remains for those either.

## Agreed visual conventions (apply to every Lego)

- Light-theme tokens only (`.kiro/steering` workflow visual rules). Teal brand
  for emphasis.
- Section heading: bold, high-contrast (`text-base font-bold text-ink`) with the
  section's lucide icon, so each section reads as its own Lego. (Name currently
  shows this; DOB/Email/Phone still use the older
  `font-semibold text-ink-secondary` heading — bring them to the bold style when
  you build them.)
- Entered text: `text-sm`, tight padding (`px-2.5 py-1`); labels `text-xs`.
  Smaller than the old `text-lg`/`py-2`. Keep it compact to save vertical space.
- Live preview: a light-TEAL bubble (`border-brand-ring bg-brand-subtle`,
  `text-brand-subtle-foreground` label) — "this is what you'll see."
- A reusable darker divider token exists for section separation:
  `--surface-border-section` (slate-400) → `divide-surface-border-section` /
  `border-surface-border-section`, catalogued in
  `src/components/workflow/DesignTokens.stories.tsx`. It is NOT yet applied
  card-wide. When the other sections become Legos, switch the editor's section
  divider to `divide-y-2 divide-surface-border-section` so every section stands
  out, and bold all four headings together.
- Add/refresh a Storybook story per component (keep the design system in step).
- Keep each component in `src/components/workflow/`, export from its `index.ts`.

## Parked for later (business/workflow decisions, NOT part of the Lego build)

1. Contact Research list/workflow simplification. Today the screen lands on the
   first customer and works one-at-a-time (Done & Next / Skip); there is NO
   "Back to the list" control (a stale comment says otherwise). The list
   scaffolding (`CustomerQueueCard` lists, Start/Continue, the "No Usable
   Contact Information" section) still renders only in the exhausted/empty state.
   Owner wants it simplified toward pure one-at-a-time research and the My Work
   launcher GRAYED OUT when the count is zero. This is a workflow change with a
   consequence (loses the on-screen roster of who we can't reach) — get explicit
   direction before removing lists.
2. Unreachable-customer mechanism. A customer with a policy number but NO usable
   email, phone, OR mailing address needs a disposition: push to another system,
   send back to the agency, or mark unreachable and remove from the project.
   No such mechanism exists today. Design is a separate effort.
3. Pre-existing lint warning in `ContactReviewClient.tsx`: `Cannot access refs
   during render` at the direct-open landing effect (`directOpenedRef.current`
   read during render). Predates this work; does not fail the build. Clean up
   when that screen is revisited.

## Verify-and-deploy checklist (each Lego)

- `npx tsc --noEmit`; `npm run build`; `npx eslint <changed files>` (only the
  pre-existing ref warning above is acceptable).
- Commit, push `development`, `vercel deploy --force --scope
  makal-financial-services-llc`, alias `bobdev.therightpathagency.com` to the new
  deployment, confirm with `vercel inspect`. Development preview only.
