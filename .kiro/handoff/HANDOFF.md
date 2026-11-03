# HANDOFF — Right Path Calendar

Temporary task state for in-flight efforts (per AGENTS.md §Working discipline).
NOT permanent steering. Each section is a separate effort; delete a section when
that effort is complete.

---
---

# HANDOFF (newest) — Servicing-Agent Capture, STEP 1 (Verify) — SHIPPED TO PRODUCTION

Added 2026-11-03. This effort's step 1 is COMPLETE and live in production. This
section is reference for the NEXT steps of the capture workflow, not unfinished
step-1 work. Re-verify against the live DB before relying on specifics.

## The workflow and where it stands

Servicing-Agent Capture is the whole process of establishing that Right Path is
the servicing agent on inherited/back-book customers' policies — the GATE that
unlocks seeing a policy and running the 1035 review (Everlake blocks non-SAs
from statements/illustrations). The authoritative spec is
`.kiro/specs/servicing-agent-capture/requirements.md` (groundwork + step-1
requirements; the IPF "the value is the existing unserved book" basis).

Full workflow order (spec): 1) VERIFY not-SA ← SHIPPED; 2) reach the customer
(email + Guided Call Workbench); 3) get authorization (form, wet signature);
4) carrier confirmation (sa_status→confirmed, already built); 5) hand-off to
review/1035. Steps 2-5 largely already exist in the stewardship lifecycle; the
only thing step 1 added in front of them is the verify gate.

## What step 1 shipped (LIVE in production + dev, branches in sync)

- The `sa_status` model is settled (3 values, no schema change): `unknown` =
  nobody checked; `confirmed` = we ARE the SA; `not_on_file` = checked, we are
  NOT (the "verified not-SA" state; never shown to operators as that literal).
- Everlake-eligible carrier rule (HARDCODED, frozen blocks):
  `src/lib/policies/everlake-carrier.ts` `isEverlakeCarrier()` — true for any
  carrier containing "allstate" or "everlake", or exactly "Lincoln Benefit Life"
  (LBL = the old Allstate life block, a DIFFERENT company from Lincoln
  Financial). Bare "Lincoln" / "Lincoln Financial" / "Lincoln Financial Group"
  are NOT eligible. (+ `.test.ts`.) Verification is a MANUAL Everlake Agent
  Portal Contract Look-Up: copy policy number → search → found = SA, "couldn't
  find" = not SA.
- `verify_servicing_agent` work function (migration
  `20261130000001_verify_servicing_agent_work_function.sql`, sort_order 5, no
  license gate) + agency-wide `primary` producer_work_functions for the same
  operators who hold `research`. Applied to DEV by the workflow; applied to PROD
  by hand via the Supabase SQL EDITOR including the ledger insert (prod ledger
  matches the file, no drift). `WorkFunctionKey` union updated; `ACTIVITY_GUIDANCE`
  entry added.
- My Work surface: the activity LEADS "Available work" (it is the gate). Ordering
  lives in `src/lib/my-work/direction.ts` `FIXED_WORKFLOW_ORDER` (verify first),
  NOT the ZEN band — the Available-work plan is a FIXED workflow sequence. Count
  is unverified POLICIES (per-policy work), computed in
  `src/lib/my-work/composition.ts` inside the `if (proj)` block from one Everlake
  read.
- The verify SURFACE: `/projects/[id]/verify-servicing-agent` (page + client) with
  Contact-Research chrome (title "Verify Servicing Agent", Back to My Work) and
  the GET/PATCH API at `/api/projects/[id]/verify-servicing-agent` (GET = live
  worklist filtered to Everlake carriers; PATCH = per-policy sa_status write,
  guarded to Everlake carrier + project membership, last-write-wins).
- The GATE (sibling of the EXISTING determination gate): pure predicate
  `verifyBlockedForPolicies(policies)` in `src/lib/projects/workflows.ts` next to
  `onboardingCompleteForPolicies` — true when ANY Everlake policy is `unknown`. A
  blocked customer is pulled OUT of all downstream My Work (board outreach + its
  sub-populations, operations_prep, determination, derived onboarding, contact
  research) in `composition.ts`, mirrored in `scope.ts` for search parity, and
  surfaces ONLY under Verify. Clears when every Everlake policy has a definite
  answer. Non-Everlake never blocks. (+ predicate test in `workflows.test.ts`.)
- Shared-worklist freshness: the verify client RE-FETCHES the live worklist after
  each record/skip (no stale in-memory walk), so two operators clearing a batch
  never re-check each other's policies. DELIBERATELY no per-policy claim/lock
  (a ~5s factual lookup once at project start doesn't warrant it; the per-policy
  write is last-write-wins so a same-instant collision is harmless).

