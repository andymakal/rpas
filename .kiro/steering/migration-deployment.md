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

## One-time setup (owner/admin actions)

The workflow authenticates to each database with a stored connection string: a
standard Session-pooler connection string including the database password. Only
an owner can read these passwords from the Supabase dashboard (each project →
Connect → Session pooler); they are never printed in chat or committed.

1. The workflow file must exist on the default branch (`main`) for the manual
   "Run workflow" button (and thus the production path) to be available at all.
   Promote it to `main` through the normal reviewed pull request.
2. Development secret — a plain repository secret:
   `SUPABASE_DB_URL_DEVELOPMENT` = the dev project's Session-pooler string. The
   dev job reads it directly; no GitHub Environment is required for dev.
3. Production gate + secret — requires repository admin:
   - On the existing `Production` GitHub Environment, add a required reviewer
     (Settings → Environments → Production → Required reviewers). That reviewer
     approval is the production authorization control; keep it in place.
   - Add `SUPABASE_DB_URL_PRODUCTION` = the prod project's Session-pooler string
     as an environment secret scoped to `Production` (not a plain repo secret),
     so it is reachable only by the reviewer-gated production job.

Note: creating/editing GitHub Environments and their protection rules requires
admin on the repo; a WRITE collaborator can set plain repo secrets but cannot
configure the environment reviewer gate.
