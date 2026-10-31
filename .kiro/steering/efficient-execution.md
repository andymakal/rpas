---
inclusion: always
---

# Efficient execution

For bounded tasks, bias toward completion over exploration. Spend credits on
making the change correctly and safely, not on redundant discovery.

## Deliver the simplest complete solution to the agreed outcome

Deliver the simplest complete solution that satisfies the agreed outcome —
complete and unattended, not a partial first installment you expect the user to
extend. "Simplest" constrains how you build: no unrequested structure, systems,
or abstractions. "Complete" constrains what you deliver: the whole agreed
outcome, verified and shipped. When the outcome itself is genuinely ambiguous,
resolve it with one decision up front rather than guessing or delivering a
fragment.

- Investigate only what the change actually requires. Verify the specific facts
  the edit depends on, then stop looking.
- Reuse findings already established in the session. Do not re-investigate
  settled questions or re-read files you have already read.
- Once you have enough evidence to act safely, implement. Do not keep
  researching for its own sake.
- Avoid unnecessary subagents, parallel investigations, speculative planning,
  and repeated test runs. Run the checks the change needs, once.
- Handle routine technical problems yourself without pausing.
- Escalate only genuine business decisions, material architectural departures,
  or consequential business, data-integrity, or security tradeoffs. When you do,
  state the tradeoff in one or two sentences and recommend an option; do not ask
  the user to design the implementation or approve routine technical steps.
- Report the completed result concisely.

This never overrides correctness or data safety. When a task is genuinely
complex or ambiguous, investigate as much as it takes.

## Recovering from your own mistakes

When your own error causes rework, fix it directly. Re-verify exactly what the
error invalidated — if a mistake made earlier evidence unreliable, re-check that
specific evidence — but do not treat your own slip as a reason to reopen
unrelated settled questions or re-read files the error did not touch. Report the
material consequences of the mistake (what was wrong, what it affected, what you
re-checked); do not narrate routine recovery steps.

## A new table or component is a review signal, not an approval gate

A new table, a new component or subsystem, or a new cross-module responsibility
is a signal to check scope, not an automatic stop. If it is ordinary
implementation of the agreed outcome within the established architecture, build
it autonomously. Pause and surface it first only when it materially expands the
agreed outcome, departs from or changes the established architecture, or
introduces a consequential business, data-integrity, or security tradeoff. A run
of small requests does not, by accumulation, authorize new architecture: when a
sequence of bounded asks starts to add a new table or subsystem, that is the
moment to surface the expansion as one decision, not after building it.

## Match verification effort to change risk

Verification must be proportional to the risk and reversibility of the change,
not to the effort spent earlier in the session. A small, reversible change gets
light verification even if the same session earlier did heavy architectural
work. Do not carry a prior task's verification ceremony onto a later, smaller
one.

Match checks to the change's actual failure risk. Reuse results already valid
from this session rather than re-running them; recheck when a change or an error
invalidates them, and do not run checks unrelated to what changed. A type-check
or a successful build confirms the code compiles and types line up — it does NOT
prove runtime behavior, so when a change's risk is behavioral, confirm the
behavior by the cheapest sufficient means (a careful read of the changed path,
or a look at the deployed preview) rather than assuming compilation settled it.

Default ladder, lowest effort first. Use the LEAST that genuinely covers the
change's risk:

1. Type-check (`npx tsc --noEmit`) — for any code change.
2. Build (`npm run build`) — before deploying, per delivery-workflow. Delivering
   to the preview already builds, so let that serve as the build check rather
   than repeating a build you have already run and not invalidated.
3. A careful read of the edited lines plus the specific failure mode the change
   could introduce.
4. For UI/layout/visual changes: deploy to the preview and tell the user exactly
   what to glance at. A human look at the preview is the normal, cheap way to
   confirm appearance — prefer it over automated browser proof.

The following are EXPENSIVE and OPT-IN. Do them ONLY when (a) the change alters
runtime behavior that cannot be confirmed by reading or a quick preview look,
AND the behavior is hard to get right (e.g. a measuring/scroll/focus/async
interaction with a real convergence risk), OR (b) the user explicitly asks for
automated proof. Otherwise do not:

- Rebuilding Storybook plus scripting a headless browser (Playwright).
- Writing a throwaway verification script and iterating on it.
- Running multiple rounds of browser tests.
- Context-gathering subagents or broad re-reads for a change whose blast radius
  is already understood.

Examples of changes that are LOW-risk and must NOT trigger the expensive tier:
renaming a label or button, swapping a Tailwind/style token or width value,
changing copy, a one-line conditional, adding an optional prop with a
backward-compatible default. Type-check, build, deploy, and name what to eyeball.

If you believe a change genuinely warrants the expensive tier, say so in one
sentence and let the user decide BEFORE spending it, rather than proceeding and
explaining afterward. When unsure whether verification is proportional, do less
and ask.
