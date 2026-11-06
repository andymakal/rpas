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


---
---

# HANDOFF (third active task) - My Work: assistant-driven board - SHIPPED, follow-ups open

Added 2026-11-03 by the session that redesigned My Work. The redesign itself is
LIVE IN PRODUCTION (PR #32, `main` at f905eec, production deploy Ready
2026-11-03 23:09 Central). This section is reference for the follow-ups, not
unfinished redesign work. Delete it when the follow-ups below are done or dropped.
Re-verify live facts against the database before relying on them.

## What shipped

Three columns, each answering one question: Priorities & Commitments (what needs
my attention), Assistant (what should I work on now, and why), Available Work
(what else could I work on). Mentoring accompanies items; there is no longer a
separate Practice Direction column (Today's Focus moved left, responsibilities
sit under the Assistant).

- Available Work: four universal classes (Preparation, Outreach, Customer
  Engagement, Casework). Classification keys off the working-plan STEP key, not
  the work function, because `outreach` spans three classes.
  `src/lib/my-work/work-classes.ts`. Per-class carets plus an additive
  Expand all / Collapse all on the title line.
- Filters: Project (unchanged) and Work type (the four classes). The old Activity
  filter is gone. Work type narrows the Assistant and Available Work, NOT the
  "See all available work" inventory (that stays grouped by work function) and
  NOT Priorities & Commitments.
- Assistant: a new GoRules ZEN rule, `src/rules/my-work-assistant.json`, ranks
  each working-plan STEP. Companion to `my-work-priority.json` (which still ranks
  work functions). Evaluator is `evaluateAssistantVerdicts` in
  `src/lib/my-work/engine.ts` (server only). Pure normalization and client
  ranking are in `src/lib/my-work/assistant.ts`. Call hours are in
  `src/lib/my-work/call-hours.ts`. `page.tsx` pre-evaluates all four
  call-hours/backlog combinations and the client picks one against a live clock
  (30 second tick), so it flips at 9 am and 6 pm Eastern with no reload.
- `direction.ts`: a project step is kept at zero only if it is the worker's own
  (responsibility or routable/assist status). This is why Determination does not
  appear for non-producers. A test covers it. Baseline now: `npx tsc --noEmit`
  clean, `npm run test:dd` 271/271, `npm run build` clean.

## Decisions Bob made (the business rules in the rule file)

- Commitments (appointments, promised callbacks, scheduled call times) are NOT
  ranked. They live in Priorities & Commitments and are never weighed against
  other work.
- Funnel principle: work that moves customers OUT of the pipeline ranks above
  work that feeds more IN.
- A step with nothing actionable never appears in the Assistant. No zero rows,
  no "so somebody can see it". Available Work is the map and may show zeros.
- Call hours are 9 am to 6 pm Eastern. Outside them the two call steps are not
  offered at all (still in Available Work).
- Weekends and holidays are deliberately NOT modeled. If someone opens it on a
  Saturday and wants to call, let them. Do not add a rule for this.
- Contact research counts only not-yet-researched customers (13, not 41). The
  tried-and-failed ones are a separate "Retry contact research", lowest priority.
- Research jumps ahead of the calls when the not-yet-researched backlog is above
  25 (`RESEARCH_BACKLOG_LARGE_ABOVE` in `assistant.ts`). Tune that one number.
- Verify and Determination belong to different people (operations vs producer),
  so they never share a list and their relative order does not matter.
- Order now (call hours open): Today's Focus, Verify / Determination, servicing
  access and operations prep, active conversations, calls due, other calls,
  introductory emails, research, research retries. After hours: same with the
  calls removed. Introductory emails sitting below calls and above research is a
  first guess; Bob said build it and tune it against real use.

## Open follow-ups (none started)

