# Right Path Calendar — design

Status: draft for review. No code yet. This document defines the calendar as a
first-class spine that workflows hang off of, not a feature bolted onto any one
workflow. It is scoped to decisions and shapes; it is not an implementation
plan.

## 1. The one idea this rests on

The relationship is the durable center of Right Path. People's time is its own
first-class spine. Workflows — stewardship outreach, reviews, new policies,
service work, investments, life, in any combination — hang off the calendar.
Nothing hangs off a single workflow.

Concretely, the dependency arrow points one way:

- Time is the resource. A producer's day is blocks of their own time.
- Capability is the filter. Tiers say what a person is allowed to pick up.
- Workflows are the demand. They compete for free time by priority.

Eunice is the test case. She is Andy's primary assistant; when his work runs
dry she jumps into the outreach/responsibility queue. Her availability is hers —
a block of her day — not a slot owned by Andy's project or by the queue. A
project-scoped model cannot express "Eunice has two free hours, point them
wherever they are useful." A calendar of people's time can. So the calendar
must be person-time, never project-time.

## 2. What already exists (verified against development, not memory)

- There is already an `appointments` table in the development database, and it
  is empty (0 rows). Its shape is the OLD model, the one this design replaces:
  `household_id` NOT NULL, a single `assigned_producer_id` (no tiers, no claim),
  `referral_id` / `case_id` back-references, `scheduled_at` as a bare instant
  with NO stated-zone column, `counted_for_agency` (a scorecard/SPIFF concept),
  and `duration_minutes`. This table makes the appointment hang off a
  referral/case and exist to be counted for the agency. That is precisely the
  inversion we are correcting. Decision needed in §8.
- The Triage screen can stamp `appointment_date` + `appointment_time` on a
  `cases` row and download an `.ics` to the operator's own machine. It has no
  "who with," never surfaces on anyone's My Work, and lives only in the old
  referral-intake flow. It is not a calendar.
- The IPF work overlay is already landed on Right Path and gives us most of the
  people-and-claim machinery:
  - `producers` carries capability facts (`is_life_licensed`,
    `is_securities_licensed`, `is_registered_support_staff`, `is_management`).
    It has NO timezone column.
  - `producer_work_functions` is the capability assignment: `primary`,
    `support`, `overqualified`, optionally project-scoped. This is our resource
    tiers — but it has no ORDER among supports (no secondary/tertiary rank).
  - `stewardship_outreach` already carries the optional claim
    (`claimed_by_producer_id`, `claimed_at`) and `action_context` jsonb.
  - `project_escalation_contacts` is an ordered, tiered escalation table.
- The shared time module `src/lib/time` already models the three clocks we need
  (actor / customer / one absolute instant shown per participant) and is
  explicitly intended for "scheduling, callbacks, appointments." We extend it;
  we do not invent a parallel time system.
- Luxon is already a dependency (IANA-zone-aware instant math). No `.ics`
  generator or slot-math library is installed yet.

## 3. Timezones and DST — the non-negotiable invariant

Four US zones are live in the book of business: Eastern (Andy), Central (Bob),
Pacific (new agents), Mountain (Colorado customers). Every appointment has two
clocks that both matter and differ:

- The customer's clock: "a 9:00 appointment" for a Pennsylvania customer is 9:00
  Eastern — the commitment as the customer experiences it.
- The producer's clock: the same moment is 8:00 Central for Bob, 6:00 Pacific
  for a new agent. This is what shows on each person's My Work and calendar.

The invariant, which Luxon supports but only if we follow it exactly:

1. Capture a wall clock PLUS the IANA zone it was stated in (e.g. `9:00` +
   `America/New_York`). Never a bare time.
2. Resolve to one absolute instant immediately, using the IANA zone, so DST is
   resolved correctly for THAT date (we just moved to standard time; spring will
   move back). Never store a bare time, never hard-code an offset like −5.
3. Store the instant (as `timestamptz`) AND the stated IANA zone (so we can
   always show the customer their own stated time and re-derive on DST edges).
4. Render per viewer: each person sees the instant on their own clock.
5. The `.ics` invite carries the zone too, so the customer's device lands it at
   the right local time.

This is the one area where a quiet mistake is invisible until someone shows up
an hour early. Exact-time appointments and the zone/DST resolution therefore get
a focused unit test (a justified, named exception to the light-verification
default), covering: cross-zone rendering, a standard↔daylight boundary date, and
Mountain/Pacific customers.

A related gap: `producers` has no timezone. A producer's working hours (§6) are
meaningless without one. Storing each producer's home IANA zone is part of this
work.

