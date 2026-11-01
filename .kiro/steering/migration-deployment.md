---
inclusion: always
---

# Database migration deployment: how schema changes reach each database

Right Path has one Supabase database per environment: DEVELOPMENT
(`buoztddompdsuccfcixk`) and PRODUCTION (`erbvssfcglhnelfelbfi`). Schema changes
travel to those databases through tracked migration files and a GitHub Actions
workflow, never by hand-editing a remote database. This file is the routine;
`.github/workflows/supabase-migrations.yml` is its implementation.

## The rule

A schema change is a committed SQL file under `supabase/migrations/`. It is
applied to a database only by the workflow, which runs `supabase db push`
against that database's connection string. Do not alter a remote schema out of
band (SQL editor, ad-hoc `psql`, direct dashboard DDL): an untracked change is
drift, and the workflow's drift guard will fail the next deploy until the ledger
and the files agree. The migration files are the source of truth; reconcile the
ledger to the files, never the reverse.

## Development — automatic

Commit the new migration and push to `development`. When the push touches
`supabase/migrations/**`, the workflow applies the committed migrations to the
DEVELOPMENT database automatically. A failed migration makes `db push` exit
non-zero, which fails the job and stops the deploy; it does not partially apply
and move on. Fix the migration, commit again, push again. This is the only
routine path for dev schema changes and it needs no manual step.

Creating a migration (run locally, from the repo root):

```
supabase migration new <short_snake_case_name>
# edit the generated file under supabase/migrations/
```

Keep each migration idempotent-friendly and forward-only; do not rewrite or
renumber a migration that has already been applied to any database.

## Production — explicit, authorized promotion only

Production is NEVER touched by a push. Promotion is a manual, authorized action:

1. First land the change on `development` (so it is proven against the
   production-like clone).
2. Promote the code to `main` via the normal focused pull request (see
   AGENTS.md); merging to `main` deploys the application to production.
3. Apply the migrations to the production DATABASE by manually running the
   `Supabase migrations` workflow (GitHub → Actions → Run workflow) with
   `target = production` and typing `production` in the confirm box. The run is
   gated by the `production` GitHub Environment, whose required reviewer must
   approve before it executes, and it prints a `--dry-run` preview before it
   applies. This explicit, reviewer-gated dispatch is the authorization.

Do not add a push/merge trigger that applies migrations to production. The
manual dispatch + Environment approval is deliberately the only production path.

## What this workflow does NOT do

- It does not touch Vercel or the application deployment. Hosting is unchanged;
  the preview and production apps deploy exactly as before.
- It does not copy or refresh customer data. Data refreshes stay on demand (the
  logical dump/restore runbook), never scheduled.
- It does not run on a schedule. Nothing here is a daily job.

## One-time setup (GitHub repository secrets)

The workflow authenticates to each database with a stored connection string.
These are standard database connection strings (Session pooler, with the
database password), set once as repository secrets. Only an owner can read these
passwords from the Supabase dashboard; they are never printed in chat or
committed:

- `SUPABASE_DB_URL_DEVELOPMENT` — dev project Connect → Session pooler string.
- `SUPABASE_DB_URL_PRODUCTION` — prod project Connect → Session pooler string.
  Treat this as a production credential: set it only inside the `production`
  GitHub Environment (not as a plain repo secret), so it is reachable only by
  the reviewer-gated production job.

Also create two GitHub Environments: `development` and `production`, and add a
required reviewer to `production`. That reviewer gate is the production
authorization control; keep it in place.
