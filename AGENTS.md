<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Right Path (RPAS) — repository instructions

This file is the shared, authoritative instruction layer for any AI assistant
working in this repo (Kiro and Claude Code both read it; `CLAUDE.md` imports it
via `@AGENTS.md`). Kiro-specific guidance lives separately in `.kiro/steering/`
and is not duplicated here.

Verify system state against the live source before asserting it. Schema, data,
identifiers, branch/deploy status, and env wiring change; this file is
orientation, not a substitute for checking. When this file and the repository
disagree, the repository wins — fix this file.

## What Right Path is

Right Path Agency System (RPAS) is a single internal case-management and
proactive-servicing application for a life insurance agency (Makal Financial
Services). It is one Next.js app backed by one Supabase (Postgres) database. It
covers the referral pipeline (leads from Allstate P&C partner agencies worked to
placement), legacy in-force policy servicing, proactive policy reviews and
stewardship, projects, financial reviews, and a read-only agency portal.

PHI/PII constraint (non-negotiable): SSNs are never stored. Date of birth is
stored only as a `date` and always displayed masked as `MM/xx/YYYY`. Never
reconstruct or render a full DOB.

## Stack (verify versions in `package.json`)

- Next.js (App Router, 16.x — currently 16.3.8), React 19, TypeScript.
- Supabase: Postgres + PostgREST + Supabase Auth, `@supabase/ssr`.
- Tailwind CSS v4, shadcn, Radix, lucide-react.
- Storybook (light-theme design system reference).
- Hosting: Vercel. Repo: `github.com/andymakal/rpas`.

Next.js 16 note: request-interception middleware is `src/proxy.ts` exporting
`proxy` (not `middleware.ts`/`middleware`). The old convention silently breaks
Supabase session refresh. Do not reintroduce `src/middleware.ts`.

## Production / development boundary

There are two Supabase projects on one shared Vercel project:

- Production ref `erbvssfcglhnelfelbfi` — the real agency database. Only
  Production Vercel deployments and the production custom domain use it.
- Development ref `buoztddompdsuccfcixk` — a persistent, with-data clone of
  production (`persistent = true`). Local dev and Vercel Preview point here.
  Development data is a production snapshot, not live replication.

Guardrails that enforce this (do not weaken them):

- `src/lib/supabase/admin.ts` refuses to build a service-role client against the
  production ref unless `VERCEL_ENV === 'production'`. Local and Preview
  hard-fail if misconfigured with production credentials.
- `.env.local` points only at the development branch. Preview-scoped Vercel env
  vars point at development; `ANTHROPIC_API_KEY` is unset and `CRON_SECRET` is a
  dummy on Preview; scheduled crons run only on Production.
- `.kiro/settings/mcp.json` exposes development read/write and production
  read-only.

Do not deploy to or modify production as part of ordinary development. Never run
`vercel --prod` / `vercel deploy --prod` for review builds. Schema moves via
source-controlled migrations; production data corrections are a separate,
explicitly-requested production operation.

## Supabase client pattern

```typescript
import { createClient } from '@/lib/supabase/client'   // browser / client components
import { createClient } from '@/lib/supabase/server'   // server, honors user session + RLS (await it)
import { createAdminClient } from '@/lib/supabase/admin' // server, service-role, bypasses RLS
```

Internal admin pages use the admin client (the operator is an admin). The agency
portal uses the session client so RLS scopes each agency to its own data. Writes
go through `/api/*` routes, not directly from server components.

Auth model (single-tenant, one agency): internal admin has no `agency_members`
row and `app_role = 'admin'`, served via the service-role client; agency users
authenticate via session + RLS. Do not add multi-tenant / per-practice concepts.

## PostgREST relationship disambiguation

Multiple FK paths exist between `cases` and `customers`. Any query joining
cases → customers must use the FK hint, e.g. `customers!customer_id ( ... )`.
A bare `customers ( ... )` select throws "more than one relationship found".

## Shared development workflow (Bob/Kiro and Andy/Claude Code)

Two developers work the same repo without clobbering each other:

