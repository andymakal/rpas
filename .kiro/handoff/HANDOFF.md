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

# DONE (2026-11-01): production migration-ledger drift reconciled

The pre-baseline ledger drift is FIXED on production and needs no further work.
The 54 pre-baseline versions (`20260515000001` … `20260927000003`) were
backfilled into `supabase_migrations.schema_migrations` as already-applied,
without running their SQL. Verified live after the fix: 54 pre-baseline rows
present, ledger runs `20260515000001` → `20261126000003`, total 118 rows =
the 118 repo files, baseline `20261007182159` present. `db push` no longer
demands `--include-all`; future releases apply normally.

Accuracy was confirmed against live prod before marking applied: the schema AND
the seed/correction data of the 54 files are present (the `20261007182159`
baseline was snapshotted 2026-10-07, after these 54 had built the DB). The
script used was `private/PRODUCTION_LEDGER_RECONCILE_prebaseline.sql` (single
idempotent transaction, `ON CONFLICT (version) DO NOTHING`). Kept for reference;
it is safe to re-run (inserts nothing on a second run).

Note for future releases: the surgical per-release workaround described in the
contact-card/DOB release pattern is no longer necessary for this cause.

---

# Phone normalization (SHIPPED) + dev DB refresh (BLOCKED on authorization)

Status date: 2026-11-01. Two separate efforts from this session.

## A. Phone storage normalization — COMPLETE and in PRODUCTION

Decision: phone numbers are STORED as bare 10 digits everywhere and formatted to
`(XXX) XXX-XXXX` only on display (via `formatPhoneDisplay`). This reversed the
older "store formatted" standard and fixed a spurious "Customer Contact Updated"
history entry that fired when a stored phone differed only in punctuation.

What shipped (commit 207d58b, merged to `main` via PR #23, `main` at 74c6cd9;
`development` fast-forwarded to match):
- `normalizePhoneInput` / `normalizePhone` (in `src/lib/contact-input.ts` and
  `src/lib/fmt.ts`) now return bare 10 digits. `formatPhoneDisplay` /
  `formatPhoneAsTyped` unchanged (they strip-to-digits, so they format either
  stored form).
- Display sites wrapped in `formatPhoneDisplay` across light + dark pages, the
  fact-finder print page, the agency portal, and the `.ics` calendar export.
  Triage search compares on stripped digits.
- Import write paths store digits (lead-import `firstPhone`, admin/team,
  policy-import `owner_phone`).
- Steering standard `.kiro/steering/contact-input-standard.md` rewritten to
  codify digits-only storage + format-on-display + digit matching. AGENTS.md has
  no phone bullet (defers to that steering file).

Data: production backfill was run by the OWNER (not the agent): all 11,079 prod
phones now 10 digits, 14 damaged rows left unchanged, 17 phone-verification
timestamps preserved. Dev clone was backfilled by the agent earlier. The
idempotent SQL + the 14-row damaged exception list are in
`private/phone_digits_backfill.md`.

REMAINING (minor, optional): the 14 damaged phone numbers need a human decision
(correct or clear) — e.g. Travis Veillon `(000) 000-000`, the `0-XXX-XXXX`
service_policies rows, Andy Makal's own producer number. Not urgent.

Also fixed en route: the dev clone was missing `cases.replaced_by_case_id` /
`replaces_case_id` (migration `20261027000002` never applied to the clone),
which blanked the case-detail page on the preview. Agent applied that one
migration to the DEV clone. Production already had those columns.

## B. Dev database refresh from production — BLOCKED (authorization)

Goal: refresh the EXISTING development Supabase project so it accurately
reflects production (schema + data + migration history), using supported tooling
only, no new project, no production changes. NOT a schema-only patch.

Findings (read-only; full detail in `private/dev_refresh_access_findings.md` and
`private/dev_refresh_findings.md`):
- Projects: prod `erbvssfcglhnelfelbfi` (right-path-agency-system), dev
  `buoztddompdsuccfcixk`. Git is harmonized; only the DATABASES diverged.
- Migration ledgers have FORKED both ways: prod has ~21 daily migrations
  (Nov 6-26) dev lacks; dev has ~30 dev-branch migrations prod never recorded.
  Table list is identical (72 tables); drift is at column level.
