# Handoff — light-page refactor + Storybook removal

Active effort. Bob/Kiro on `development`. Updated during a ~3h unattended session.

## What this effort is

Two goals, from the session:
1. Break the two oversized LIGHT-theme files down toward the
   Lego → Panel → Workbench structure:
   - `src/components/workflow/CustomerContactCard.tsx` (was 2177 lines)
   - `src/app/(internal)/stewardship/StewardshipClient.tsx` (4521 lines)
2. Mid-session decision: **dump Storybook entirely** ("it hasn't been useful").

Scope note established while investigating: the Legos were ALREADY extracted
from `CustomerContactCard` (PersonName, ContactEmail, ContactPhone, ContactDob,
ContactAddress, ContactAlert, Divider each in their own file). The card's bulk
was NOT trapped Legos; it was (a) a ~450-line Storybook "appearance"/Design
Playground subsystem, (b) shared types, (c) the composition core + the exported
`CustomerNameHeading`.

Also confirmed: of the 11 light-section files >1000 lines, only THREE are on the
light workflow layer — `StewardshipClient`, `CustomerContactCard`, and
`MyWorkClient.tsx` (1055). The other eight (ContactReviewClient, CaseEditClient,
CustomerCardClient, TriageClient, ReferralEditClient, PolicyDetailClient,
FactFinderSection, ReviewPrepClient) are NOT light-theme and are out of scope.

## DONE and VERIFIED (committed + pushed to `development`)

Commit `0e05d13` "Remove Storybook and its prototype/playground artifacts":

- Storybook fully removed:
  - Deleted `.storybook/` (main.ts, preview.tsx).
  - Deleted all 20 `*.stories.tsx`.
  - Deleted `src/components/workflow/playground-controls.tsx`,
    `ContactWorkspace.tsx` (self-described Storybook artifact, unrouted),
    `src/components/workflow/prototype/` (CustomerOverviewPrototype), and the
    entire `src/components/servicing-recovery/` 1035 prototype (all STORYBOOK-ONLY).
  - `package.json`: removed `storybook` + `build-storybook` scripts and the six
    `@storybook/*` + `storybook` devDeps.
  - `vercel.json`: buildCommand reduced to `next build`.
  - `next.config.ts`: removed the `/storybook` rewrites AND
    `skipTrailingSlashRedirect: true` (it existed only for Storybook; app routes
    are canonical no-slash).
  - `src/proxy.ts`: removed the `storybook` matcher exclusion.
- `CustomerContactCard.tsx`: removed the Storybook-only `appearance` / Design
  Playground PUBLIC API — the `ContactCardAppearance` prop and its sibling
  exported types (ColorChoice, WeightChoice, VerifiedPlacement, EditPlacement,
  AlignChoice) are no longer exported (barrel updated), and the `appearance`
  prop is gone from SelfContainedProps / LegacyProps / ContactCardView. The card
  now renders its one approved look via `resolveAppearance()` with no argument —
  the SAME value production already resolved when no appearance was passed, so
  the rendered output is identical by construction.

Verification: `npx tsc --noEmit` clean; `npm run build` clean (all routes
compiled, exit 0) AFTER all deletions.

## NOT deployed to preview — needs your go

Deliberately did NOT run `vercel deploy`, because this commit changes
preview/build infra (`next.config.ts`, `vercel.json` buildCommand) and no one is
available to eyeball the preview. To publish when you're ready (from repo root):

```
vercel deploy --force
vercel alias set <printed-url> bobdev.therightpathagency.com
vercel inspect https://bobdev.therightpathagency.com
```

## NOT done — deferred because they need a preview look (not safe blind)

1. **Collapse the dead appearance resolver in `CustomerContactCard.tsx`.**
   `resolveAppearance` / `ResolvedAppearance` / `DEFAULT_APPEARANCE` /
   `APPROVED_DEFAULTS` / the textStyle/iconStyle/weight helpers (~450 lines) are
   now internal and only ever feed the single approved look. They CAN be inlined
   to their resolved constant values and deleted, which is where the big line
   reduction on this file actually comes from. I did NOT do it blind: it means
   hand-replacing dozens of `ap.*`-driven inline styles with their resolved
   literals, and the failure mode is silent visual drift that tsc/build cannot
   catch. Do this as its own change and confirm on the preview (the card appears
   on stewardship task screens and the self-contained customer contact surface).
   The resolved approved values to inline, for reference:
   - name heading: `font-size 33px, color var(--brand), font-weight 700`
   - card section: `border 1px solid var(--text-secondary), radius 16px,
     padding 16px, background var(--surface-card)`
   - dividers shown; status indicator hidden; field labels black; status/contact
     icons keep status color; section padding 12px, field spacing 6px.
   - `isDefault` is FALSE for the approved look (it differs from the neutral
     baseline), so inline styles ARE emitted today.

