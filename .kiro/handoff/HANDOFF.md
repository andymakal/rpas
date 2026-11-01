# Handoff: contact-card "Lego" components (ALL FIVE FIELD LEGOS DONE)

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

**Name is complete and is the reference pattern. Email is now also complete**
(`src/components/workflow/ContactEmail.tsx`: `EmailDisplay`, `EmailFields`,
`useEmailDraft`, `EmailEditor`; exported from `index.ts`; Storybook story
`ContactEmail.stories.tsx`; the unified editor in `CustomerContactCard.tsx` now
consumes it via `useEmailDraft`/`EmailFields`, no inline email logic remains).
The Email Lego reproduces the full prior behavior: a typed address vs the three
mutually-exclusive availability reasons (Missing / No Usable Email /
Undeliverable), Verified gated on a usable value, and availability resolving to
`available` on a usable save (the server derives that from a saved email).

**Phone is now also complete** (`src/components/workflow/ContactPhone.tsx`:
`PhoneDisplay`, `PhoneFields`, `usePhoneDraft`, `PhoneEditor`; exported from
`index.ts`; Storybook story `ContactPhone.stories.tsx`; the unified editor
consumes it via `usePhoneDraft`/`PhoneFields`, no inline phone/SMS logic
remains). Texting belongs to the phone, so the Phone Lego owns the number AND
its Text-message availability controls (Do Not Text + Text Undeliverable) plus
the Verified checkbox. It reproduces the full prior behavior: format-as-typed to
the `(XXX) XXX-XXXX` standard, invalid blocks save, Do Not Text togglable even
with no number and outranking Undeliverable, Text Undeliverable gated on a number
/ moot under Do Not Text / locked on for an unchanged already-failed number
(clears only by replacing the number), and Verified gated on a usable number. The
local `SmsAvailabilityControls` was moved out of the card into the Lego.

**Date of birth, Mailing address, and Customer alert are now also complete**, so
EVERY editable field of the card is now its own Lego:
- `src/components/workflow/ContactDob.tsx` (`DobDisplay`, `DobFields`,
  `useDobDraft`, `DobEditor`). Reuses `src/lib/stewardship/dob.ts`; preserves the
  exact-DOB downgrade guard and the edited-vs-seed persist rule (a policy-derived
  seed is written ONLY on a genuine edit, never on a plain save).
- `src/components/workflow/ContactAddress.tsx` (`AddressDisplay`,
  `AddressFields`, `useAddressDraft`, `AddressEditor`, plus exported
  `addressLines`/`addressUsable`). Reuses the `fmt` normalizers; owns the Address
  Verified checkbox.
- `src/components/workflow/ContactAlert.tsx` (`AlertBanner` display +
  `AlertField`/`useAlertDraft`/`AlertEditor`). The top-of-card banner and the
  editor textarea; empty text clears the alert.
Each has a Storybook story and is exported from `index.ts`. The unified editor
consumes all three via their headless Fields + draft hooks; the card-local
`VerifiedToggle`, `AlertBanner`, and `inputCls` were removed, the headings are
the bold Lego style, and the editor section divider is the darker
`divide-surface-border-section` token.

## What remains (OPTIONAL — Option B, non-field parts)

The five FIELD Legos are done and shipped. The remaining work is OPTIONAL: pull
the card's non-field parts into their own components IF they prove reusable
elsewhere. A reusability analysis was completed (owner agreed to do A now, then
analyze B); its conclusions, which drive the recommended order:

- **Identity header** (`CustomerNameHeading` → name + age + masked-DOB subline):
  genuinely reusable (customer record page, stewardship/My Work task banners,
  case/project detail all hand-build a weaker version). Extract the PRESENTATION
  half as `CustomerIdentityHeader` (composing `PersonNameDisplay` + the new
  `DobDisplay` + age formatting) and leave name-editing as an optional wrapper.
  Trigger: the first second screen that needs it — do not do it speculatively.
- **Status vocabulary** (`STATUS_META` + `toneFor`): reusable; the most
  design-system-shaped piece. Extract into the workflow design system so
  confirmed/known/missing means the same everywhere, when a second surface shows
  that status. Low risk (pure data + one pure fn).
- **`VerifiedToggle`**: already effectively shared — verified now lives inside
  each field Lego (per-field "can this be verified?" rule). The card-local copy
  was deleted. No standalone component needed unless a 4th field wants it.
- **`OverviewRow` / `ContactStatusKey`**: card-specific collapsed-view layout.
  Keep in the card; let them consume the shared status vocabulary once it moves.