Shared LEGOS extracted this effort (barrel `@/components/workflow`): `CopyField`,
`BinaryChoice`, `DoneSkipActions`, `VerifyServicingAgentCard` (pure composition
of those + the existing `CallMentorCap`). Steering `ui-composition-vocabulary`
gained a "build-as-a-Lego-first" section.

Production path this effort: PR #26 (surface + Legos), PR #27 (gate), PR #28
(live shared worklist), all merged to `main`; prod migration applied via SQL
editor. `development` fast-forwarded to `main` (in sync). Verify baseline: `npx
tsc --noEmit` clean, `npm run test:dd` 267/267, `npm run build` clean.

## Live facts (verified this session; re-verify before relying)

- PROD service_policies: ~10,151 non-test; sa_status default `unknown`; CHECK
  (unknown|confirmed|not_on_file). The Q4 1035 Review project (142 customers)
  has ~176 Everlake-unknown policies to verify; gate blocks 137 of 142 members
  until verified (expected — work concentrates at Verify).

## Open / next (NOT blocking; deliberate follow-ups)

1. Steps 2-5 of the capture spec are the real next build — but they largely reuse
   the EXISTING stewardship lifecycle; confirm what (if anything) each step needs
   beyond the gate before building. Walk them one branch at a time with Bob
   (he wants business decisions surfaced, engineering sequencing made for him).