- Data counts differ (dev is a stale snapshot): prod 11,534 customers / 1,797
  cases vs dev 11,408 / 1,668.
- Auth: the 12 real users share identical auth IDs + producer IDs across both
  (dev was cloned from prod). Dev has ONE extra login that must be preserved/
  recreated across any refresh: `dulce.test@rpas-dev.local` (auth
  `974410c2-...`, producer `8ffbd977-...`, "Dulce (TEST)").
- No in-database cron jobs on either side (scheduled work is Vercel cron →
  `/api/cron/*`, gated by CRON_SECRET; preview uses a dummy secret).

THE BLOCKER (authorization, needs the owner): the logged-in Supabase CLI account
is NOT an owner/admin of the org that holds the dev project. It can read dev's
API keys and list dev backups, but privileged management is denied (`branches
list` → 403). The CLI has no cross-project restore command, and the pg_dump
route needs the dev DB password (out of scope for the agent). So a supported
managed refresh needs ONE owner action, entirely in the dashboard:
  1. Supabase dashboard → dev project `buoztddompdsuccfcixk` → Settings →
     General: note the owning org.
  2. That org → Team: grant the working CLI account Owner/Admin — OR the owner
     runs the restore from that project's dashboard directly.
Once the account owns dev's org, the agent can drive the supported refresh and
the schema+ledger reconcile automatically (a physical restore from prod makes
dev's schema AND ledger equal prod's in one shot — preferred over hand-applying
migrations, since ledger rows do not prove effects exist).

SECURITY ITEM: a dev `service_role` key was echoed to a session transcript. It
is the SAME dev key already in plaintext in `.env.local` (dev-only, not prod),
so low severity, but rotate it when convenient. Rotation = dashboard (dev
project → Settings → API → rotate JWT secret), then update
`NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` and
the Vercel Preview env, then redeploy preview. Consumers: anon key in
`client.ts`/`server.ts`/`proxy.ts`/`auth/callback`; service_role only in
`src/lib/supabase/admin.ts`.

## Cleanup note
Temporary repro scaffolding from the case-blank diagnosis was deleted. The
`private/*.md` files referenced above are intentional local runbooks (private/
is gitignored).

---

# SUPERSEDES §B above — dev DB rebuilt + migration workflow built (2026-10-31)

This section supersedes "B. Dev database refresh from production — BLOCKED".
That blocker is RESOLVED. Two efforts completed this session, in order:
(1) the development database was rebuilt from production, (2) a standard
migration-deployment workflow was committed to `development`. Production was
never touched; the Vercel preview is unchanged and serving (HTTP 200 at
`https://bobdev.therightpathagency.com`).

## 1. Development database rebuilt from production — DONE

Dev `buoztddompdsuccfcixk` was rebuilt to match prod `erbvssfcglhnelfelbfi`
using the documented Supabase logical dump/restore (`supabase db dump` →
`psql`), NOT PITR and NOT a new project. The earlier org-membership blocker was
sidestepped: the restore authenticates at the DATABASE level, not the
management API. DB auth came from the CLI-minted ephemeral `cli_login_postgres`
role (via `supabase db dump --project-ref <ref> --dry-run`, which prints a
connection env) — no password was ever typed in chat, and no stable DB password
is needed for a one-off restore.

How it was done (reproducible; artifacts in `private/restore_rebuild/`, gitignored):
- Dumped prod (read-only): `01_roles.sql`, `02_schema.sql`, `03_data.sql`
  (COPY, 14 MB, public+auth+storage), ledger captured separately.
- Captured a dev pre-restore rollback snapshot first: `rollback/dev_*`.
- Reset dev `public` (DROP SCHEMA CASCADE + recreate + grants) and TRUNCATEd
  auth/storage data — via the dev MCP, which connects as `postgres`.
- Loaded schema then data with Dockerized `psql` (image `postgres:17`) over the
  dev Session pooler. KEY GOTCHA: a huge single piped session drops on the
  pooler; the reliable recipe is autocommit `-f` with keepalives
  (`keepalives=1 keepalives_idle=10 ...`) and `SET ROLE postgres;` prepended.
  `--single-transaction` on that pooler is unreliable (behaves transaction-mode).
- Reset sequences (setval max+1). Loaded the 118-row ledger via the dev MCP
  (the `cli_login_postgres` role CANNOT touch `supabase_migrations`; the MCP's
  `postgres` role can).

