---
inclusion: always
---

# IPF is Right Path's functional blueprint

The IPF integration decisions are stated once, authoritatively, in `AGENTS.md`
(§IPF integration): what IPF is to Right Path, what to reuse and how, the
operating guardrails the integration must preserve, and what must never be
imported. Read that section for the decisions. This file does not restate them;
it records only the reference detail that supports them, so there is a single
source of truth rather than two copies to keep in step.

## Reference detail (supports the AGENTS.md decisions)

- Shared-queue model: the IPF queue read to reuse is `list_initial_outreach_queue`
  (structural candidacy only, scoped to no individual). Optional per-callback
  claiming lives on the callback's `action_context` (`claimedByTeamMemberId`),
  deliberately distinct from episode assignment: an unclaimed exact-time callback
  surfaces to every eligible worker as claimable, and once claimed it is that
  worker's commitment.
- Daily Direction, directive behavior: the engine surfaces what is actionable,
  holds future work until its runway, separates must-do from optional, and
  recognizes when nothing needs attention. (The rule JSON, engine, and
  fact/candidate shape to reuse are named in AGENTS.md.)
- Assistant vs Mentoring: one tells the worker what is next and why; the other
  teaches. They stay distinct surfaces; do not merge them.
