# Right Path development environment: setup complete

The durable development environment is built and verified. Bob/Kiro now develop
on Git `development` + Supabase `development`. Production was not modified.

## Git

- Branch `development`, created from the latest `origin/main` (commit `0087232`,
  the customer-card / financial-review work), with all 16 stewardship +
  migration commits from `fix/migration-replay-ordering` merged in cleanly.
- The pending uncommitted work is preserved on `development` as working-tree
  changes (service_policies review-initiative migration, the service-policies /
  policy-import route changes, the proxy cron passthrough, the
  servicing-recovery components). Nothing is committed yet; commit when ready.
- Safety tag `backup/pre-development-setup` marks the pre-change tip `b3409fc`.
- `npx tsc --noEmit` passes clean.

## Supabase development branch

- Ref `buoztddompdsuccfcixk`, name `development`, `persistent = true`,
  `with_data = true`, `ACTIVE_HEALTHY`, branched from production
  `erbvssfcglhnelfelbfi`.
- Real production data cloned: service_policies 10,120, customers 11,407,
  cases 1,668, agencies 149.
- Only the genuinely-pending source-controlled migrations were applied (not a
  blind replay of the whole chain). The clone's baseline already carried
  production's schema as of 2026-10-07, and the drift-reconcile migration was
  already present, so the four applied were:
  cases_referral_origin, stewardship_prereview, stewardship_outreach, and
  service_policies_review_initiative_fields.
- Verified: Kiro can SELECT / INSERT / UPDATE / DELETE / apply migrations;
  a full Stewardship lifecycle (prereview + outreach on a real cloned customer,
  board join, state transition, cascade cleanup) works; the new
  service_policies review-initiative fields and constraints are present.

## Local runtime

- `.env.local` points only at the development branch:
  URL `https://buoztddompdsuccfcixk.supabase.co`, the branch anon key, and the
  branch service-role key (JWT role=service_role, ref=buoztddompdsuccfcixk).
  No production credentials.
- `npm run dev` runs against development on http://localhost:3000.
  `/login` returns 200; protected routes (`/stewardship`, `/policies`) correctly
  redirect to `/login` for an unauthenticated request, which confirms the proxy
  session logic runs against the development branch. Sign in through the browser
  to exercise the authenticated Stewardship UI.

## Production

- Untouched. Verified directly: production has no review-initiative columns, no
  referral_origin, no stewardship tables, and still exactly 10,120
  service_policies rows. The only production access used was read-only
  inspection.

## Cleanup done

- Deleted the old Supabase `stewardship-preview` branch (ref
  `mwlojnidabdofeokyplv`). The project now has only `main` and `development`.
- Deleted the stale CLI linkage file `supabase/.temp/linked-project.json`
  (it pointed at the unrelated `btnlascpntcnyvmrfwrm` project).
- Removed the legacy restricted personal access token from the Windows user
  environment (`SUPABASE_ACCESS_TOKEN`, the `sbp_fc1e...` token). It is no longer
  present in user, machine, or process scope. This token was read-only and had
  been silently shadowing the CLI OAuth session.
- Unrelated Supabase projects were left alone.

## MCP config: done (two-entry posture in place)

`.kiro/settings/mcp.json` already carries the two-entry posture: a read/write
development entry and a read-only production entry for inspection. No action is
needed here; this section is kept as a record of the intended shape.

```json
{
  "mcpServers": {
    "supabase-development": {
      "url": "https://mcp.supabase.com/mcp?project_ref=buoztddompdsuccfcixk&features=database,debugging,development",
      "disabled": false
    },
    "supabase-prod-readonly": {
      "url": "https://mcp.supabase.com/mcp?project_ref=erbvssfcglhnelfelbfi&read_only=true&features=database,debugging,development",
      "disabled": false
    }
  }
}
```

Notes:
- Both entries use OAuth (no token, no `headers`). On save, Kiro drives the
  browser sign-in via dynamic client registration; the session you already
  authorized is reused.
- `project_ref` scoping disables the account/branching tools. That is correct
  for day-to-day work. If you later need to create or manage branches again,
  temporarily use an unscoped entry
  (`https://mcp.supabase.com/mcp?features=account,branching,database,debugging,development`),
  do the branch operation, then switch back to the scoped development entry.
- The development entry is read/write by omitting `read_only`. The production
  entry keeps `read_only=true`, so production is inspectable but never writable
  as the default dev connection.

## Going forward

- Develop on Git `development` + Supabase `development`.
- As Andy changes production, pull/merge `main` into `development`, then apply
  any new source-controlled migrations to the development branch (and rebase the
  Supabase branch on production if you want its schema baseline refreshed).
- Development data is a production snapshot, not live replication.
- Source-controlled migrations move schema. Intentional production data
  corrections/backfills are a separate production operation, only when you
  explicitly request them.
