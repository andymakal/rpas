# Servicing-Agent Capture — the whole workflow

Status: GROUNDWORK. This document establishes the shared foundation before we
walk the workflow branch by branch. It is not yet a full acceptance-criteria
spec. We agree on the ground here first, then design each branch one at a time
(the way the branches genuinely reveal themselves as we work through them, not
all brainstormed up front).

## What this workflow is, and why it is the real value

Right Path works the books of business and back books of the partner (Allstate
P&C) agencies. Most of those are EXISTING STATE customers — people who already
hold policies and relationships the agency inherited or transferred, and whom
nobody is proactively taking care of.

The IPF premise, stated plainly: the value is not in the new referrals the
agency sends. It is in all the people who are ALREADY customers and are going
unserved. (IPF doctrine, paraphrased for compliance: a stewardship relationship
begins when the practice deliberately accepts responsibility for an entity, and
it can begin through a book transfer; it stays alive even with no sale and no
recent activity; silence does not end it. The relationship is the durable thing,
not the case or the transaction.)

Servicing-agent capture is how Right Path earns the operational RIGHT to steward
those inherited relationships. When Allstate's life business moved to Everlake,
the agency lost servicing-agent access to these policies — it is not listed as
the servicing agent, so it cannot help with questions or servicing. The capture
workflow restores that access: it does not change the policy or the coverage. It
requires the customer's authorization (a wet/ink signature), then the carrier's
confirmation. Only once we are the recognized servicing agent can the real
stewardship work begin.

So the workflow's job, end to end: take a customer we inherited but cannot yet
service, reach them, get them to authorize us as servicing agent, get the
carrier to confirm it, and hand off a now-serviceable relationship.

## Why capture is the gate, not just good service (the revenue exercise)

Capture is not only a servicing courtesy. It is the GATE that unlocks a revenue
exercise, and the whole workflow exists to open that gate.

Under Everlake we cannot even see a policy, pull an annual statement, or rerun
an illustration/reprojection unless we are the servicing agent. (Allstate's old
system let an agent look at a policy regardless; Everlake does not.) So without
capture we are blind: no statements, no values, no ability to model anything.

Once we ARE the servicing agent, the real work opens up. The driving example is
a project to take one agency's book of PERMANENT policies, capture servicing
agent on each, then review every policy for a 1035 exchange: a declining UL, or
a policy we can make more efficient, can be replaced with a fresh illustration
on a better policy. A policy with a lot of cash value pays well. This is a
revenue-generating exercise as much as a servicing one, and it is simply
impossible to even begin the comparison (existing policy vs a new illustration)
until capture is done. The Q4 1035 Review project is the live instance of this.

This is why the ORDER matters: capture first, because it is the only thing that
makes the policy visible and modelable; the review/1035 work is downstream and
depends entirely on it.

## The asset we are working

- These are STATE customers already on the books (via book/back-book transfer),
  not leads. A relationship already exists; we are formalizing our ability to
  serve it.
- The unit of work is the CUSTOMER relationship, not a policy or a case. A
  customer may hold several policies; servicing-agent status is tracked per
  policy, but the outreach is to the person.
- The durable center is the customer. Queues, the outreach item, and the
  per-policy status are work AROUND that center, not the center itself (matches
  Right Path's "customer relationship is the durable center" decision and the
  calendar-is-the-spine orientation).

## How servicing-agent capture is built TODAY (verified as-built, the baseline)

This is the current implementation, confirmed in code. It is the ground we build
on; it is NOT a proposal.

Two things carry the state:

1. `service_policies.sa_status` per policy — the servicing-agent lifecycle on
   each policy: `unknown` -> (form sent, `sa_form_sent_at` stamped) -> `confirmed`
   (carrier confirmed). Confirming one policy never changes another; each policy
   keeps its own status.
2. `stewardship_outreach` — the outreach work item that drives reaching the
   customer, with a queue state machine (`src/lib/stewardship/queues.ts`).

The outreach queue lifecycle (as-built):

- Intake routing ("trust but verify" — use existing contact info without
  pre-verifying): email on file -> Ready to Email; no email but a phone ->
  Ready to Call; no usable contact -> Research Needed.
