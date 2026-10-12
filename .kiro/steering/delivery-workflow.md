---
inclusion: always
---

# Delivery workflow: ship completed work to development automatically

This is the permanent default for how finished work reaches the shared
environment. It records a settled operating decision; it does not override
correctness, data safety, or the git-safety rules.

## Auto-commit and auto-push to development

When a unit of development work is complete and verified, commit it and push it
to the existing shared `development` branch and its Vercel preview as part of
finishing the task. Do NOT stop to ask for approval before committing or
pushing to `development`. Shipping completed work to the shared branch is the
expected end of the task, not a separate decision.

"Complete and verified" means the change builds and type-checks (`npm run build`
/ `npx tsc --noEmit`) and the relevant checks pass. Do not push work that fails
these.

Keep the shared branch healthy and the two developers from overwriting each
other:

- Pull/merge `development` before starting and again before pushing, so local
  work rebases cleanly onto others' changes.
- Make small, targeted commits with clear messages scoped to the change.
- Preserve other developers' changes when integrating. Never force-push,
  reset, or discard their commits to land your own.
- After pushing, verify the shared Vercel preview picked up the change.

## Never touch production without explicit authorization

- Never push to `main` and never deploy production (`vercel --prod`,
  `vercel deploy --prod`, or any equivalent) without explicit, specific
  authorization for that action.
- Promoting reviewed work to `main` is always a separate, explicitly requested
  step. Routine completion pushes go to `development` only.
- Keep `development` current with `main` by merging `main` into `development`
  when `main` advances; this is not a production action.

## Escalate only genuine decisions

Proceed autonomously on routine technical work. Pause and ask only for:

- genuine business decisions,
- material architectural, security, or data-integrity decisions, or
- real blockers you cannot resolve safely.

Everything else — including committing and pushing finished, verified work to
`development` — is handled without waiting for approval.
