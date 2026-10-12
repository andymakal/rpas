<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Right Path (RPAS) — repository instructions

This file is the shared, authoritative instruction layer for any AI assistant
working in this repo. Kiro reads it directly; Claude Code reads it via
`CLAUDE.md`, which imports `@AGENTS.md`.

Verify system state against the live source before asserting it. Schema, data,
identifiers, branch/deploy status, and env wiring change, and they differ between
`main` and `development`. This file is orientation, not a substitute for checking
the branch you are actually on. When this file and the repository disagree, the
repository wins — fix this file.

## What Right Path is

Right Path Agency System (RPAS) is a single internal case-management and
proactive-servicing application for a life insurance agency (Makal Financial
Services). It is one Next.js app backed by one Supabase (Postgres) database. It
covers the referral pipeline (leads from Allstate P&C partner agencies worked to
placement), legacy in-force policy servicing, proactive policy reviews, financial
reviews, and a read-only agency portal.

### Sensitive customer data

- Date of birth is stored as a `date` but must always be displayed masked as
  `MM/xx/YYYY`. The day is never shown. Helpers already do this (for example in
  `customers/[id]/CustomerCardClient.tsx`); reuse them and never render a full
  DOB.
- SSN is highly sensitive PII. The Fact Finder (`FactFinderSection.tsx`) does
  capture SSN for the customer and beneficiaries, so treat it as stored-securely
  data: never log it, never surface it in search results, lists, exports, or the
  agency portal, and only show it where the Fact Finder already does. Do not
  claim SSN is "never stored" — handle it as protected data that stays out of
  incidental views.
- Treat all customer PII with least-exposure defaults: show it only where the
  task needs it.

## Stack (verify versions in `package.json`)

- Next.js (App Router, 16.x — currently 16.3.8), React 19, TypeScript.
- Supabase: Postgres + PostgREST + Supabase Auth, `@supabase/ssr`.
- Tailwind CSS v4, shadcn, Radix, lucide-react.
- Storybook.
- Hosting: Vercel. Repo: `github.com/andymakal/rpas`.

Next.js 16 note: request-interception middleware is `src/proxy.ts` exporting
`proxy` (not `middleware.ts`/`middleware`). The old convention silently breaks
Supabase session refresh. Do not reintroduce `src/middleware.ts`.

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

## Current architectural decisions

- One application, one database. No second database or cross-app data plane.
- `cases.internal_status` is a TEXT FK to `stage_translations`. Never render it
  directly; always display `stage_translations.agency_label`.
- Tier (1/2/3) is derived from `stage_translations`, never stored.
- GDC has two distinct meanings; keep them separate. Actual Allstate production
  credit is stored: the GDC import (`/admin/gdc-import`) parses the Allstate
  compensation report into `gdc_records` (`production_credit`, `policy_count`,
  `app_date`, `process_date`, per agency), and the scorecard sums
  `production_credit` for the YTD/quarter GDC figures. Separately,
  `products.gdc_multiplier` drives a computed/estimated GDC used as a projection
  basis; that estimate is derived at query time, not stored. When wording or
  code touches GDC, be explicit about which one you mean — imported actuals
  (`gdc_records`) versus a multiplier-based estimate.
- `is_test = false` on every user-facing query; test records never surface.
- Recommendations inform; a human decides consequential business outcomes. No
  automatic terminal state (lost/closed) is set by the system.
- The customer relationship is the durable center; queues, projects, episodes,
  and reviews are work around it.

## Branches, deployment, and the shared workflow

Two developers share this repo. The two long-lived branches behave differently,
and each developer has a different default path.

- `main` is the production branch; it auto-deploys to production on Vercel
  against the production Supabase database. Andy works directly on `main`; that
  is his established path and nothing here changes it.
- `development` is the shared branch for in-progress work and testing. It, and
  its access-protected Vercel Preview, run against a persistent with-data clone
  of the production Supabase database, so changes can be exercised against
  production-like data before they reach production. Bob/Kiro work here.