- Ready to Email -> send the introductory servicing-agent email -> Waiting for
  Response (follow-up window, 2 days) -> lapses to Ready to Call.
- Ready to Call -> the Guided Call Workbench (the outbound call). Outcomes:
  - Reached + agreed -> authorization form sent -> Waiting for Form.
  - Reached + promised callback -> callback captured (date, or exact-time
    appointment on the calendar) -> resurfaces as a due call.
  - Reached + not interested -> explicit, reversible stop (never auto-closed).
  - Didn't reach (no answer) -> attempt recorded, call cadence rolls the next
    attempt, Waiting for Response.
  - Didn't reach (bad number) -> Research Needed; the dialed number is preserved
    in history and `customers.phone` is cleared. (THIS is the branch the earlier
    draft focused on, and the one the Harley case showed is too blunt — see
    "Known defect" below. It is one branch of the whole, not the whole.)
- Waiting for Form -> signed authorization returned -> submitted to carrier ->
  Waiting for Carrier -> carrier confirms -> `sa_status = 'confirmed'` per
  policy; outreach ends only once every request policy is confirmed.

Settled rules this workflow already enforces (keep them):

- No automatic lost/closed state. Every terminal-looking outcome is an explicit
  human-recorded value. The system recommends; a human decides.
- Calls are to customers, not carriers.
- The authorization needs a wet (ink) signature; Right Path never sends the
  customer-facing email/text itself — it generates, the operator sends from
  Outlook/Allstate rails, then confirms (the generate -> send -> confirm
  contract).
- No attempt cap and no auto-termination on non-response; cadence just rolls
  forward and a human decides to stop.

## Known defect already surfaced (one branch, carried forward)

The "didn't reach -> bad number" branch collapses four distinct outcomes (no
answer; Do-Not-Call on this number; truly dead number; a better number exists in
Gateway) into one yes/no, and on "bad" it immediately clears the only number on
file and ejects the customer to a separate Contact Research pass. The real case
(Harley Anderson: a 610 that was Do-Not-Call, not dead, with a usable cell also
on file) showed the operator should be able to recover in ONE sitting. This is a
real branch to redesign, but it is downstream of the groundwork — we will reach
it when we walk the call branch.

## Verified ground truth (live PRODUCTION, checked this session)

Re-verify before relying on these; they are a point-in-time read.

- `service_policies` holds 10,151 non-test policies. `sa_status` distribution:
  `unknown` 10,065, `confirmed` 79, `not_on_file` 7.
- `sa_status` is a TEXT column, default `'unknown'`, with a CHECK constraint
  allowing exactly three values: `unknown`, `confirmed`, `not_on_file`.
- Every import/create path writes `sa_status = 'unknown'` (policy-import,
  book-import via cases, service-requests, repair-policy-links). `confirmed` is
  written ONLY at carrier-confirm, at the very end of the capture lifecycle.
- `not_on_file` is a LATENT value: it is in the CHECK constraint and 7 rows carry
  it, but NO current code path writes or reads it as part of capture. It is
  effectively unused today.
- The population is already loaded in production. One active project exists:
  "Q4 1035 Review" — 142 customers, 179 policies, of which 177 `unknown` and 2
  `confirmed`. This is the live instance of the capture-then-1035 exercise.
- `product_type` values are heterogeneous ("UL", "Universal Life", "PERM",
  "Life Insurance", "Term", "Term Life", "Whole Life", annuities, brokerage...).
  Permanent-vs-term classification already matters: `onboardingCompleteForPolicies`
  keys on `isPermanent(product_type)`, and the 1035 exercise targets permanent
  cash-value policies.

## RESOLVED groundwork decisions (from Bob)

- G1/G2 Starting point + front stage: the population (customers + policies) is
  ALREADY LOADED in production. There is no import stage to build and it is OUT
  OF SCOPE. The workflow's TRUE first step is upstream of outreach: VERIFY, per
  policy, that we are NOT the servicing agent. That verification is what turns a
  loaded policy into capture work.
- G3 One workflow: capture is ONE workflow regardless of how the book came to us
  (inherited, uploaded, assigned). No per-source branching.
- G4 Naming: "stewardship" stays as the internal/technical name. An
  operator-facing themed label, if wanted, is a design-step choice. Non-blocking.