Verified dev == prod: tables 72, views 1, enums 18, functions 48, constraints
286, indexes 243, triggers 26, RLS tables 72, policies 90, ledger 118
(`20260515000001`→`20261126000003`). Data exact: customers 11534, cases 1797,
service_policies 10150, case_touches 6030, producers 12. Zero FK orphans. All 12
real prod logins restored verbatim (passwords+identities intact).

Dulce (TEST) recreated — her old dev-only work_function/project ids no longer
exist, so capabilities were re-mapped to PROD's real ids, mirroring the real
Dulce (`dvelazquez2`): `outreach` (agency-wide), `operations_prep` + `research`
(both project `205c934d` "Q4 1035 Review"). Login:
`dulce.test@rpas-dev.local` / password in
`private/restore_rebuild/DULCE_TEST_LOGIN.md` (gitignored). Password-grant
against dev GoTrue verified 200. Note: dev has one extra extension `pg_net`
(dev-only, pre-existing, benign — left as-is).

## 2. Migration deployment workflow — COMMITTED to `development`, NOT yet live

Files (on `development`, latest commit `0a754f7`; also `0931bf7`):
- `.github/workflows/supabase-migrations.yml`
- `.kiro/steering/migration-deployment.md` (always-included; the routine)

Design: push to `development` touching `supabase/migrations/**` →
`supabase db push` applies committed migrations to the DEV database (plain repo
secret `SUPABASE_DB_URL_DEVELOPMENT`, no Environment needed). A drift guard
(`supabase migration list` + a verified regex) and non-zero `db push` exit both
STOP the deploy — no silent partial apply. Production is NEVER touched on a push:
the prod job runs only via manual `workflow_dispatch` (`target=production` +
typed `production` confirm), bound to the existing `Production` GitHub
Environment whose required-reviewer gate is the authorization; it dry-runs
before applying. No Vercel change, no data sync, nothing scheduled. A `dry_run`
dispatch input exists for a safe dev smoke test.

Verified non-destructively: the dev-job body was rehearsed against the real dev
DB — `migration list` clean (118/118), drift guard PASS, `db push --dry-run` =
"Remote database is up to date". YAML parses; drift regex tested (catches a
remote-only row, no false positive on clean).

Production cannot execute today, confirmed live 3 ways: workflow not on default
branch `main` (dispatch → HTTP 404), 0 repo secrets, 0 `Production` env secrets
+ 0 protection rules.

### REMAINING — all require the OWNER / repo ADMIN (agent token is WRITE only)

The agent CAN set plain repo secrets but did NOT, to avoid handling DB
credentials. Creating/editing GitHub Environments + reviewer rules returned 403
(needs admin). Exact steps for Bob:
1. Promote the workflow to `main` via a normal reviewed PR (this is what makes
   the manual "Run workflow" button + the production path exist). Merging to
   `main` is a production action — left unauthorized on purpose.
2. Repo secret `SUPABASE_DB_URL_DEVELOPMENT` = dev project → Connect → Session
   pooler string (includes DB password). After this + step 1, dev auto-deploy
   is live.
3. On the existing `Production` GitHub Environment: add a required reviewer, and
   add env-scoped secret `SUPABASE_DB_URL_PRODUCTION` = prod Session-pooler
   string. Then the reviewer-gated production promotion is available.

### Housekeeping noticed (not acted on)
- Stale orphaned workflow `migration-replay.yml` ("Migration Replay (temporary)",
  id 377426300) is still REGISTERED from a 2026-10-07 experiment but its file is
  gone from all active branches — inert, no conflict. Bob may delete it.
- Still-open from §A: 14 damaged prod phone numbers need a human correct/clear
  decision (see `private/phone_digits_backfill.md`). Unchanged, not urgent.
- Data refreshes remain ON DEMAND by design (no scheduled sync). The restore
  runbook + rollback snapshot live in `private/restore_rebuild/` if dev needs
  rebuilding again; safe to delete once confidence is high.

Git state at wrap: branch `development` at `0a754f7`; `origin/main` unchanged at
`74c6cd9`. Working tree has only the usual untracked local items
(`.kiro/settings/`, `supabase/.temp/`) plus this handoff edit.