## 4. The core entity: a time block (the calendar spine)

One first-class entity: a block of a person's time. Everything else references
it; it references no workflow as an owner.

Essential shape (names illustrative, to be finalized in implementation):

- `id`
- `producer_id` — WHOSE time this block is. NULLABLE. A held block (someone's
  own time) always names its producer. A customer appointment may start with a
  null producer: unclaimed, offered to an eligible group (§5). Null never means
  "nobody is responsible" — see "Ownership before a claim" below.
- `starts_at` / `ends_at` — absolute instants (`timestamptz`).
- `stated_time_zone` — the IANA zone the block was stated in (customer's zone
  for a customer appointment; the producer's own zone for self-blocked time).
- `kind` — the three real shapes:
  - `appointment` — a commitment with a customer at a time.
  - `busy` — held time that BLOCKS booking (lunch, out of office, Tyler in
    class). An appointment may not overlap it.
  - `reservation` — held time set aside to BE FILLED with a kind of work
    (Bob's "reviews 8:00–noon"). Appointments of the matching purpose belong
    INSIDE it and do not conflict with it; see §4a and §6.
- `purpose` — on a `reservation`, which work it is reserved for (e.g. reviews),
  so the conflict check (§4a) knows what may be booked inside it. Null otherwise.
- `customer_id` — OPTIONAL. Present for an `appointment`, null for `busy` /
  `reservation`. The calendar does not require a customer.
- `source` — OPTIONAL, non-owning reference to the workflow that created the
  block (e.g. a stewardship callback, a review, a new-policy appointment). A
  reference, never an owner. The block outlives and is independent of it.
- `title` / `notes`, `location` (phone, in-person, etc.).
- Claim/assignment fields — see §5.
- `status` — proposed / confirmed / kept / missed / cancelled / rescheduled.

Why its own entity and not a column on `stewardship_outreach`: a held block has
no outreach row, no customer, and no workflow. Eunice's free time and Bob's four
review hours are time blocks with no customer. Hanging the calendar off outreach
cannot represent them. (This reverses an earlier suggestion in the conversation
to store the appointment on the outreach row; §1 is why.)

### Ownership before a claim (who is responsible when `producer_id` is null)

A customer appointment exists the moment it is promised — before anyone takes
it. "Unclaimed" is a real, first-class state, and it must never mean the
commitment fell on the floor. So a block always has an owner of the TIME or an
owning GROUP, never nothing:

- A `busy` / `reservation` block always names a `producer_id` — it is literally
  that person's time.
- A customer `appointment` with `producer_id` null is owned by an eligible GROUP
  (a capability tier, §5) plus an ordered escalation ladder. The group is
  responsible until one person claims it; if nobody does within its runway, it
  escalates up the ladder and surfaces as an alert. Claiming sets `producer_id`.

So "responsible before a claim" = the eligible tier + the escalation ladder, not
a person. This is exactly what the claim/escalate machinery is for.

### §4a. Conflict is kind-aware, not a blanket overlap

Two blocks overlapping in time is not automatically a conflict; it depends on
kind:

- An `appointment` overlapping a `busy` block for the same producer IS a
  conflict — reject it.
- An `appointment` overlapping a `reservation` of the MATCHING `purpose` is NOT
  a conflict — it is the reservation being used as intended (a review booked
  into "reviews 8:00–noon").
- Two `appointment`s for the SAME producer at overlapping instants IS a conflict
  — the double-booking guard (enforced from Layer A, §9).

This kind-aware rule is the single definition both the Layer A booking guard and
the Layer C slot math read.

## 5. Who works it — capability tiers + claim + reassign + escalate

This is mostly the IPF overlay re-pointed at time blocks. Four verbs:

- Claim: a block offered to an eligible group is taken by one person. Reuse the
  existing claim shape (`claimed_by_producer_id` + `claimed_at`), on the block.
- Release: the holder returns it to the pool. Exists for outreach; same action.
- Reassign: the holder (or an authorized person) hands the block to a NAMED
  person — "I talked to Lucas, here you go." This does NOT exist today (today you
  can only release to the pool). New, small: a claim that sets the holder to
  someone else, gated by who may do it.
- Escalate: when no eligible person takes it, it climbs an ORDERED ladder and
  surfaces as an alert to the next tier. The ordered table exists
  (`project_escalation_contacts`); turning "nobody took it → Bob, you're up"
  into an actual alert is new surfacing, not a new model.

The resource tiers, from the roster Bob described, map onto
`producer_work_functions` assignment types — with one addition:

- Advanced life producer: Bob primary, Andy support.
- Investment: Andy primary, Bob support.
- Intermediate life: Ashley primary, Bob support, Andy support (further back).
- Entry-level life: trainees (Tyler, Lucas) primary, Ashley support, Bob
  support, Andy distant backup.
- Operations (servicing-access callbacks): Gabe, Dulce, Yunus, Angie primary;
  climbs to Bob; Bob routes to Ashley / trainees / himself.

The gap: today `support` is flat — there is no "secondary before tertiary." The
roster needs ORDER among supports (Bob before Andy). Options: add a rank to
support assignments, or drive the ladder from the ordered
`project_escalation_contacts`. To be decided in implementation; flagged here as a
real, small schema question.

The capability CATALOG also needs the graded producer levels (advanced /
intermediate / entry life, investment) as work functions. Today it has
`determination` (life-gated, seeded to Bob) but not the tiers. This is catalog
data within the existing table and license gate, not new architecture.

Eligibility vs availability are two different reads, and both are needed for
"I need someone at 9, who's available?":

- Eligibility (who COULD): a read over `producer_work_functions` in tier order.
  Already possible.
- Availability (who CAN at 9 Friday): declared working hours minus booked time.
  This is §6 — the new part. "Tyler and Lucas are in class, Ashley comes in at
  10, Bob is free" is availability, not eligibility.

## 6. Availability and slot-packing (the genuinely new capability)

Two halves, both reading/writing the time-block spine:

- Declared working hours: each producer says when they work, in their own zone
  ("reviews 8:00–18:00 Central"), and can carve intent ("fill these 4 hours with
  reviews"). Requires the producer timezone from §3 and a working-hours
  representation.
- Slot computation: turn working hours into bookable slots of a given duration
  (15 / 20 / 30 min), subtract already-booked blocks (kind-aware, §4a: a
  matching-purpose `reservation` is bookable, a `busy` block is not). This is
  mechanical interval arithmetic over Luxon instants.

The routing question and the meeting question are DIFFERENT, and the default is
the routing question:

- Routing — "who can take this at 9?" is a per-person FILTER over the eligible
  tier: keep each eligible producer who is individually free at that instant,
  in tier order. ANY one of them can take it ("Tyler and Lucas are in class,
  Ashley comes in at 10, Bob is free → offer to Bob"). This is the normal case.
- Meeting — "when are these people ALL free together?" is an INTERSECTION of
  several producers' free time. This is the exception, only for a commitment
  that genuinely needs more than one person in the room. Do not use intersection
  for ordinary routing; it would wrongly require everyone free at once.

Division of labor (unchanged from how Right Path already works): the slot-math
library + Luxon own the mechanical arithmetic; ZEN owns the DECISIONS (who is
eligible, the escalation tier, priority ordering). We do not move business rules
into a UI library, and we do not hand calendar math to ZEN.

## 7. Off-the-shelf pieces (buy before build)

Confirmed by a current survey. We assemble from focused primitives; we do NOT
adopt a whole booking platform.

- Timezone + interval math: Luxon — already installed. The customer-clock
  resolution, window checks, and "working hours minus booked" are Luxon.
- Date / day-slot pickers: shadcn Calendar (on react-day-picker, zone-aware) —
  already in our stack family. This is the DOB-style precision picker's UI.
- `.ics` generation: add `ical-generator` (actively maintained, RFC 5545
  correct, carries timezone). Do not hand-write an ICS serializer.
- Slot/availability brain (Layer C): adopt a small, dependency-light,
  license-clean slot-math library (candidates surveyed: `timeslottr`, a
  zero-dependency TS library that also intersects multiple calendars; "The
  Booking Kit," a headless TS primitive with team scheduling). Choose one at
  implementation time after a license + maintenance check.
- Resource-timeline UI (optional, Layer C): an MIT, shadcn-installable resource
  scheduler (producers as rows, blocks as draggable events, built-in
  overlap/conflict prevention) is available if we want the visual board.

Ruled out: a full self-hosted booking platform (Cal.com went private and
relicensed in April 2026; forks exist). A platform is a second app with its own
auth/DB and public booking pages — it violates one-app/one-database and the
public-booking-page pattern is the third-party-scheduler model Allstate forbids.
Email itself stays on the existing mailto/Outlook contract (generate, operator
sends, operator confirms it was sent); the calendar emits an `.ics` attachment
through that same path. Internal calendars are NOT bound to Outlook the way
email is, so an in-app calendar that emits `.ics` is permitted.

## 8. Decisions (reviewed; 8.1 still needs Bob's explicit yes)

A second review (ChatGPT) agreed with the recommended answers below. 8.2 and 8.3
are settled; 8.1 still needs Bob's explicit yes because it touches a named table
and the agency-count concept.

1. The existing empty `appointments` table. It is the wrong shape (workflow-owned,
   household-required, single assignee, scorecard-oriented, no stated zone).
   DECISION (confirmed by Bob): a clean new spine table `calendar_blocks`,
   leaving the old `appointments` table untouched for now. It is empty, so
   nothing is lost. The old table's agency-count intent, if still wanted, is
   migrated deliberately later. NOT overloading a table built for a different
   purpose.

   How IPF did it, and why we diverge on PLACEMENT but reuse the SHAPES: IPF has
   NO standalone calendar or appointments table. In IPF an appointment is a
   STATE of the current next-action on a work episode (`episode_next_actions`):
   `action_state = 'scheduled'` with a `scheduled_at timestamptz` for an exact
   time, `waiting_followup` with `followup_at` for an in-window commitment; the
   stated customer zone lives in `action_context.sourceTimezone`; exact-vs-inexact
   is the `callbackHasTime` / `rescheduleHasTime` boolean; one `is_current` row
   with `superseded_at` for history; "who" is the episode's
   `assigned_team_member_id`. IPF can hang time on the work item because its
   `work_episodes` IS a universal work spine. Right Path has no single universal
   work object — stewardship outreach is just one workflow — which is exactly why
   the calendar must be its own spine here. So we LIFT IPF's field vocabulary
   (instant as `timestamptz`; stated zone stored alongside; `hasTime` flag;
   jsonb soft-facts bag; supersede-don't-delete) onto `calendar_blocks`, and we
   DO NOT copy IPF's placement of time on the work item. Same shapes, different
   home — consistent with §1 (the calendar is the spine).

2. Support ordering (§5): SETTLED — order lives WITH the capability assignment
   (`producer_work_functions`) when it applies across projects, i.e. add a rank
   to the assignment rather than forcing the ladder through
   `project_escalation_contacts`.

3. Producer timezone (§3): SETTLED — store each producer's home IANA zone. It is
   in scope; a producer's working hours are meaningless without it. Low-risk
   additive column.

## 9. Build order (reviewable slices, each usable alone)

- Layer A — precision promised callback: on the Guided Call Workbench Defer path,
  the DOB-style precision picker (exact time / days×slots availability / any time
  that day), resolved on the customer's clock. An EXACT time creates a time-block
  appointment (§4) and surfaces on the assigned producer's My Work via the
  dormant rank-1 `exact_time_commitment` ZEN band. Days×slots and any-time stay
  as callback availability (not booked blocks). Adds `ical-generator` for the
  emitted invite. Smallest complete piece; depends on §8.1 (spine table) and
  §8.3 (producer zone) for the exact-time case.
  - MUST include a double-booking guard (§4a): when an exact-time appointment
    names a producer, reject it if that producer already has an overlapping
    `appointment` or `busy` block. This is one query against the spine, not slot
    finding — full availability/slot search is Layer C — but without it the
    first slice can promise the same person to two customers at once. The guard
    ships in Layer A; the richer "find an open slot" search waits for Layer C.

- Layer B — appointments as claimable work: claim / release / reassign / escalate
  over time blocks, with the tier roster and the ordered ladder. The
  operations-queue-pops-for-Gabe/Dulce/Yunus/Angie flow and the climb-to-Bob live
  here. Reuses the claim + capability + escalation tables; adds reassign-to-named
  and escalation alerts.

- Layer C — the calendar proper: declared working hours, availability,
  duration-aware slot packing, the per-person routing filter ("who among the
  eligible tier is open at 9?", §6), and the resource-timeline board. Adopts the
  slot-math library (and optional resource-scheduler UI). The "reserve my 4
  review hours and fill them" capability (a `reservation` block that accepts
  matching-purpose appointments inside it, §4a). Multi-attendee intersection is
  here too but is the exception, not the routing default.

Each layer is shippable to the dev preview on its own. Verification scales with
risk: light for UI/label slices, but the zone/DST math in Layer A and the slot
arithmetic in Layer C get real tests.

## 10. Steering to add once this direction is confirmed

Two durable principles surfaced in this discussion and are not yet stated
explicitly in steering; propose adding them:

- Prefer off-the-shelf: adopt and adapt a proven, license-compatible library over
  building bespoke, in the same spirit as using shadcn components and ZEN for
  rules. A library must pass a license + maintenance-health check before
  adoption.
- The calendar is the spine: the relationship is the center; people's time is a
  first-class spine; workflows hang off the calendar, never the reverse. Time is
  the resource, capability is the filter, workflows are the demand.
