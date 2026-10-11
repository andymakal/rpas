---
inclusion: always
---

# IPF is Right Path's functional blueprint

IPF (the `bobpfromm/ipf-stewardship` repository) is the functional blueprint for
Right Path's operational and assistant overlay. Its established capabilities are
intended to become part of Right Path. This supersedes any earlier framing that
treated IPF as merely an idea source, a reference, or a spec to paraphrase.
Where IPF has working code and settled patterns for a capability Right Path
needs, reuse that actual functionality rather than re-deriving it.

IPF is a blueprint, not a merge. Right Path is and remains one application and
one database. We take IPF's capabilities, patterns, and rule models into Right
Path's existing architecture; we do not adopt IPF's separate database, its
multi-tenancy, its authentication, or any structure that conflicts with the
operating decisions below.

## What to reuse from IPF, and how

- GoRules ZEN (`@gorules/zen-engine`) and IPF's rule models (`src/rules/*.json`)
  are the intended engine for deterministic recommendations in Right Path. The
  IPF division of labor carries over verbatim: ZEN owns the deterministic
  decision matrix (eligibility, placement, priority bands); TypeScript owns
  normalization, time math, capability resolution, and the operator-facing
  prose. ZEN is fed normalized facts and never queries the database.
- IPF's shared-queue model is queue-owned work (`list_initial_outreach_queue`,
  structural candidacy only, scoped to no individual) with OPTIONAL per-callback
  claiming that is deliberately distinct from episode assignment: a claim lives
  on the callback's `action_context` (`claimedByTeamMemberId`), not on the
  generic episode assignee. An unclaimed exact-time callback surfaces to every
  eligible worker as claimable; once claimed it is that worker's commitment.
  This is the model to reuse for Right Path's shared queues.
- IPF's promised-callback and preferred-window commitment handling, its
  capability-based routing (work functions, primary/support), and its
  always-visible recommendation plus separate coaching are the functional
  targets. Reuse the IPF logic and rule JSON; re-host the data on Right Path's
  existing tables.
- The Daily Direction Assistant is an implemented, GoRules-powered IPF feature,
  not merely doctrine. A ZEN decision (`src/rules/next-best-action.json`) picks
  the single Next Best Action from a fixed priority order (imminent fixed
  commitment, then active work, then missed commitment, then owned Intake, then
  owned Outreach, then other owned work, then Support, then open capacity).
  `src/lib/daily-direction-engine.ts` normalizes facts and resolves time labels,
  `src/composition/daily-direction.ts` assembles candidates from existing reads,
  and the Assistant presence renders the ready result. Reuse that engine, the
  rule JSON, and the fact/candidate shape; re-home the candidate reads on Right
  Path's own records. Its behavior is the directive function: surface what is
  actionable, hold future work until its runway, separate must-do from optional,
  and recognize when nothing needs attention.
- Assistant and Mentoring are two distinct surfaces and must stay distinct. The
  Assistant is a system-state explanation of what to do next (the teal
  `AssistantNotice` / `HardCommitmentNotice` treatment, driven by the Daily
  Direction verdict); Mentoring is separate coaching prose. One tells the worker
  what is next and why; the other teaches. Do not merge them.

## Right Path operating decisions that integration must preserve

These are settled. IPF capability enters Right Path in a form that honors them;
anything in IPF that conflicts is adapted or left behind, never imported as-is.

- One Right Path application and one Right Path database. No second database, no
  cross-app data plane.
- Shared work queues, not routine individual assignment. Work is surfaced to
  whoever is eligible; claiming is optional and lightweight (a soft lease at
  most), never a routing-by-assignment default.
- Employee capabilities determine eligibility for work. Capability, not a
  personal in-box, decides who can act on an item.
- Project ownership and escalation are project-specific. The Projects module
  owns its own ownership and escalation semantics; do not replace them with a
  generic per-item assignment model.
- Today's Focus influences priority but never overrides a customer commitment. A
  promised callback or a scheduled appointment outranks focus-based ordering.
- GoRules provides deterministic, attributable recommendations. Recommendations
  inform the worker; they do not silently take consequential action.
- Human judgment controls consequential business decisions. The system surfaces
  and recommends; a person decides. No automatic lost/closed/terminal state.
- The customer relationship is the durable center. Episodes, queues, projects,
  and reviews are work around that relationship, not a replacement for it.

## Do not import from IPF

- IPF's separate database or any multi-database topology.
- IPF's `practice_id` multi-tenancy. Right Path is single-tenant (one agency).
- IPF's authentication and permission model (`practice_memberships`,
  `ipf_require_practice_membership`, `ipf_check_permission`, the
  `ipf_command_owner` role). Right Path keeps its own auth: internal admin
  (no `agency_members` row, `app_role = 'admin'`) via the service-role client,
  agency users via session + RLS.
- Any IPF architecture that assumes multiple practices, a separate command-owner
  role chain, or a different tenancy or identity boundary than Right Path's.

When an IPF capability is entangled with any of the above, lift the capability
(the rule model, the state logic, the recommendation shape) and re-home it on
Right Path's existing tables, auth, and single-tenant assumptions.