1. RETIRE OPERATIONS PREP (own PR, not part of the Assistant work). Bob: carrier
   statement and reprojection no longer matter. Servicing access becomes: pull up
   the signed form, confirm in Everlake that it shows ALL the customer's
   policies, mark complete, and the customer goes straight to determination.
   Findings so far: the stage is derived in `src/lib/projects/review-1035.ts`
   (`deriveStage`, `prepGateSatisfied`, `prep_status`); the gate exists only for
   documents; `POST /api/projects/[id]/review-1035/[customerId]` has a `set_prep`
   action that enforces it; the servicing-access screen navigates to Operations
   Prep on the final confirmation (`ServicingAccessClient.tsx`, and
   `operations_prep_project_id` from `api/stewardship/[id]/route.ts`); the plan
   step, labels (`project-labels.ts`), `projects.ts` ACTIVE_STAGES, and
   `composition.ts` `addProjectActivity('operations_prep', ...)` all reference it.
   NOT VERIFIED: whether the determination screen or save route checks the
   document gate itself, and `composition.ts` (~line 1849) counts failed-review
   retries under the operations_prep activity (untraced; do not orphan it). Do
   NOT delete the work function or anyone's assignments, just stop showing it.
   About 6 customers sit in operations prep today; they would move to
   determination.
2. BAD NUMBER should send the customer back into research instead of just
   marking the number bad. Bob raised it again here. It overlaps the Call-Workflow
   Redesign section above ("didn't connect" branch); handle it there.
3. "Calls due" mixes promised callbacks (a commitment, belongs left, not ranked)
   with automatic cadence retries (ordinary calling work). Decide whether to
   split them so only retries are ranked as calls.
4. Tuning once used for real: the "Next up" cap is 3 (`NEXT_UP_LIMIT` in
   `MyWorkClient.tsx`), so with several late-stage steps both research and calls
   can be hidden from the Assistant; the "or" line only appears when research is
   the top pick. Revisit if that feels wrong.
5. Known small edge: an overqualified (assist) worker with a project-scoped
   assignment sees that step hidden at zero, since only routable responsibilities
   are listed. Rare; ignore unless it comes up.

## Live facts (verified 2026-11-03; re-verify)

- The DEV copy of the Q4 1035 Review project (id `205c934d-c0fc-4047-bda3-2c45347dc4e4`,
  142 customers, 179 policies) had its `sa_status` set to match PRODUCTION:
  9 confirmed, 169 not_on_file, 1 unknown (a Protective Life policy, not an
  Everlake carrier, so it blocks nothing). Done by policy id, 178 rows, dev only.
  A later dev refresh from production resets it, which is fine. Production Verify
  is essentially complete.
- PROD work-function assignments: Angie (operations_prep, research, verify
  primary; outreach support), Dulce and Eunice (outreach primary; the rest
  project-scoped), Bob (determination primary; others project-scoped). Andy,
  Abigail, Ashley, Don, Gabe, Lucas, Nikki, Tyler have NONE, so their Assistant
  is empty. Same capability rules as before, not new.

## Notes for the next session

- The earlier Verify section says ordering "lives in FIXED_WORKFLOW_ORDER, NOT
  the ZEN band". That is still true for the Available Work PLAN order, but the
  Assistant's order now lives in `my-work-assistant.json`.
- Deploy to the preview with `--scope makal-financial-services-llc` if a bare
  `vercel deploy` says "Not authorized" (it was intermittent here too; a retry
  worked).
- Throwaway verification scripts were deleted. The jiti pattern in
  `scripts/run-dd-tests.mjs` loads real modules; `server-only` needs aliasing to
  an empty module to run the composition outside Next.


---
---

# HANDOFF (newest) — Outreach calls: business-day cadence + single ordered call list — SHIPPED TO PRODUCTION

Added 2026-11-04. All of this is COMMITTED, on `development` AND `main` (PR #34
merged, prod deploy Ready), and live at the preview. `development` is in sync
with `main`. No database migrations in any of it. This is step 2's call branch
of Servicing-Agent Capture (the one call list), plus the cadence rule and two
small My Work fixes, done this session with Bob branch-by-branch. Re-verify live
facts before relying on them.

