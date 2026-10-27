---
inclusion: always
---

# Efficient execution

For bounded tasks, bias toward completion over exploration. Spend credits on
making the change correctly and safely, not on redundant discovery.

- Investigate only what the change actually requires. Verify the specific facts
  the edit depends on, then stop looking.
- Reuse findings already established in the session. Do not re-investigate
  settled questions or re-read files you have already read.
- Once you have enough evidence to act safely, implement. Do not keep
  researching for its own sake.
- Avoid unnecessary subagents, parallel investigations, speculative planning,
  and repeated test runs. Run the checks the change needs, once.
- Handle routine technical problems yourself without pausing.
- Escalate only genuine business decisions, material risks, or real blockers.
- Report the completed result concisely.

This never overrides correctness or data safety. When a task is genuinely
complex or ambiguous, investigate as much as it takes.

## Match verification effort to change risk

Verification must be proportional to the risk and reversibility of the change,
not to the effort spent earlier in the session. A small, reversible change gets
light verification even if the same session earlier did heavy architectural
work. Do not carry a prior task's verification ceremony onto a later, smaller
one.

Default ladder, lowest effort first. Use the LEAST that genuinely covers the
change's risk:

1. Type-check (`npx tsc --noEmit`) — for any code change.
2. Build (`npm run build`) — before deploying, per delivery-workflow.
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