2. The CALL-WORKFLOW REDESIGN ("didn't connect" branch) is a SEPARATE in-flight
   effort — see its own section below. It is downstream (step 2's call branch).
3. Light-page Lego SWEEP (agreed, later): rebuild `GatewayLookup` and the call
   panel's Reached/Didn't-reach on the new `CopyField`/`BinaryChoice`/
   `DoneSkipActions`; rename `CallMentorCap` to a general mentoring name. Light
   pages only; Andy's dark screens untouched; done as pages are touched.
4. DATA SCRUB (Bob's): 64 bare-"Lincoln" policies (all annuities, Lincoln
   Financial product markers like i4LIFE/ProtectedPay in coverage_status — almost
   certainly Lincoln Financial, NOT LBL, so NOT Everlake). Relabel to their true
   carrier so the Everlake rule stays correct. Also the broader dirty-carrier
   normalization (Corebridge/NFS/Protective casing dupes, "no sure", "Protective
   Life (screenshot)") — general hygiene, not Everlake-affecting.
5. PROD migration mechanics: the GitHub `Supabase migrations` workflow still
   lacks the `SUPABASE_DB_URL_PRODUCTION` env secret + the Production reviewer
   gate (needs the prod DB password, which can only be RESET not revealed — Bob
   declined to reset). DECISION: apply prod migrations via the Supabase SQL
   EDITOR (run the committed migration SQL + the `schema_migrations` ledger
   insert) going forward. Fine as-is.

---
---

# HANDOFF — Right Path Calendar

Last updated by the session that shipped Calendar Layer A (the precision
promised-callback + exact-time appointments) and the two-axis callback rework.

## Where things stand

Branch: `development` (in sync with origin). Everything below is committed,
pushed, and LIVE on the shared preview `https://bobdev.therightpathagency.com`.

PRODUCTION STATUS UPDATE (2026-11-02): development was fully promoted to
production. PR #25 merged `development` → `main` (40 commits: the call panel,
Calendar Layer A, declined basin, contact cleanup, bad-number history fix), the
app deployed to production via Vercel, and ALL production database migrations
were applied and verified (prod ledger 122/122, latest `20261129000001`, no
drift, no data loss). So `calendar_blocks` + the other three recent migrations
are now LIVE on the PRODUCTION database, not just dev. `main` is current with
`development`. Re-verify against the live DB before relying on this.
Known gap (not blocking): the GitHub production-migration workflow still lacks
its `SUPABASE_DB_URL_PRODUCTION` env secret and the Production reviewer gate —
an admin (Andy) setup task; the migrations this round were applied directly.

Shipped commits (most recent last):
- `calendar_blocks` spine + Layer A precision callback + exact-time appointments
  on My Work + double-booking guard + emitted `.ics`.
- Exact time is a half-hour dropdown (7:00 AM–9:00 PM), not free entry.
- Two-axis callback rework (see below).
- Steering: added `prefer-off-the-shelf` (in efficient-execution.md) and
  `calendar-is-the-spine.md`; fixed claim-location drift in AGENTS.md +
  ipf-integration.md (claim is `stewardship_outreach.claimed_by_producer_id`,
  NOT `action_context.claimedByTeamMemberId`).

Verification baseline: `npx tsc --noEmit` clean, `npm run test:dd` 259/259,
`npm run build` clean.

## The design is the source of truth

`CALENDAR_DESIGN.md` (repo root) is the authoritative design: the spine, the
`calendar_blocks` shape, the timezone/DST invariant, and the three-layer build
plan (A shipped; B and C not built). Read it first. The two new steering files
(`.kiro/steering/calendar-is-the-spine.md`, and the prefer-off-the-shelf section
of `.kiro/steering/efficient-execution.md`) are the standing rules.

IPF (`bobpfromm/ipf-stewardship`, PRIVATE github repo) is the functional
blueprint and was used as the source of truth throughout. Access it with the
`gh` CLI (e.g. `gh api repos/bobpfromm/ipf-stewardship/contents/<path> --jq
.content` then base64-decode). Key IPF references used: `src/domain/shared/
future-commitment.ts` (buildHalfHourSlots), `src/lib/daily-direction-engine.ts`
(the 15/15/60 commitment lifecycle), `src/lib/outreach-decision-engine.ts`
(preferred-window / contact-opportunity), `supabase/migrations/2026092911*
_producer_appointment_has_time.sql` and the `episode_next_actions` baseline.

## What Layer A actually does now (the two-axis model)

The Guided Call Workbench Defer path (`OutreachCallPanel.tsx`) captures a
promised callback on TWO axes:
- WHEN: a specific date (date picker) OR recurring weekdays (Mon–Sat chips;
  Sunday is never a work day).
- TIME: an exact half-hour time (specific-date only → an appointment) OR one or
  more time bands (9–12 / 12–3 / 3–6 / 6+, with an "Any" select-all) OR any time.
- recurring + exact is DISALLOWED (an exact time needs a real date).

An EXACT (specific-date) time creates a `calendar_blocks` appointment owned by
the acting producer, guarded against double-booking (kind-aware), emits an `.ics`
the operator sends from Outlook (Right Path never sends), and surfaces on that
producer's My Work Priorities via the (now live) rank-1 `exact_time_commitment`
ZEN band with dual-clock labels. A recurring availability has no single due
date; it resurfaces on the NEXT matching weekday (and each matching day after).
History preview shows date+time for an appointment, days×bands for recurring.

## Key files (calendar)

- `src/lib/calendar/callback-precision.ts` — PURE rules: `CallbackCommitment`
  {whenMode, date, days, timeMode, clock, bands}, `validateCallback`,
  `hasExactTime`, `resolveExactInstant`, `resolveDueDate` (next matching
  weekday), `commitmentSummary`, `buildHalfHourSlots`, `TIME_BANDS`, `WEEKDAYS`
  (Mon–Sat). (+ `.test.ts`)
- `src/lib/calendar/ics.ts` — `buildAppointmentIcs` (RFC 5545 via ical-generator;
  passes a ZONED luxon DateTime so the stated local time never server-shifts).
  (+ `.test.ts`)
- `src/lib/calendar/customer-zone.ts` — `deriveCustomerZone(state)` (customers
  has no tz column; derived from state; ambiguous states flagged). (+ `.test.ts`)
- `src/lib/calendar/appointments.ts` — `intervalsOverlap`, `isDoubleBooked`
  (kind-aware: appointment/busy conflict, hold never), `createGuardedAppointment`.
  (+ `.test.ts`)
- `src/components/workflow/CallbackPrecision.tsx` — the Lego (barrel-exported).
- `src/app/api/calendar/appointments/route.ts` — POST create-appointment route.
- `supabase/migrations/20261129000001_calendar_blocks_spine.sql` — the spine
  table + `producers.time_zone`. APPLIED to the dev DB and committed (ledger and
  file agree; no drift).
- My Work surfacing: `src/lib/my-work/composition.ts` (reads calendar_blocks,
  sets `hasExactTimeCommitment`, builds `appointments`), `types.ts`
  (`MyWorkAppointment`), `MyWorkClient.tsx` (`AppointmentsCard`).

## Live schema facts (verified; re-verify before relying on them)

- `calendar_blocks` exists: kind in ('appointment','busy','hold') — 'hold' NOT
  'reservation' (collides with the UNRELATED `work_reservations` soft-lease
  table). producer_id NULLABLE. starts_at/ends_at timestamptz + stated_time_zone
  text. has_time bool. customer_id (appointment only). source_type/source_id
  (non-owning backref). claimed_by/claimed_at. is_current/superseded_* history.
- `producers.time_zone` added (home IANA zone; nullable).
- `customers` has `state` + `zip`, NO timezone column.
- Recurring days×bands availability is stored on
  `stewardship_outreach.action_context.callbackWindows` {whenMode,days,bands}
  (soft fact; NOT yet read by any surface — a Layer C read).

## NEXT UP — the agreed next build: MISSED-COMMITMENT CHASE

This is a SEPARATE, scoped build (not started). Two distinct chases:
- Missed EXACT-TIME appointment ("call at 2," no answer): a HARD same-day chase —
  keep calling through the booked block (~2:00, 2:15, 2:30), plus a text, plus an
  email ("we had this set up, you missed it, what now?"). Reuse IPF's 15/15/60
  lifecycle (`COMMITMENT_ACTIVE_BEFORE/AFTER_MINUTES=15`, `COMMITMENT_MISSED_
  MINUTES=60`) from `daily-direction-engine.ts`. Never silently wait a week;
  never auto-terminate; a human decides (matches AGENTS.md doctrine).
- Missed RECURRING day ("Mon/Tue/Wed after 3," no answer Monday): text+email
  "called after 3 as you asked, we'll try tomorrow or set a time," repeat each
  matching day, then after a full calendar week with no response escalate to
  "we tried as you asked and haven't heard back" (then it's ghosting → existing
  nonresponsive/refusal handling).
- BLOCKER on this build: the customer-facing TEXT and EMAIL scripts go out on
  Allstate's rails (email via the mailto/Outlook generate→send→confirm contract;
  Right Path never sends). DRAFT the scripts for Bob's approval BEFORE wiring
  them; do not invent final customer wording.

