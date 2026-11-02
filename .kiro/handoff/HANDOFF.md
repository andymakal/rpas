# HANDOFF — Right Path Calendar

Temporary task state for an in-flight effort (per AGENTS.md §Working discipline).
Keep current while the calendar effort is active; delete when it is complete.
NOT permanent steering.

Last updated by the session that shipped Calendar Layer A (the precision
promised-callback + exact-time appointments) and the two-axis callback rework.

## Where things stand

Branch: `development` (in sync with origin). Everything below is committed,
pushed, and LIVE on the shared preview `https://bobdev.therightpathagency.com`.
Nothing touched `main`/production.

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