Verification baseline this session: `npx tsc --noEmit` clean, `npm run test:dd`
273/273, `npm run build` clean.

## What shipped (three commits, one earlier policy-card PR)

1. PR #33 (earlier today): My Work Available Work research count shows ONLY
   not-yet-researched customers (the headline excludes researched-unsuccessfully;
   those are the separate "Retry contact research" step). Fixed in
   `direction.ts` (`count: unresolved - unsuccessfulCount`), `work-classes.ts`
   and `MyWorkClient.tsx` (headline = `step.count`, not `unresolvedCount`). ALSO
   in #33: the PolicyCard / ServicingAgentStatus Legos (see the separate policy-
   card note if one exists; the card now shows insured — defaults to "Owner" when
   no separate insured — servicing agent Yes/No/Unknown, coverage status in
   parentheses on the collapsed row, annual premium, rate class; rows tightened
   to ~60% height; order insured, type, carrier, issue date, face, premium, rate,
   cash value).

2. The CADENCE (settled with Bob, now the business rule in
   `src/lib/stewardship/call-cadence.ts`): spacing after each unsuccessful call is
   1, 1, 2, 4 BUSINESS days, then every 6 business days. `EARLY_CALL_SPACING_DAYS`
   was renamed `EARLY_CALL_SPACING_BUSINESS_DAYS = [1,1,2,4]` and the early stage
   now uses `addBusinessDays` (previously calendar days), so WEEKENDS ARE SKIPPED
   THROUGHOUT — an email or call on a Friday is next due Monday, nothing is ever
   due on a weekend. (Bob changed the 3rd-call wait from 3 to 4 days; everything
   else matched.) The intro email counts as the first contact and schedules the
   first call 1 business day later. Precedence unchanged: promised callback >
   employee override > computed cadence. No attempt cap; nonresponsive flag at 7
   is still recommendation-only. ONLY affects calls/emails recorded from now on;
   customers already on a hold keep their stored date.

3. ONE CALL LIST. "Call Other Reachable Customers" is retired as a concept.
   `CallPopulation` is now just `'calls-due'` (the `'available-to-call'` value is
   gone). `callPopulationOf` (`queues.ts`): a customer is owed a call iff
   effectiveQueue === 'ready-to-call' AND not engaged AND (not a future-dated
   callback). Ready-to-Email is email-first (not a call yet); Waiting-for-Response
   is the cadence hold (not callable until promoted). A FUTURE promised callback
   is NOT on the list until its date arrives (it is a commitment). The
   `available-to-call` route/page is now a redirect to `calls-due`; the client was
   renamed `CallsDueClient.tsx` (component `CallsDueClient`). Removed the second
   source/step everywhere: `composition.ts` (one `callsDue` source, derived-
   onboarding `callsDueCount`), `direction.ts` (dropped `outreach:calls-other`),
   `assistant.ts`, `work-classes.ts`, `my-work-assistant.json` (dropped rule r10),
   `types.ts` (POPULATION_META, OpenPopulation), the board route's population
   filter. My Work now shows a single "Make the calls that are due" step.

4. CALL LIST ORDER (new, in the board route `GET /api/stewardship` for the
   `calls-due` population). Pure comparator `compareCallListOrder` in `queues.ts`
   (+ test). Order: (a) due promised callbacks first (commitment), earliest
   first; (b) everyone else by `due_since` OLDEST first. `due_since` = the due
   callback date, else `follow_up_due` (scheduled next-call date), else the
   PROJECT-ENTRY date (`project_customers.added_at`) for a never-contacted
   customer. Because project-entry is always earlier than any email+1-business-day
   date, the NO-EMAIL never-contacted customers naturally lead the list without a
   special rule, and once they generate their own cadence dates everyone merges
   into one age-sorted pool. The route now selects `customer_prereviews.created_at`
   and `project_customers.added_at`; each item carries `due_since` + `is_due_callback`.
   The client preserves server order (no re-sort). SKIPPING is session-only
   (`skipOrder` is component state, resets on mount): it moves a customer to the
   back of THIS session's carousel, never changes their scheduled date or standing
   priority. Leaving to My Work and returning restarts the list in standing order.