## THE FIRST STEP — verify we are not the servicing agent (the groundwork gap)

This is where the workflow actually begins, and the current model cannot express
it. Today `sa_status` has only three values and the live lifecycle uses just
two of them: everything starts `unknown` and the only forward move is to
`confirmed` at the very end. There is NO state for "we checked and we are NOT the
servicing agent."

That is the gap. `unknown` currently conflates two very different things:

1. "We have not looked yet" (truly unknown), and
2. "We looked in Everlake and confirmed we are NOT the servicing agent" (verified
   not-SA — this policy is genuine capture work).

The first step of the whole workflow is to SPLIT those apart: an operator (or a
check) verifies against Everlake whether we are the servicing agent, and records
the result. A policy verified as not-SA is what legitimately becomes capture
work and feeds the outreach lifecycle already built. A policy found to already
have us as SA needs no capture (it can go straight toward review). The latent
`not_on_file` value is the obvious candidate to carry "verified not the
servicing agent," but whether to reuse it, rename it, or add an explicit
verified/ checked-at fact is a DESIGN decision for the first branch, not settled
here.

This first step is also what makes the downstream numbers honest: a worklist of
"policies to capture" should be the VERIFIED not-SA set, not the raw 10,065
`unknown` (which silently includes policies nobody has checked and policies that
may already be ours).

## Scope of THIS spec (the whole workflow), in order

Capture, end to end, for the already-loaded population:

1. VERIFY not-SA (the first step above) — establish, per policy, that we are not
   the servicing agent, so a true capture worklist exists. THIS is where we start.
2. Reaching the customer — email and the Guided Call Workbench.
3. Getting authorization — the form, the wet-signature return.
4. Carrier confirmation — per-policy `sa_status` -> `confirmed`.
5. Hand-off — a captured (now-serviceable) relationship becomes review/1035 work.

We write acceptance criteria branch by branch, in this order, starting with
step 1. Each branch is its own pass; we do not specify all five up front.

## RESOLVED — step 1 decisions (from Bob) and the settled state model

The three `sa_status` values now have exact, settled meanings:

- `unknown` = nobody has checked yet.
- `confirmed` = we checked, we ARE the servicing agent.
- `not_on_file` = we checked, we are NOT the servicing agent (verified not-SA).

`not_on_file` is Andy's naming; it reads oddly (it is not about missing
paperwork) but it is the "verified not-SA" state. Reuse it as-is. NEVER surface
the literal "not_on_file" to an operator — show it as "Not the servicing agent"
or similar. No schema change: the three existing states cover the whole model.

Resolved answers:

- Q1 — The verification act is MANUAL and EXTERNAL. There is no data feed. An
  operator logs into the Everlake Agent Portal, uses Contract Look-Up, pastes
  the policy number, hits Search. Found a contract -> we ARE the SA. "We couldn't
  find a contract with that number" -> we are NOT. The operator returns to Right
  Path and records yes/no. The loop is: copy policy number -> search Everlake ->
  click yes/no in Right Path.
- Q2 — PER POLICY. Being SA on one of a customer's policies does NOT grant
  visibility into the others, so each policy must be checked individually.
  Recorded per policy; surfaced/worked per customer (a customer may have several).
- Q3 — NO durable who/when fact is needed. Bob sees no reason he would ever go
  back and look, and `not_on_file` already means "somebody checked." So: no
  schema addition, no required history mark. Flipping the status IS the record.
  (A customer-history line like "Checked Everlake — not servicing agent" is
  OPTIONAL and omitted unless Bob later wants it.)
- Q4 — NOT a 10,000-policy sweep. Verification happens WHEN A CUSTOMER IS PULLED
  INTO A PROJECT. The project's policy list is the worklist (e.g. the 179
  policies in Q4 1035 Review). Same mechanism answers the inbound case: when a
  customer calls assuming "Andy's team handles this," we check and can say "we
  are not on file yet; we have to run the process first."
- Automatic confirm: once a policy runs through capture and the carrier
  confirms, the system flips it to `confirmed` on its own. This already works
  (carrier-confirm sets `sa_status = 'confirmed'`); no new behavior needed.

## Architectural finding that shapes step 1 (verified in code)