- `main` is production and auto-deploys to production on Vercel. Andy may
  continue to work directly on `main`; that is his established path and this
  workflow does not change it.
- `development` is the shared branch for in-progress work and testing. Bob/Kiro
  develop here against the Supabase development branch, and `development` and its
  Vercel Preview exist to exercise changes against a production-like clone
  before anything reaches production.
- Each developer works on `development` (or a feature branch off it) and commits
  small, targeted changes. Pull/merge before starting and before pushing so
  neither overwrites the other's work.
- Keep `development` current with `main`: when `main` advances, merge `main` into
  `development`, then apply any new source-controlled migrations to the Supabase
  development branch so the clone's schema tracks production.
- Review in-progress work through the access-protected Vercel Preview (points at
  the development clone, so UI writes land on the clone, never production). See
  `PREVIEW_DEPLOYMENT.md`.
- Integrate approved work into production with a focused pull request from
  `development` (or a feature branch) into `main`, scoped to just the reviewed
  change rather than all of `development`. Merging `main` deploys. Keep
  `development` current with `main` afterward.

Setup and environment details live in `DEV_ENV_SETUP_HANDOFF.md` and
`PREVIEW_DEPLOYMENT.md`. Local run: `npm run dev` on port 3000, env in
`.env.local` (development-branch URL + anon + service-role keys only).

## Current architectural decisions

- One application, one database. No second database or cross-app data plane.
- `cases.internal_status` is a TEXT FK to `stage_translations`. Never render it
  directly; always display `stage_translations.agency_label`.
- Tier (1/2/3) is derived from `stage_translations`, never stored.
- GDC is never stored; compute `annual_premium × products.gdc_multiplier` at
  query time.
- `is_test = false` on every user-facing query; test records never surface.
- Shared work queues over routine individual assignment. Eligibility is by
  employee capability; claiming is optional and lightweight (a soft lease at
  most). Project ownership and escalation are project-specific and owned by the
  Projects module, not a generic per-item assignment model.
- Today's Focus influences priority but never overrides a customer commitment (a
  promised callback or scheduled appointment outranks focus ordering).
- Recommendations inform; a human decides consequential business outcomes. No
  automatic terminal state (lost/closed) is set by the system.
- The customer relationship is the durable center; queues, projects, episodes,
  and reviews are work around it.

## Light / dark themes (one app, two intentional themes)

- Light theme: the Storybook-based operator workflow design system (tokens in
  `src/app/globals.css`, shared components in `src/components/workflow/`).
- Dark theme: Andy's existing dashboard/login/sidebar screens, separately styled.

Keeping them separate is deliberate; theme switching is not implemented, so do
not build it. The light tokens have no `.dark` overrides and must not bleed into
the dark screens. Kiro's `.kiro/steering/workflow-visual-rules.md` is the full
standard for light-theme screens.

## IPF integration intent

IPF (`bobpfromm/ipf-stewardship`) is the functional blueprint for Right Path's
operational and assistant overlay. Reuse IPF's working capabilities, not just its
ideas: GoRules ZEN (`@gorules/zen-engine`) + IPF rule models for deterministic,
attributable recommendations (ZEN owns the decision matrix on normalized facts
and never touches the DB; TypeScript owns normalization, time math, capability
resolution, and operator prose); the shared-queue + optional-claim model;
promised-callback / preferred-window commitments; capability-based routing; the
always-visible recommendation with collapsible coaching; and the "Daily
Direction" doctrine.

IPF is a blueprint, not a merge. Re-home every reused capability on Right Path's
existing tables, auth, and single-tenant assumptions. Do NOT import IPF's
separate database or multi-database topology, its `practice_id` multi-tenancy, or
its auth/permission model (`practice_memberships`, `ipf_require_practice_membership`,
`ipf_check_permission`, `ipf_command_owner`). The full integration contract is in
`.kiro/steering/ipf-integration.md`.

## Working discipline

- Make minimal, targeted changes; do not rewrite files wholesale unless asked.
- Match existing patterns, conventions, and libraries already in the repo.
- Run `npx tsc --noEmit` (and the build / relevant checks) before claiming done.
- Stay on the development branch for ordinary work; do not touch production.
