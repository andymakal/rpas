---
inclusion: always
---

# Delivery workflow: ship completed work to the shared preview automatically

This is the permanent default for how finished work reaches the shared
environment. It records a settled operating decision; it does not override
correctness, data safety, or the git-safety rules.

The canonical, cross-tool/cross-branch statement of this delivery default lives
in `AGENTS.md` (§Working discipline). This Kiro steering file is the operational
companion: it carries the exact command sequence and the preview mechanics and
defers to AGENTS.md for the decision itself.

## Completion means available on the shared preview, not merely pushed

The single shared development preview is `https://bobdev.therightpathagency.com`.
It is where Bob and Andy review in-progress work, INCLUDING testing as other
users such as Dulce. A unit of work is not "done" until the change is live at
that address. Pushing to GitHub is necessary but NOT sufficient.

### How this project actually deploys (verify before relying on it)

This Vercel project is NOT wired to GitHub auto-deploy. A `git push` to
`development` does NOT update the preview on its own. The preview is published
with the Vercel CLI and the stable address is an alias you point at the new
deployment:

```
vercel deploy --force          # Preview build; prints the new deployment URL
vercel alias set <new-url> bobdev.therightpathagency.com
```

`bobdev.therightpathagency.com` is a STABLE alias, not a per-commit URL. Never
hand out or document a per-commit `*.vercel.app` URL as "the preview" — those
are immutable and freeze on one old build, which is exactly how a reviewer (or
Dulce) ends up staring at stale code. Always point people at the stable alias.

Confirm after aliasing: `vercel inspect https://bobdev.therightpathagency.com`
must report the deployment id/url you just created.

## Auto-commit, push, deploy, and alias — without pausing

When a unit of development work is complete and verified, do all of the
following as the end of the task, without stopping for approval:

1. Commit it with a clear, scoped message.
2. Push it to the shared `development` branch.
3. Deploy the current tree to Preview (`vercel deploy`).
4. Point `bobdev.therightpathagency.com` at that deployment and verify it.

"Complete and verified" means the change builds and type-checks (`npm run build`
/ `npx tsc --noEmit`) and the relevant checks pass. Do not deploy work that
fails these.

Keep the shared branch and preview healthy and the developers from overwriting
each other:

- Pull/merge `development` before starting and again before deploying, so local
  work integrates cleanly onto others' changes. Keep `development` current with
  `main` by merging `main` into `development` when `main` advances.
- Make small, targeted commits with clear messages scoped to the change.
- Preserve other developers' changes when integrating. Never force-push,
  reset, or discard their commits to land your own. Deploy from a tree that
  already contains their latest, so the shared preview never regresses their
  work. If integrating safely is not possible, stop and escalate the conflict.
- The preview runs against the Supabase `development` clone, never production
  (see `PREVIEW_DEPLOYMENT.md`). Deploying there is safe, reversible review
  work.

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

Everything else — including committing, pushing, deploying, and aliasing
finished, verified work so it is live on the shared preview — is handled
without waiting for approval.
