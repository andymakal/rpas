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

### 1. Exact-time appointments (date + clock time)

- What's missing: Right Path records only DATE-ONLY promised callbacks
  (`stewardship_outreach.callback_date`); there is no clock time. The ZEN band
  `exact_time_commitment` (rank 1) and the fact `hasExactTimeCommitment` are
  already defined end to end, but the composition hard-codes
  `hasExactTimeCommitment: false` (`src/lib/my-work/composition.ts`), so the band
  never fires.
- UI marker: Priorities column, commitments summary ("Coming soon: exact-time
  appointments …").
- Would touch: a clock-time column/representation on the commitment, new
  normalization in the composition to set `hasExactTimeCommitment`, and feeding
  it into the existing ZEN decision (no new ranking system — the band exists).

### 2. Preferred calling windows (9–12, 12–3, 3–6, after 6)

- What's missing: there is no time-of-day window concept anywhere (no column, no
  fact, no derivation). The only "mode" notion is `WorkMode` ('quiet' vs 'calls')
  in `src/lib/my-work/guidance.ts`, which is a kind of effort, not a scheduled
  window.
- UI marker: Priorities column, commitments summary ("Coming soon: preferred
  calling windows …").
- Would touch: new data to capture a customer/commitment's preferred window,
  normalization, and presentation. Whether it also influences ZEN ordering is a
  product decision to make when it is designed.

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
