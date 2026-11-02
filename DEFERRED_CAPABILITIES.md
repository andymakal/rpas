# Deferred capabilities

Durable tracking of functionality that is intentionally NOT built yet, so the
decision travels with the repo and the work is not lost. Each entry says what is
missing, where the UI currently shows a discreet "Coming soon" marker, and what
building it would touch. Nothing here is implemented; do not treat a "Coming
soon" marker as a claim that no such work exists — only that Right Path does not
record it yet.

When one of these is implemented, remove its entry here and its "Coming soon"
marker in the code.

## My Work — three-column redesign follow-ups

The My Work page (`src/app/(internal)/my-work/MyWorkClient.tsx`) was moved to the
approved three-column layout (Priorities / Available Work / Practice Direction),
driven entirely by existing resolved data (`MyWorkState`, `deriveMyWorkDirection`,
the GoRules ZEN ordering). The following capabilities the redesign anticipates
are not yet represented in the data model, so they are surfaced only as discreet
"Coming soon" notes and are recorded here.

### 1. Exact-time appointments (date + clock time) — IMPLEMENTED (Calendar Layer A)

Implemented. A promised callback can now carry an EXACT time, which creates a
first-class `calendar_blocks` appointment owned by the acting producer and
surfaces on their My Work Priorities column (the `exact_time_commitment` band
now fires from real data; `src/lib/my-work/composition.ts` sets
`hasExactTimeCommitment` from the producer's upcoming appointments rather than
the former hard-coded `false`). The appointment is stored as an absolute instant
plus the stated IANA zone and emits an `.ics` invite the operator sends from
Outlook. See `CALENDAR_DESIGN.md` (Layer A). Remaining calendar work (claim /
reassign / escalate; declared working hours and slot booking) is Layers B–C
there, not here.

### 2. Preferred calling windows (9–12, 12–3, 3–6, after 6)

- Partially done: the window is now CAPTURED on a promised callback (the Defer
  precision picker's "Time of day" option writes days × bands into
  `stewardship_outreach.action_context.callbackWindows`), but it is NOT yet
  SURFACED or acted on — no priority, no ordering, no window-aware due logic. The
  Priorities column still shows a discreet "Coming soon" note for it.
- UI marker: Priorities column, commitments summary ("Coming soon: preferred
  calling windows …").
- Would touch: a read of the stored window, presentation, and the product
  decision of whether an open/passed window influences due/ordering (the IPF
  contact-opportunity model is the reference). This is Calendar Layer C territory.

### 3. Standing practice expectations (beyond Today's Focus)

- What's missing: the only management direction that exists is Today's Focus
  (temporary, expiring, reorder-only) plus durable capability assignments
  (`producer_work_functions`, surfaced as `routedAs` primary/support). There is no
  durable "agency expectations" concept.
- UI marker: Practice Direction column, Expectations card ("Coming soon: standing
  agency expectations …"). The column already shows the REAL Today's Focus and
  the employee's REAL responsibilities derived from capability routing.
- Would touch: a new data model for standing expectations, a management-facing
  way to set them, a read, and surfacing. Net-new; scope as its own feature.