## Also outstanding (designed, not built — CALENDAR_DESIGN.md)

- Layer B: appointments as claimable work — claim / release / REASSIGN-to-named
  / escalate, offered to a producer GROUP (tiers), reusing producer_work_functions
  + project_escalation_contacts. The Gabe-offers-9am-to-the-group flow. Needs:
  a support-ORDER rank (secondary/tertiary — not in the schema yet), a
  reassign-to-named action, escalation-alert surfacing, and graded life-producer
  capability tiers in the work_functions catalog.
- Layer C: the real calendar — declared working hours, duration-aware slot
  packing, group availability ("who's open at 9?" = per-person FILTER over the
  eligible tier, NOT an intersection), the resource-timeline UI, and reading the
  stored callbackWindows. Adopt a slot-math lib (timeslottr / The Booking Kit)
  per the off-the-shelf rule; Cal.com went private (April 2026) — do NOT adopt a
  whole booking platform (second app / public booking pages violate one-app and
  the Allstate no-third-party-scheduler rule).

## Working-rule reminders for the next session

- `development` is the shared line; `main` is production — do NOT touch main.
- Deploy = `vercel deploy --force` → `vercel alias set <url>
  bobdev.therightpathagency.com` → `vercel inspect` (a git push alone does NOT
  update the preview). Completion = live at the stable alias.