- Whichever branch you are on, make small, targeted commits and pull/merge before
  starting and before pushing so the two developers never overwrite each other.
- Keep `development` current with `main`: when `main` advances, merge `main` into
  `development` so the shared branch tracks production.
- Promote reviewed work to production with a focused pull request into `main`,
  scoped to just the change under review rather than all of `development`.
  Merging to `main` deploys. Keep `development` current with `main` afterward.
- Do not deploy production as a side effect of routine work: never run
  `vercel --prod` / `vercel deploy --prod` for review builds, and do not push
  work-in-progress straight to `main`.

The production/development separation and the preview environment are a property
of the `development` line of work. Some of the safeguards described below (the
service-role production guard, the preview env wiring, the Supabase development
clone) live on `development` and may not be present on `main`. Confirm what is
actually on your branch before relying on it.

### Development-branch safeguards (present on `development`)

These exist to let the `development` branch and its preview run safely against a
clone instead of production. They are development-line safeguards, not a
description of how `main`/production behaves:

- A service-role guard in `src/lib/supabase/admin.ts` that refuses to build a
  production service-role client outside a production deployment, so a
  misconfigured local or preview environment hard-fails instead of writing to
  production. (On `main`, `createAdminClient` is the plain unguarded client —
  verify before assuming the guard is present.)
- Preview-scoped Vercel env vars and a dummy `CRON_SECRET` that point the preview
  at the development clone and disable external side effects.
- Local `.env.local` pointing only at the development clone.

If you are hardening production itself (for example, carrying the service-role
guard onto `main`), do it as its own reviewed change, not silently.

## IPF integration (established decisions)

IPF (the `bobpfromm/ipf-stewardship` repository, external to this repo) is the
functional blueprint for Right Path's operational and assistant overlay. These
decisions are settled and are recorded here so they travel with `main`:

- Reuse IPF's working capabilities, not just its ideas: GoRules ZEN
  (`@gorules/zen-engine`) plus IPF's rule models for deterministic, attributable
  recommendations (ZEN owns the decision matrix over normalized facts and never
  queries the DB; TypeScript owns normalization, time math, capability
  resolution, and the operator-facing prose); the shared-queue + optional-claim
  model; promised-callback / preferred-window commitments; capability-based
  routing; the always-visible recommendation with collapsible coaching; and the
  "Daily Direction" doctrine.
- IPF is a blueprint, not a merge. Right Path stays one application and one
  database. Re-home every reused capability on Right Path's existing tables,
  auth, and single-tenant assumptions.
- Do NOT import IPF's separate database or any multi-database topology, its
  `practice_id` multi-tenancy, or its auth/permission model
  (`practice_memberships`, `ipf_require_practice_membership`,
  `ipf_check_permission`, `ipf_command_owner`). When an IPF capability is
  entangled with any of these, lift the capability and leave the tenancy/identity
  structure behind.
- Operating guardrails the integration must preserve: shared work queues over
  routine individual assignment; eligibility by employee capability; project
  ownership and escalation stay project-specific (not a generic per-item
  assignment); Today's Focus influences priority but never overrides a customer
  commitment such as a promised callback or scheduled appointment; the system
  recommends and a human decides consequential outcomes.

This integration is in-progress work landing on `development` first. When
working with Kiro on `development`, the same decisions are also maintained as
Kiro steering under `.kiro/steering/`; on `main`, this section is the reference.

## Working discipline

- Make minimal, targeted changes; do not rewrite files wholesale unless asked.
- Match existing patterns, conventions, and libraries already in the repo.
- Run `npx tsc --noEmit` (and the build / relevant checks) before claiming done.
- Confirm which branch you are on and respect its deploy behavior: `main` is
  production, `development` is the shared testing line. Do not deploy or modify
  production as a side effect of ordinary work.
- Completed, verified work is committed and pushed to the shared `development`
  branch and its preview automatically, without pausing for approval; only
  `main`/production actions require explicit authorization. The full default
  lives in Kiro steering (`.kiro/steering/delivery-workflow.md`); keep the two
  in step.
