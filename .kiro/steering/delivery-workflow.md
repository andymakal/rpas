---
inclusion: always
---

# Delivery workflow: deploy mechanics for the shared preview

The delivery decision is stated once, authoritatively, in `AGENTS.md`
(§Working discipline): completed, verified work is committed, pushed to
`development`, and deployed to the shared preview automatically without pausing;
only `main`/production actions need explicit authorization. Read that section
for the policy. This file does not restate it; it records only the deploy
mechanics that carry it out, so there is a single source of truth.

These mechanics are shared reference for whatever tool is doing the deploy, not
tool-specific instructions.

## How this project actually deploys (verify before relying on it)

This Vercel project is NOT wired to GitHub auto-deploy. A `git push` to
`development` does NOT update the preview on its own. The preview is published
with the Vercel CLI, and the stable address is an alias you point at the new
deployment:

```
vercel deploy --force          # Preview build; prints the new deployment URL
vercel alias set <new-url> bobdev.therightpathagency.com
```

`https://bobdev.therightpathagency.com` is a STABLE alias, not a per-commit URL.
Never hand out or document a per-commit `*.vercel.app` URL as "the preview":
those are immutable and freeze on one old build, which is exactly how a reviewer
(or a test user such as Dulce) ends up staring at stale code. Always point people
at the stable alias.

Confirm after aliasing: `vercel inspect https://bobdev.therightpathagency.com`
must report the deployment id/url you just created.

## The sequence, once work is complete and verified

1. Commit it with a clear, scoped message.
2. Push it to the shared `development` branch.
3. Deploy the current tree to Preview (`vercel deploy`).
4. Point `bobdev.therightpathagency.com` at that deployment and verify it with
   `vercel inspect`.

## Keep the shared branch and preview healthy

- Pull/merge `development` before starting and again before deploying, so local
  work integrates cleanly onto others' changes.
- Preserve other developers' changes when integrating. Never force-push, reset,
  or discard their commits to land your own. Deploy from a tree that already
  contains their latest, so the shared preview never regresses their work. If
  integrating safely is not possible, stop and escalate the conflict.
- The preview runs against the Supabase `development` clone, never production
  (see `PREVIEW_DEPLOYMENT.md`). Deploying there is safe, reversible review work.