- Verify in proportion to risk; the zone/DST math is the one area that earns
  real tests (a type-check can't catch a server-zone shift — it already bit once).
- Delete this file when the calendar effort is complete.


---
---

# HANDOFF (second active task) — Call-Workflow Redesign: the "didn't connect" branch

Separate in-flight effort from the Calendar task above (appended per AGENTS.md:
do not overwrite another active task's handoff). Delete this section when the
call-workflow redesign spec is built and shipped.

Added by the session (2026-11-02) that fixed bad-number history wording and
synced dev↔prod. That session's own work is DONE; this section is the NOT-STARTED
redesign it teed up.

## Why this exists — the real case that exposed the defect

Harley Anderson (prod customer `f56159a0-1bae-45dd-87ca-f306d1607c87`) was
marked a "bad number" today and ejected to Contact Research. The number pulled
was `(610) 237-0662`. When Bob researched it in Gateway, that 610 was a HOME
number marked Allstate Do-Not-Call, with a CELL number also on file as
secondary. So "bad number" was the wrong classification (the number wasn't
dead — it was DNC), AND a usable alternate existed. The current flow threw the
number off the record and made the operator pick the customer back up in a
separate Research pass later.

Bob's point: when a call doesn't connect, the operator should be able to RECOVER
IN ONE SITTING — look up a better number in Gateway, update the customer, and
try that number — not bounce the customer out to a separate queue and come back
through multiple round trips. The system collapses too many distinct outcomes
into one yes/no "Is this a working number?" button.

## What was ALREADY shipped this session (the quick fix only — DONE, verified)

Bad-number history prose was trimmed and the dialed number surfaced. The history
line now reads e.g. `Called. Number not working. (610) 237-0662` instead of the
old `Called customer. Number is not working. Customer referred to Contact
Research.` Implemented in `src/lib/stewardship/customer-history.ts`:
- `describeHistoryNote` appends the dialed digits recovered from the existing
  value-scoped `[channel-unusable:<digits>]` marker (via `unusableValueFromNote`
  from `outreach-attempts.ts`), formatted with `formatPhoneDisplay` from
  `@/lib/contact-input`. Shows ONLY for a real 10-digit value.
- The three bad-number `SYSTEM_DESCRIPTIONS` entries now describe as
  `Called. Number not working.`; the guided-call Next-History-Entry preview
  (`describeCallSelection`) trimmed to `Number not working.`
- DISPLAY-ONLY: stored `case_touches.notes` are untouched; old rows re-render
  with the number because the digits were already in the marker.
This is committed, on `development`, live on preview, AND now in production.

## THE REDESIGN — NOT STARTED. Build it as a SPEC, walked step by step with Bob.

Bob is a financial professional, NOT an engineer. He has explicitly said: make
the engineering/sequencing calls yourself, do NOT hand him technical decisions,
and only surface genuine BUSINESS decisions (e.g. final customer-facing wording,
how a workflow should behave operationally). Walk the workflow one branch at a
time — "when we get to THIS step, here's what should happen next" — because the
branches cannot all be brainstormed up front. This is exactly what Specs are for.

First branch to design (the agreed starting point): the moment an outbound call
DOES NOT CONNECT. Today that is the single `badNumber` toggle in
`OutreachCallPanel.tsx` ("Is this a working number? Yes / Bad number"). The real
distinct outcomes are at least:
- No answer (fine — existing cadence handles it; schedules next call).
- Do-Not-Call on THIS number, but another number may be usable.
- Wrong / dead / disconnected number (truly bad: blocked or no longer exists).
- A better number exists in Gateway → switch to it, UPDATE the customer, and
  CALL it now, all in one sitting (no eject-to-Research round trip).

Open business decisions to resolve WITH Bob as the spec is walked (do not guess):
1. Should the first "didn't connect" question stop being yes/no and instead be
   the real outcome set above? (Bob leans yes.)
2. Should "bad number" even clear `customers.phone` immediately, or keep the old
   number until a replacement is confirmed? (Harley argues: don't vanish the old
   number before there's a replacement.)
3. Do-Not-Call: should Right Path RECORD a DNC flag per number (so a DNC number
   is never re-presented to call), or is DNC just context read from Gateway for
   now? (A new DNC flag = schema/scope signal — surface it, don't silently add.)

## Key files for the redesign

- `src/app/(internal)/stewardship/call/OutreachCallPanel.tsx` — the Guided Call
  Workbench panel. The `badNumber` state + "Is this a working number?" toggle
  (~line 128, ~564) is exactly what this redesign reworks. Reached/Didn't-Reach
  flow, channel Legos (voicemail/text/email), single "Record this attempt".
- `src/app/api/stewardship/[id]/route.ts` — the write path. `call-outcome` and
  `record-attempt` branches write `case_touches`; the bad-number branch writes
  the value-scoped unusable marker AND nulls `customers.phone`/`phone_verified_at`
  when (and only when) the transition routes to research-needed (~line 1002+).
  Any change to "when is the number cleared" happens HERE.
- `src/lib/stewardship/customer-history.ts` — history display (already touched).
- Contact standard: `src/lib/contact-input.ts` — one phone column, bare digits
  stored, `(XXX) XXX-XXXX` on render. `customers` has ONE `phone` column (no
  separate home/cell) — confirmed. A "secondary number" concept would be new.
- UI vocabulary (steering `ui-composition-vocabulary`): Lego → Panel →
  Workbench → Workflow. New controls are Legos in `src/components/workflow/`,
  barrel-exported; `primitives.tsx` is frozen. The Guided Call Workbench is
  specifically the OUTBOUND outreach call; post-reach branches are
  workbench-specific, not a global outcome set.

## Working-rule reminders (same as calendar task)

- `development` shared; `main` is production — only touch main via an authorized
  focused PR. dev↔prod are currently IN SYNC (see production status update above).
- Deploy to preview: `vercel deploy --force` → `vercel alias set <url>
  bobdev.therightpathagency.com` → `vercel inspect`. Deploy with
  `--scope makal-financial-services-llc` (a bare `vercel deploy` returned "Not
  authorized" this session; the team scope fixed it).
- Supabase MCP: `supabase-development` (read/write) and `supabase-prod-readonly`
  (read only) are available to verify live schema/data.
- Delete this section when the call-workflow redesign is shipped.