2. **`StewardshipClient.tsx` (4521 lines) panel/workbench extraction — NOT
   STARTED.** This is behavior-sensitive. Key hazard confirmed by reading it:
   `TaskChrome` is declared at MODULE level on purpose so the task subtree is not
   remounted and guided-call state is not reset; the direct "Send Introductory
   Emails" screen renders chromeless (`hideBackHeader`) and supplies its own
   WorkflowPage. Any extraction must preserve that no-remount structure. Also:
   `src/app/(internal)/stewardship/customer-interaction/CustomerInteractionClient.tsx`
   imports `{ StewardshipTask }` from `../StewardshipClient`, so `StewardshipTask`
   must stay exported with the same signature. Do the panels one at a time and
   confirm a guided call still keeps its state across a reach/skip on the preview.

3. `MyWorkClient.tsx` (1055) — flagged as a genuine light-theme file slightly
   over 1000 lines. Not in the original two; left for your call.

## Housekeeping note

`package-lock.json` was NOT regenerated after removing the six Storybook
devDeps (running `npm install` unattended risked churning unrelated deps). Run
`npm install` and commit the lockfile when convenient; the build does not
require it.

## UPDATE — Storybook removal finished and deployed

Follow-up commit on `development`:
- Scrubbed the last stale Storybook mentions (code comments only) in
  `CustomerContactCard.tsx` and `MyWorkClient.tsx`. No behavior change.
- Regenerated `package-lock.json` with `npm install` after the six `@storybook`
  devDeps were removed (lockfile shrank ~3.4k net lines — the Storybook tree).
- `npx tsc --noEmit` clean; `npm run build` clean (exit 0, all routes).
- Deployed to the shared preview and pointed the `bobdev` alias at it.

Repo-wide check: zero `.stories.tsx`, no `.storybook/`, no `@storybook/*`
imports, no `storybook` references left in source/config. Storybook controlled
nothing in the running app — it was preview-only (built to `public/storybook`
on non-prod deploys), now fully gone.

STILL OPEN (unchanged, both need a preview look — NOT Storybook-related):
1. Inline + delete the ~450-line internal appearance resolver in
   `CustomerContactCard.tsx` for the real line reduction (resolved values above).
2. `StewardshipClient.tsx` (4521) panel/workbench extraction — not started;
   module-level `TaskChrome` no-remount hazard, `StewardshipTask` must stay
   exported.

## UPDATE — StewardshipClient panel extraction COMPLETE

`StewardshipClient.tsx`: 4521 → 1558 lines. Done in verified checkpoints on
`development`, each tsc + eslint clean:
- `types.ts` — shared Customer/BoardItem/Holding/Detail/OpenPopulation +
  POPULATION_META/QUEUE_ICON/QUEUE_GROUPS.
- `shared.tsx` — cross-cutting helpers + small shared components (openMailto,
  saEmailBody/saFollowUpEmailBody, fullName, textActionAvailable, streetLine,
  followUpLapsed, shortDate, currency, call-number/reason helpers, CallContext,
  FollowUpChase, EVERLAKE_CARRIER_PATTERN).
- Removed dead legacy CustomerContext/ContactVerification path (useCard was
  hardcoded true).
- `call/` — OutreachCallPanel (the guided outbound-call panel), CallAction +
  CallBoardAction, CallScriptCard, ChannelUnavailable.
- `panels/` — ServicingFormDelivery, FormAttachmentDirective, FormCoverage,
  NonresponsiveNotice, ReadyToEmailAction, RefusedAction,
  WaitingForResponseAction, CarrierAction (+CarrierPolicyRow), ResearchAction,
  FormAction (+FormConfirmAndSubmit, RequiredSignatureConfirm),
  ServicingAccessAction (+AuthorizationUpload, ServicingAccessSubmit),
  CustomerInteractionAction, RecordAttemptPanel, HoldingsContext (+HoldingRow).

The host is now the board/list/population view + StewardshipTask orchestrator +
module-level TaskChrome (no-remount contract intact) + StewardshipContextPanel /
StewardshipHistoryColumn / TaskAction assemblers. Named component = own file;
single-parent children kept beside their panel.

VERIFIED: `npx tsc --noEmit` clean, `npm run build` clean (exit 0). Guided-call
state confirmed on the preview (Reached + Defer + date held across a re-render;
Skip advanced and cleared). Deployed to the preview.

REMAINING OPEN (unchanged): inline + delete the ~450-line internal appearance
resolver in `CustomerContactCard.tsx` (needs a preview look — resolved values
listed earlier in this file).