`src/lib/projects/workflows.ts` derives the `servicing_agent_onboarding` phase:
COMPLETE when every applicable PERMANENT policy is `confirmed`, OPEN otherwise.
It treats `unknown` and `not_on_file` IDENTICALLY — both are "not confirmed," so
both read as onboarding OPEN/actionable. The 1035 `review_preparation` phase is
gated on onboarding completion.

Consequence today: the moment a customer enters a project, every permanent
policy at `unknown` is already treated as active capture/outreach work — BEFORE
anyone has verified whether we even need to capture it. Step 1 inserts the
missing distinction: an `unknown` policy is VERIFY work, not yet capture work;
only a `not_on_file` (verified not-SA) policy is real capture/onboarding work;
a `confirmed` policy needs nothing.

So step 1 is a VERIFY gate that sits in front of onboarding:

    unknown  --(operator checks Everlake)-->  confirmed  (we're SA; done, no capture)
                                       \-->  not_on_file (verified not-SA; now capture work)

Design note (for the design pass, not settled here): the onboarding/review
completion predicate may need to treat an `unknown` permanent policy as "not yet
verified" rather than "onboarding open," so the capture/outreach worklist is the
VERIFIED not-SA set, not raw `unknown`. This is the one real code change step 1
implies beyond the verify UI itself.

## Step 1 requirements — Verify servicing-agent status (per policy, in a project)

### Requirement 1.1 — a per-policy verify action on the project surface

User story: As an operator working a project, I want to verify each policy's
servicing-agent status against Everlake and record it, so the project's capture
worklist reflects what we actually need to pursue.

Acceptance criteria:

1. WHEN a customer is in a project THEN each of their non-test policies SHALL
   show its servicing-agent status as one of: Not checked (`unknown`), Not the
   servicing agent (`not_on_file`), or Servicing agent (`confirmed`) — never the
   raw `not_on_file` literal.
2. WHEN a policy is Not checked THEN the operator SHALL be able to record the
   Everlake result as a simple yes/no ("Are we the servicing agent?"), with the
   policy number shown and easily copyable for pasting into Everlake Contract
   Look-Up.
3. WHEN the operator records "No, not the servicing agent" THEN the policy's
   `sa_status` SHALL be set to `not_on_file`.
4. WHEN the operator records "Yes, we are the servicing agent" THEN the policy's
   `sa_status` SHALL be set to `confirmed` (we already have access; no capture
   needed for that policy).
5. The verification SHALL be recorded per policy; verifying one policy SHALL NOT
   change any other policy's status.

### Requirement 1.2 — verified not-SA is what becomes capture work

User story: As an operator, I want only the policies we've verified as not-SA to
appear as capture/outreach work, so I'm not chasing authorization on policies
nobody has checked or policies we already service.

Acceptance criteria:

1. A permanent policy at `unknown` SHALL be treated as VERIFY work (needs an
   Everlake check), NOT as active capture/outreach work.
2. A permanent policy at `not_on_file` SHALL be the policy that feeds the
   capture/outreach lifecycle (email/call to get authorization).
3. A policy at `confirmed` SHALL require no capture work.
4. The project's servicing-agent phase SHALL distinguish "not yet verified"
   (unknown remaining) from "verified, capture in progress" (not_on_file being
   worked) from "access established" (all applicable confirmed), rather than
   collapsing unknown and not_on_file together.

### Requirement 1.3 — no new permanent record required

User story: As the practice, I don't need a durable audit of who checked when;
the status value itself is the record.

Acceptance criteria:

1. Recording a verification result SHALL NOT require any new schema (no
   who/when columns, no mandatory history row); setting `sa_status` is the
   record.
2. The system SHALL NOT auto-close or auto-advance anything from a verification
   result beyond setting the policy's `sa_status`; downstream work still follows
   the existing capture lifecycle and the human-decides rule.

## Remaining branches (unchanged order; later passes)

2. Reaching the customer — email + Guided Call Workbench (incl. the
   didn't-connect redesign).
3. Getting authorization — the form, the wet-signature return.
4. Carrier confirmation — per-policy `sa_status` -> `confirmed` (already built;
   auto-flip confirmed above).
5. Hand-off — captured relationship becomes review/1035 work.