- **`ContactMentoring`**: the mechanism is already shared (`MentorUi`); only the
  card-specific coaching copy lives here. Keep it, and keep it distinct from the
  Assistant (steering).

Recommended order if B is pursued: (1) `STATUS_META` + `toneFor` into the design
system; (2) `CustomerIdentityHeader` when a second screen needs it; (3) leave the
rest until a concrete second caller exists.

The card-level ORCHESTRATION stays in the card and must NOT become a field Lego:
self-contained fetch/PATCH + age/DOB preservation, the collapsed/expanded state
machine, `buildChange` minimal-diff + the single history-entry preview, and the
card-wide `appearance` (Design Playground) system.

Deploy each change to the development preview only (never production) via the
delivery workflow in AGENTS.md / `.kiro/steering/delivery-workflow.md`
(`vercel deploy` + alias `bobdev` + `vercel inspect`).

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
component + a draft hook + a thin standalone editor. `ContactEmail.tsx` already
follows this shape and is the closest template for Phone (an input value + a
validity signal + a Verified checkbox, plus Phone's own Do Not Text / Text
Undeliverable controls). Reproduce it for each remaining Lego. Reuse the
existing normalizers in `src/lib/contact-input.ts` (`normalizePhoneInput`,
`formatPhoneDisplay`, `formatPhoneAsTyped`) and `src/lib/stewardship/dob.ts`
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

---

# NEXT EFFORT (separate task): reconcile production's migration ledger drift

Status date: 2026-11-01. This is a DIFFERENT effort from the contact-card Lego
work above; it is appended, not replacing it. This is the "fix it first" item.

## The problem (verified live, not from memory)

`supabase db push` against PRODUCTION cannot apply new migrations by the normal
path. It reports "Found local migration files to be inserted before the last
migration on remote database. Rerun ... with --include-all" and lists dozens of
OLD files. Running `--include-all` would try to replay the entire early history
against production and is NOT safe. This has been recurring on every release.

## Exact diagnosis (measured on 2026-11-01)

- Repo has 118 migration files under `supabase/migrations/`.
- Production's ledger (`supabase_migrations.schema_migrations`) has 64 rows.
- Production's ledger is a CLEAN contiguous subset: it starts at
  `20261007182159` (name `remote_schema`, a squash/baseline snapshot) and runs
  unbroken to `20261126000003`. There are ZERO ledger-only / re-stamped /
  orphaned versions on production — nothing is corrupted.
- The drift is exactly the 54 PRE-BASELINE repo files dated `20260515000001`
  through `20260927000003`. Their schema is already contained in the
  `20261007182159` baseline, but they were never recorded as individual ledger
  rows, so `db push` thinks they are unapplied and wants to insert them
  mid-history. All 54 sort before prod's last version, which is what triggers
  the `--include-all` demand.

NOTE: this is production's drift. The development CLONE's ledger is messier
(it has re-stamped rows where `name` holds a different filename than `version`,
e.g. version `20261019212304` / name `20261107000001_rename_...`). The dev clone
and production are NOT the same shape — verify each independently before acting.

## Recommended fix (the clean, low-risk option)

Backfill the 54 missing pre-baseline versions into production's ledger as
ALREADY-APPLIED, WITHOUT running their SQL (their schema is already present via
the `20261007182159` baseline). That makes `db push`'s view match reality and
removes the `--include-all` trigger permanently. Mechanically this is an insert
of the 54 `(version, name)` rows into `supabase_migrations.schema_migrations`;
`supabase migration repair --status applied <version>` is the supported way to
do exactly this per version (it records applied without executing the file).

Before doing it, RE-VERIFY against the live DB (do not trust this file's
numbers): recompute the repo-vs-ledger diff, and spot-check that the schema the
pre-baseline files create actually exists in production (it should, via the
baseline) so marking them applied is truthful, not a cover-up of missing schema.

Do NOT "fix" this by deleting the 54 old repo files — they are real history and
other environments/tools may rely on them. Reconcile the LEDGER to the files,
not the files to the ledger.

## Why it kept coming up

Each release's new migrations sit after prod's last version, but because the 54
old files sort BEFORE it, `db push` refuses the whole batch and demands
`--include-all`. Until the ledger is backfilled, every release has to apply its
own migrations surgically (direct SQL in the SQL Editor + manual ledger rows),
which is what the contact-card/DOB release above did (see
`private/PRODUCTION_RELEASE_contact_card_dob_name.sql` for the pattern).
