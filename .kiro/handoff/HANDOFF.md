# Handoff — current state (2026-10-31)

Live, in-flight status only. Permanent rules live in steering
(`.kiro/steering/*`) and `AGENTS.md` and load automatically; this file does NOT
restate them. Completed/shipped efforts are deleted from here once done — if it
works, is in steering, or is just how the system runs now, it does not belong
here. Keep this short.

## Where things stand

The whole recent session is SHIPPED to production (PR #24; `main` at `522b950`;
Vercel prod deploy Ready). `development` is in sync with `main`. The `bobdev`
preview and production run the same code against different databases (dev clone
vs prod). That promotion was a CODE deploy, not a schema migration (zero
`supabase/migrations/` files changed). Only Bob works on `development` (it is
Bob's dev line; the `bobdev` alias reflects that).

Shared Legos that now EXIST — reuse, do not rebuild (all in
`src/components/workflow/`, exported from the barrel): `CallButton`,
`SkipForNowButton`, `CallContextCard`, `HistoryNotesField`, `Divider` /
`DividerStack`, plus the earlier contact-field set (`PersonName`, `ContactEmail`,
`ContactPhone`, `ContactDob`, `ContactAddress`, `ContactAlert`). The Outreach
Call Panel (`OutreachCallPanel` in `StewardshipClient.tsx`) is the outbound call
panel of the call workbench.

Contact card self-heals representation ON VIEW (silent `{ field: 'cleanup' }`
PATCH: address case/whitespace + `email_availability` NULL→available when a
usable email exists; computed from stored values, no history, once per customer
per session). `email_availability` backfill is DONE on BOTH dev and prod
(verified identical). Runbook `private/email_availability_backfill.sql`
(gitignored, idempotent) — do not re-run.

## Next steps

- CALL PANEL not finished: work through the Outreach Call Panel step by step
  (each reach/branch step). Resume on `development`, reusing the Legos above.
- HISTORY column rebuild (deferred, agreed): the right column (Next history entry
  + Additional notes + Customer history) still displays inconsistently; rebuild
  it as one cohesive customer-history panel Lego rather than patching it.

## Open loose ends (small, not urgent)

- `status-attention-*` classes are used in `StewardshipClient.tsx` but no such
  token exists (latent no-color bug, predates this work; new code uses the real
  amber `status-known-*`). Clean up when that file is next touched.
- History-event and policy-summary row lists intentionally keep the subtle
  `surface-border-strong` hairline (list rows, not section boundaries) — leave.
- 14 damaged prod phone numbers need a human correct/clear decision (e.g. Travis
  Veillon `(000) 000-000`, some `0-XXX-XXXX` service_policies rows, Andy Makal's
  producer number). List in `private/phone_digits_backfill.md`.
- Stale orphaned GitHub workflow `migration-replay.yml` ("Migration Replay
  (temporary)") is still registered though its file is gone from all branches —
  inert; Bob may delete it.
- Dev `service_role` key was once echoed to a transcript (same key already in
  `.env.local`, dev-only, low severity) — rotate when convenient (dev project →
  Settings → API → rotate JWT secret, then update `.env.local` + Vercel Preview
  env, redeploy preview).
- Pre-existing lint warning in `ContactReviewClient.tsx` (`Cannot access refs
  during render` at the direct-open landing effect) — does not fail the build;
  clean up when that screen is revisited.