5. BUG FIX (same commit as the order, then a follow-up commit): Skip for now did
   nothing on the never-contacted (virtual) customers. A virtual row has id null
   and is keyed `virtual:<customer_id>`; on open it is materialized to a real id,
   but its local row stays virtual, so skipping by the real id matched no row and
   the same customer re-presented (an infinite loop on the no-email tail).
   `reserveNextDirectCandidate` now returns `{ outreachId, customerId }` (was just
   the id); both `CallsDueClient` and `IntroductoryEmailsClient` capture the open
   customer_id in `openCustomerIdRef` at reserve time and use it to key skip and
   advance. IntroductoryEmails had the identical latent bug; fixed too.

## Decisions Bob made this session (business rules)

- Cadence spacing 1,1,2,4 then 6, ALL business days, weekends never due.
- One call list, not two. The reason a customer is owed a call does not change
  the workflow; only the filter that brings them in differs.
- Future promised callbacks are commitments: off the call list until their date.
- First-call definition settled: sending the intro email IS the first contact,
  so almost everyone with an email already has a scheduled call date. The only
  TRUE first calls are no-email customers (phone, no email) routed straight to
  Ready to Call. They lead the list via their project-entry date — Bob's point:
  do not keep re-dialing the same 50 while new names pile at the back.
- First calls do NOT automatically lose to every retry; they compete on age
  (oldest-owed first), which with the project-entry date puts no-email first.
- Skipping is temporary and session-scoped; it is a "not right now," not a
  priority or schedule change.

## Open / next (NOT started)

- Steps 3–5 of Servicing-Agent Capture (authorization form + wet signature,
  carrier confirmation (already built), hand-off to 1035 review). Walk with Bob.
- The "didn't connect" redesign (bad-number branch) is still its own in-flight
  effort — see the Call-Workflow Redesign section above. Bob has raised the
  bad-number-to-research point twice; handle it there.
- Verify (My Work handoff) open follow-ups still stand: retire Operations Prep
  (own PR), the "Next up" cap of 3, etc.
- NOTE for whoever revisits the My Work "calls due mixes callbacks + retries"
  follow-up (item 3 in the My Work section above): the call LIST now keeps due
  callbacks ahead of retries in its order, but they still share the one list; if
  Bob wants callbacks pulled out into Commitments entirely, that is a further
  change.

## Live facts (point-in-time, re-verify)

