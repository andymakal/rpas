# Access-protected review preview

A Vercel Preview deployment that Bob and Andy open to review in-development work.
It shows real production *information* through the Supabase `development` branch
(a persistent, with-data clone of production), while the real production database
is physically unreachable from the preview.

THE shared preview URL — stable, bookmark this one:
`https://bobdev.therightpathagency.com`

This is a stable Vercel alias, not a per-commit URL. It is the single address
for all in-progress review, including signing in as other users (Dulce, etc.).
Each `vercel deploy` creates a new immutable `*.vercel.app` deployment URL;
those are per-build and freeze on one commit, so never treat one as "the
preview". After deploying, re-point the stable alias at the new deployment
(see "Redeploying the preview" below) and everyone keeps using the one address.

## Why this shape

The app talks to Supabase with the service-role key (`createAdminClient`), which
bypasses RLS. There is no database-level read-only mode the app can switch into,
and the write surface is large: server actions (`submit-referral`, `log-case`),
dozens of `/api/*` routes, and 3 cron routes. So "read-only against production"
cannot be enforced safely in application code alone.

Pointing the preview at the development clone removes the risk at its source:
any write the UI triggers lands on the disposable clone, not production. External
side effects are disabled too (`ANTHROPIC_API_KEY` unset on Preview, dummy
`CRON_SECRET`, and Vercel scheduled crons only run on Production deployments).

As defense-in-depth, `src/lib/supabase/admin.ts` refuses to construct a
service-role client against the production ref (`erbvssfcglhnelfelbfi`) unless
`VERCEL_ENV === 'production'`. A preview accidentally wired to production keys
hard-fails instead of silently writing to the real database.

## How it is configured (done)

- Project: `makal-financial-services-llc/right-path-agency-system`.
- Preview-scoped environment variables point at the development branch
  (`buoztddompdsuccfcixk`), set via `vercel env add <NAME> preview`:
  - `NEXT_PUBLIC_SUPABASE_URL` = the development-branch URL
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = development-branch anon key
  - `SUPABASE_SERVICE_ROLE_KEY` = development-branch service-role key
  - `CRON_SECRET` = `preview-disabled`
  - `DATABASE_URL` = development-branch URL
  - `ANTHROPIC_API_KEY` is intentionally left unset on Preview.
- Production-scoped variables were left untouched (still the production ref).
- Deployment Protection (Vercel Authentication) is on for all deployments except
  the production custom domain, so preview URLs require signing in with a member
  of the Makal Vercel team.
- `.env.preview.example` documents the Preview variables (placeholders only).

## Redeploying the preview

This project is NOT connected to GitHub auto-deploy; a `git push` does not
update the preview. Publishing is two steps: deploy, then move the stable alias
onto the new deployment. From the repo root, with the Vercel CLI logged in to
the Makal team:

```
vercel deploy --force                                   # preview build; prints <new-url>
vercel alias set <new-url> bobdev.therightpathagency.com  # point the stable address at it
vercel inspect https://bobdev.therightpathagency.com    # verify it reports <new-url>
```

Deploy from a working tree that already contains other developers' latest
(merge `main`/`development` first) so the shared preview never regresses their
work. Note: `vercel alias` does not accept `--yes`.

Do not run `vercel --prod` / `vercel deploy --prod`: that targets production.

## Verification (last run)

- Anonymous `GET /` returns `302` to `https://vercel.com/sso-api` (auth gate),
  sets `_vercel_sso_nonce`, and carries `X-Robots-Tag: noindex`.
- Preview `NEXT_PUBLIC_SUPABASE_URL` / anon key resolve to the development ref
  `buoztddompdsuccfcixk`; production env still resolves to `erbvssfcglhnelfelbfi`.
- Development branch holds representative real data (customers ~11.4k, cases
  ~1.7k, service_policies ~10.1k, agencies 149, agents 135). No SSN column exists;
  `date_of_birth` is displayed masked as `MM/xx/YYYY`.
- No `vercel.json` cron is attached to the preview deployment.
