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
`ContactPhone`, `ContactDob`, `ContactAddress`, `ContactAlert`). NEW this
session: `CallMentorCap` (the standalone graduation cap beside the "Call <name>"
instruction; fed-in mentoring), `TalkPathCard` (collapsible, controllable
talk-path box; label + body), and `CallOutcomeChoice` (the four universal
reached-call outcomes as a fixed 2x2 — Advance/Decline top, Defer/Divert bottom;
fed per-situation labels + a select handler, host owns each outcome's action).
The Outreach Call Panel (`OutreachCallPanel` in `StewardshipClient.tsx`) is the
outbound call panel of the call workbench and now uses all three.

Contact card self-heals representation ON VIEW (silent `{ field: 'cleanup' }`
PATCH: address case/whitespace + `email_availability` NULL→available when a
usable email exists; computed from stored values, no history, once per customer
per session). `email_availability` backfill is DONE on BOTH dev and prod
(verified identical). Runbook `private/email_availability_backfill.sql`
(gitignored, idempotent) — do not re-run.

## Next steps

- CALL PANEL not finished: work through the Outreach Call Panel step by step
  (each reach/branch step). Resume on `development`, reusing the Legos above.
- CALL-OUTCOME SITUATION TABLE (agreed design, NOT built yet): a ZEN/GoRules
  table keyed on the call SITUATION supplies, per situation AND per universal
  outcome (Advance/Decline/Defer/Divert), all of:
  (1) the button LABEL (e.g. Advance → "Agreed to authorize" on a servicing
      call, "Agreed to an appointment" on a referral),
  (2) the MENTORING content ("what you're doing"), fed to `CallMentorCap`,
  (3) the TALK PATH content ("how you explain it"), fed to `TalkPathCard`,
  (4) the downstream ACTION the outcome runs, and
  (5) the HISTORY ENTRY that action records ON COMPLETION — its wording and the
      resulting status move (e.g. Advance → "authorization form sent, moved to
      Waiting for Form"; Decline → "recorded not interested, outreach stopped").
  Division of labor stays fixed: ZEN picks label/content/action/history over
  normalized facts; TypeScript resolves prose + time/names and performs the
  action. CONTENT SEAMS already in place: `CallOutcomeChoice` takes `labels`;
  `CallMentorCap`/`TalkPathCard` take fed-in content; the panel currently
  resolves this situation's content locally (`callMentorBody`,
  `SERVICING_CALL_SCRIPTS.opening`) — that local resolve is what the table
  replaces. IMPORTANT: history is written at the outcome's COMPLETION (form
  actually sent, callback saved, not-interested confirmed), never on button
  press — do not write history from a half-finished branch. `Divert` has NO
  wired action/history yet (placeholder); the table will give it its own
  diversions, which may route into their own rules.
- STORED-DISPOSITION MODEL (pending decision, the "do both" item): decide
  whether the RECORDED disposition becomes the four-category model
  (advance/decline/defer/divert + situation as context) or stays the concrete
  action with the four categories as a UI/label layer only. TODAY it stays
  concrete: the panel maps advance→agreed, defer→callback, decline→not-interested
  when reporting the history preview (`decisionDisposition` in
  `OutreachCallPanel`), and `divert` reports none. This choice affects history +
  reporting; settle it before/with the table.
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