- Straight DB counts this session (no per-user eligibility/claim filter, so they
  do NOT match any one operator's My Work screen): ~10,159 non-test policies;
  issue_date on 9,983 (176 missing, 172 of them active); coverage_status is dirty
  (Active (Inforce)/Active/active/ACTIVE/Issued all in use — a normalization is a
  candidate cleanup, not done). insured name on 10,110; ~997 differ from
  client_name. A handful of bad-number customers now carry a replacement phone and
  will surface as owed a call — worth a look.


---
---

# HANDOFF (newest) — Stewardship module simplification: Contact Research, People We Can't Call, the Contact Search Lego — ON PREVIEW, NOT IN PRODUCTION

Added 2026-11-04 (later same day as the cadence/call-list section above). Branch
`development`, 11 commits ahead of `main`, ALL live on the shared preview
`https://bobdev.therightpathagency.com` and NONE promoted to production yet.
`development` is in sync with origin. No database migrations in any of it.
Working tree clean except untracked `.kiro/settings/`, `supabase/.temp/`, and the
spec file below. Verification baseline: `npx tsc --noEmit` clean, `npm run
test:dd` 273/273, `npm run build` clean.

The spec for this effort is `.kiro/specs/servicing-agent-capture/people-we-cant-call.md`
(the People We Can't Call branch) — read it. The broader simplification Bob
articulated (below) is NOT yet in a spec; capture it when the next screens are built.

## Bob's module model (the frame for the remaining work)

Stewardship is ONE module whose job is: take a population, get servicing-agent
status, then work the relationship to hand-off. It should DRAIN STAGE BY STAGE to
zero until a new population is pulled in:
1. PREPARATION drains to zero — verify servicing agent (one-time scrub; unknown
   must be researched, yes/not_on_file both just proceed), then find missing
   contact info (search once, found or not it leaves the list), then introductory
   emails.
2. OUTREACH — make the calls that are due; People We Can't Call for the no-phone
   ones (search for a number, else email/postal).
3. ENGAGEMENT — work active conversations once a customer responds.
4. HAND-OFF — process forms / move to determination.
Goal: Preparation reaches zero and stays there until a new population comes in.

## What shipped THIS effort (on preview)

1. POLICY CARD (PR #33, already in production from the earlier session — listed
   in the cadence section above; the Legos `PolicyCard` + `ServicingAgentStatus`).

2. PEOPLE WE CAN'T CALL — a real working screen, the no-phone branch of Outreach.
   - Board population `unable-to-call` added to `GET /api/stewardship` (route.ts):
     active outreach customer, NO usable phone, not engaged, not servicing-access,
     not refused/decided. Counted in `populationCounts`.
   - A standing Outreach sub-step on My Work directly under "Make the calls that
     are due" (`outreach:unable-to-call` in composition.ts `unableToCallRoute` +
     the standing source, direction.ts plan step, work-classes.ts class map). Shows
     even at zero.
   - Screen: `/stewardship/unable-to-call` (page + `UnableToCallClient`, the
     continuous reserve/advance pattern copied from CallsDueClient). Panel is
     `UnableToCallAction` (`panels/`), driven by a new `forceUnableToCall` prop on
     `StewardshipTask`. GATED TWO STEPS: step 1 search (the ContactSearch Lego),
     step 2 (send authorization by email AND postal) stays HIDDEN until the worker
     clicks "Searched — nothing new found" (hard gate so search happens first).
   - THE FORK: a phone found and saved on the Customer Contact card makes
     `detail.customer.phone` truthy; `StewardshipTask` computes
     `unableToCallWithPhone` and flips the panel to the guided CALL flow right
     there (forceCall), so the worker calls on the spot. No silent re-queue.
   - Email/postal reuse `ServicingFormDelivery`; the send records via the standard
     `email-sent` transition and advances.

3. CONTACT SEARCH LEGO — generalized `GatewayLookup` into a reusable search Lego,
   then SPLIT per the Lego discipline:
   - `GatewaySearchSource` (own file) — last name + policy numbers, its cap. Shown
     ONLY when the customer has an Allstate policy number (Bob: no policy = not a
     Gateway customer = nothing to search; the gate lives in ContactSearch).
   - `FastPeopleSearchSource` (own file) — full name + city/state, links to
     fastpeoplesearch.com, its cap. Always shown; works for anyone. (Melissa and
     Whitepages were dropped — Melissa is a data-append tool behind a login,
     Whitepages is premium. Fast People Search found even Vertadean from name +
     "PA" alone.)
   - `ContactSearch` (own file) — the SUBASSEMBLY that composes the sources and
     decides which show (Gateway gated on a policy number). A new lookup site
     later = a new source Lego dropped in here.
   - `contactSearchShared.tsx` — internal shared bits (copy hook, ValueRow, the
     bare-cap SourceHeader, SourceCard); NOT exported as a component.
   - Instructions are the BARE mentoring cap (MentorCapButton/Panel, no label) —
     NOT MentorGuidance (the labeled purple bar). I used the wrong one first; the
     bare cap is the app-wide pattern. Compact: tighter padding, small Copy
     buttons via a new `WorkflowButton size="sm"`.
   - `GatewayLookup.tsx` DELETED; all four call sites (ContactReviewClient,
     ResearchAction, UnableToCallAction, and the contact-review task) use
     ContactSearch now.

4. CONTACT RESEARCH SIMPLIFIED (biggest behavior change, Bob's decision):
   - It is ONE continuous carousel of the NOT-YET-RESEARCHED customers only. No
     lists, no method filter, no "No Usable Contact Information" section, no done
     screen (loops back to the first at the end; shows all-caught-up only when
     genuinely empty).
   - DROPPED the "Include previously unsuccessful research" toggle and its
     re-pass entirely. Searched-empty ("Researched, Next") marks
     `researched_unsuccessfully` and the customer LEAVES for good. The flag stays
     ONLY as a quiet history fact so they never reappear as fresh work. Rationale
     (settled with Bob): the missing detail gets another look at the natural
     moment — when the customer surfaces for a call — so a standing re-research
     list earns nothing. Missing contact info never blocks outreach; a customer
     missing a method is already worked in the outreach queues in parallel.
   - Button is "Researched, Next" / "Skip" via the shared `DoneSkipActions` Lego
     (Bob: two-buttons-on-every-screen is a reused pattern, use the Lego). The
     Next-History-Entry preview is the indicator of what will record
     ("Researched, nothing found (email, phone)" / "Contact updated (phone) ·
     still missing email" / "Contact updated (...)") — see
     `describeContactResearchSelection` in customer-history.ts.

## NEXT UP (agreed order; walk ONE screen at a time with Bob, new chat)

1. BAD-NUMBER SEARCH on the call panel (Piece 2, designed, NOT built). On a
   "number not in service" outcome in `OutreachCallPanel.tsx`, clicking bad
   number should OPEN THE ContactSearch BOX INLINE (go find a better number)
   rather than immediately ejecting. Found + saved -> stays callable, call it.
   "I can't find another number" -> record the bad number, which (BACKEND ALREADY
   DOES THIS) saves the dialed digits to history as unusable and CLEARS
   customers.phone; with no phone the customer now automatically surfaces on
   People We Can't Call (no separate eject-to-research needed — that is just old
   wording; the data already lands them right). Confirmed with Bob: one state
   (People We Can't Call) handles both the has-email and the truly-unreachable
   cases; no distinct "no way to reach at all" treatment. This is a UI change to
   the busiest panel (the record path) — do it carefully, verify the record
   transition and channel gating. `OutreachCallPanel` `badNumber` state is at
   ~line 127, the toggle ~line 564, the record grouping ~line 340.

2. Confirm the stage-drains-to-zero model end to end once bad-number is done:
   Preparation (verify -> research -> intro email) should reach zero and stay
   there until a new population is pulled.

## Still-open, smaller (deferred, not blocking)

- POSTAL = TWO SEPARATE PDFs (letter on letterhead, form on plain paper). Today
  the postal packet is the existing single combined PDF (cover + form) from
  `src/lib/servicing-agent-form.ts` (`buildPostalCoverPage`). Splitting into two
  PDFs is a small generator change, not yet done.
- PRINT-AND-MAIL QUEUE for remote staff with no printer (Dulce). Decision: generate
  the PDFs now; routing a print job to whoever does office mailing is its own
  later branch (who is the handler, real queue vs forward). Bob not worried yet.
- EMAIL WORDING rewrite: the authorization email body is the existing placeholder
  (`saEmailBody` / `saFollowUpEmailBody` in stewardship/shared.tsx). Bob to rewrite;
  do NOT invent final customer wording. Do NOT claim "we tried to call you" for a
  no-phone customer we never called.
- SYSTEM-WIDE PAGE PADDING: Bob floated tightening the light theme globally. I
  tightened at the component level (ContactSearch, the sm Copy button, slimmer
  action buttons) but did NOT touch the `WorkflowPage`/`ActionPanel` page gutters —
  that is a broad change across every light screen; do it deliberately at the
  token/shared-component level if Bob wants it, after he eyeballs the tightened
  components.
- Fast People Search state-only fallback: Bob found name + "PA" (state only, no
  city) works. Could fall back to state-only when no city is on file. Small
  enhancement, not done.

## PROMOTION

Nothing from this effort is in production. When Bob approves, promote the whole
set (the 11 commits: People We Can't Call, the Contact Search Lego split, the
Contact Research simplification, plus the My Work wiring) to `main` via one
focused PR, then apply NO migrations (there are none). dev↔prod currently differ
by these 11 commits.

## Working-rule reminders

- `development` shared; `main` is production (do not touch main except an
  authorized focused PR). Deploy to preview: `vercel deploy --force --scope
  makal-financial-services-llc` -> `vercel alias set <url>
  bobdev.therightpathagency.com --scope makal-financial-services-llc` -> `vercel
  inspect`. The `vercel deploy` URL capture occasionally printed a transient null
  in PowerShell; just re-run deploy+alias and it points correctly.
- POWERSHELL GOTCHA: the project path has `[id]` in it. `Get-Content`/`Set-Content`
  treat `[id]` as a glob and FAIL ("does not exist ... or filtered"); use
  `-LiteralPath`. The grep/read/edit tools are fine; this only bites raw PS file cmdlets.
- supabase MCP: `supabase-development` (read/write) and `supabase-prod-readonly`
  (read only). This feature is DEV-only, so verify counts against DEV, not prod.
- Live DEV fact (re-verify): Q4 1035 Review project `205c934d-...`, 142 members;
  13 have no phone — 12 in research-needed WITH an email (the People We Can't Call
  population), 1 (Vertadean Butler) with no phone, no email, no address (true dead
  end; stays in Contact Research, not on People We Can't Call).

---
---

# HANDOFF - Other-specialist restriction: SHIPPED TO PRODUCTION (2 follow-ups open)

2026-11-05. PR #35 merged to main (merge 26d693f); Vercel production deploy
dpl_3j6UYntvq9U2DVfBdn59cD4nps2c Ready on www.therightpathagency.com. Prod DB
migration `20261201000001` applied by Bob via SQL editor + ledger row (prod
ledger 124, max 20261201000001). development merged with main (in sync).
UPDATE 2026-11-06: four statuses now (unknown, clear, life_authorized,
hands_off). life_authorized and hands_off both require a named specialist; only
hands_off restricts. The specialist chip shows read-only on the customer card
(`customers/[id]`). Shipped to dev and prod (PR #37). Prod data was populated
by hand (68 life_authorized, 144 hands_off, 11,371 unknown; verified live).
There is NO picker/save route for the status yet: it is set in the database
only. Build one if staff need to edit it.
Rule module: `src/lib/customers/other-specialist.ts`.

Open follow-ups (delete this section when all are settled):
0. Prod ledger lacks `20261202000001` (the life_authorized migration; schema is
   already live in prod, the file is an idempotent no-op). The prod workflow
   run failed at dry-run: the `Production` GitHub Environment has no
   `SUPABASE_DB_URL_PRODUCTION` secret (nothing applied). A repo owner/admin
   must add it, then re-run the workflow (target=production), or Bob records
   the ledger row via SQL editor as before. Deploy note: `vercel deploy` needs
   `--scope makal-financial-services-llc` (the default scope is Bob's personal
   team and returns "Not authorized").
1. ANDY'S premium-mode migration: main now carries it as
   `20261130000002_premium_mode_modal_factor.sql` (renamed only; content
   unchanged). Prod has his column + values but NO ledger row and NO column
   comment. Deliberately left for Andy (Bob's call). Until reconciled, an
   automated prod `db push` would try to apply it (harmless: idempotent).
2. My Projects card total excludes hands-off members (e.g. 142 -> 141) while
   memberships stay intact. Bob to decide whether the card should show all
   members.

Not exercised on production yet: no staff work traffic since deploy (after
hours). The same code ran against the identical schema on development.
Production GitHub Environment still has no reviewer rule and no DB secret;
production migrations remain a SQL-editor step.