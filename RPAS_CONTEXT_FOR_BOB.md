# RPAS — Right Path Agency System
## Handoff Context for Collaborators

> Drop this file into your Claude Code session at the start of any work session.
> It covers the project, the stack, what's been built, key decisions, and known gotchas.

---

## What This Is

RPAS is an internal case management and proactive servicing system for a life insurance agency (Makal Financial Services). It manages:

- **Referral pipeline** — leads from Allstate P&C agency partners, worked from first contact through policy placement
- **Legacy policy servicing** — an in-force book of policies that need ongoing service work (billing, beneficiary changes, etc.)
- **Proactive policy reviews** — structured 5-minute review calls with clients to surface re-quoting, tobacco reclassification, and cross-sell opportunities
- **Agency portal** — a read-only view for each of the ~87 referring agencies to see their clients' pipeline status

**PHI/PII constraint (non-negotiable):** SSNs are never stored anywhere. DOB is stored only as a `date` type in the DB but masked as `MM/xx/YYYY` whenever displayed in the UI. Never reconstruct or display a full date of birth.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16.2.6 (App Router, Turbopack) |
| Language | TypeScript |
| Database / Auth | Supabase (PostgreSQL + PostgREST + Supabase Auth) |
| Styling | Tailwind CSS |
| Hosting | Vercel (auto-deploys from `main` branch on GitHub) |
| Repo | `https://github.com/andymakal/rpas.git` |

---

## Critical Next.js 16 Gotchas

**Middleware is renamed.** In Next.js 16, `middleware.ts` is deprecated. The file must be named `proxy.ts` and the exported function must be named `proxy` (not `middleware`). Using the old convention silently breaks session refresh, which causes Supabase JWTs to expire and all authenticated queries to return empty results.

```
src/proxy.ts          ← correct (Next.js 16)
src/middleware.ts     ← WRONG, do not create
```

**AGENTS.md instruction:** The repo has `AGENTS.md` at root which says to read `node_modules/next/dist/docs/` before writing any Next.js code, because Next.js 16 has breaking API changes from prior versions.

---

## Supabase Client Pattern

There are three clients — use the right one for the context:

```typescript
// Browser (client components, login page)
import { createClient } from '@/lib/supabase/client'

// Server (server components that need the user's session / RLS)
import { createClient } from '@/lib/supabase/server'
const supabase = await createClient()

// Admin (server components / API routes that need to bypass RLS)
import { createAdminClient } from '@/lib/supabase/admin'
const supabase = createAdminClient()
```

Most internal admin pages use `createAdminClient()`. The agency portal pages use the user session client so RLS restricts them to their own data.

---

## PostgREST Relationship Disambiguation

There are multiple FK paths between `cases` and `customers` in the schema (the `policy_reviews.resulting_case_id` + `service_policies.customer_id` creates an ambiguous second path). **Every query that joins cases → customers must use the FK hint:**

```typescript
// WRONG — PostgREST throws "more than one relationship found"
.select('customers ( first_name, last_name )')

// CORRECT
.select('customers!customer_id ( first_name, last_name )')
```

This applies in: `cases/page.tsx`, `referrals/page.tsx`, `triage/page.tsx`, `dashboard/page.tsx`, `production/page.tsx`, `spiff/page.tsx`, `cases/[id]/page.tsx`, `referrals/[id]/page.tsx`, `portal/[slug]/page.tsx`, and the rewarm API route. All are already fixed.

---

## Database Schema — Key Tables

### Pipeline (cases workflow)

```
agencies          — 87 Allstate P&C partners; slug is immutable
customers         — insurance clients; agency_id FK to agencies
agents            — individual Allstate agents at each agency
cases             — core pipeline entity; internal_status FK to stage_translations
stage_translations — lookup: internal_status → display label, tier, flags
products          — age-banded product rows; FK to carriers
```

**Cases pipeline flow:**
`triage` → `active_referral` → `appointment_set` → `quoted` → (`app_submitted` → ...) → `placed`

Lost states: `not_interested`, `carrier_declined`, `client_withdrew`
Snoozed state: `snoozed`

**Tier system** (derived from `stage_translations`, never stored):
- Tier 1: Triage, active referral, appointment stages (Referrals page)
- Tier 2: Commitment/underwriting (Cases page, "Pending" tab)
- Tier 3: Execution / placed (Cases page, "Placed" tab)

`cases.internal_status` is a TEXT FK to `stage_translations.internal_status`. **Never render `internal_status` directly in UI** — always use `stage_translations.agency_label`.

### Service Module (proactive servicing)

```
service_policies  — legacy in-force policies (central hub)
service_requests  — Abigail's service work (billing, beneficiary, etc.)
policy_reviews    — Tyler/Lucas 5-minute proactive review calls
```

`service_policies` has optional FKs: `agency_id`, `agent_id`, `customer_id` (all nullable — policies may exist before customer records do).

`policy_reviews.resulting_case_id` → `cases.id` — links a review outcome back to a case if new business resulted.

### Supporting tables

```
spiff_records     — tracks appointment SPIFFs earned per case
intake_raw        — raw referral form submissions before normalization
gdc_records       — GDC production credit imports
portal_content    — training/bulletin cards shown on agency portals
snooze_reasons, lost_reasons, pending_requirements — lookup tables
```

---

## Key Migrations (in order)

| File | Purpose |
|------|---------|
| `20260515000001` | Settings DDL (stage_translations, products, carriers, etc.) |
| `20260516000001` | Core entities (agencies, customers, agents, cases) |
| `20260516000002` | RLS policies |
| `20260518000006` | SPIFF records + spiff columns on cases |
| `20260518000007` | `is_owner_referral` column on cases |
| `20260521000001` | `is_hot_lead` column on cases |
| `20260522000002` | Pipeline redesign: triage stage, active_referral, producer_id |
| `20260525000001` | Service module rebuild (service_policies, service_requests, policy_reviews) |
| `20260525000002` | `follow_up_date date` column on cases (was missing, caused empty pages) |

**Run all migrations in order in the Supabase SQL Editor if setting up a fresh project.**

---

## Application Structure

```
src/app/
  (auth)/login/           — login page (uses createBrowserClient)
  (internal)/             — all admin-only pages (require auth via proxy.ts)
    dashboard/            — summary stats + active case count
    triage/               — incoming referrals queue (internal_status = 'triage')
    referrals/            — Tier 1 pipeline (active_referral through quoted)
    cases/                — Tier 2+ pipeline (commitment & execution)
    cases/[id]/           — individual case detail + edit
    referrals/[id]/       — individual referral detail + edit
    policies/             — service_policies list
    policies/[id]/        — policy detail with SA toggle, edit, customer link, reviews
    customers/[id]/       — Customer Card (linked cases + policies + service requests)
    production/           — placed policies (is_won = true)
    spiff/                — SPIFF records
    service/              — service requests (Abigail's work)
    reviews/              — policy reviews queue (Tyler/Lucas)
    agencies/             — agency partner management
    team/                 — team member management
    settings/             — products, password change
    admin/                — import tools (GDC, policy, lead, pending)
  portal/[slug]/          — agency-facing portal (public, RLS-scoped)
  intake/                 — referral intake form (public)
  api/
    cases/[id]/           — PATCH case fields
    customers/            — PATCH customer, search
    service-policies/     — PATCH policy, search
    service-policies/search/ — GET ?q= for linking policies
    customers/search/     — GET ?q= for linking customers (no cases join)
    policy-reviews/       — POST to queue review
    portal/[slug]/        — portal-specific API routes
    admin/                — import routes, debug routes
```

---

## Features Built (as of May 25, 2026)

### Referral Pipeline
- Triage queue (FIFO, hot lead priority) with one-click assign
- Full referral edit: status, appointment, touches, notes, customer info, SPIFF, follow-up date
- Cases list with tier tabs (Active / Pending / Placed / Closed), sortable columns, pipeline stats
- Case detail with full edit

### Service Module
- Policy list with SA status badges and review flag counts
- Policy detail with:
  - **SA status toggle** (Confirmed / Not SA / Unknown) with form-sent sub-toggle
  - **Edit mode** for all coverage fields, beneficiary, riders, notes
  - **Customer linking** — search by last name, link/unlink
  - **Agency assignment** dropdown
  - **Auto-queue review** — when SA confirmed and flags exist, creates a policy review automatically
  - **Reviews table** with Queue Review button

### Customer Card (`/customers/[id]`)
- Linked cases, linked policies, linked service requests in one view
- Link policy feature (search + click to link)
- DOB displayed as `MM/xx/YYYY` (PHI mask)

### Review Engine (`src/lib/reviews/prep.ts`)
- `generateFlags(policy)` — deterministic flag generation based on policy data
- Flags: term expiry, tobacco reclassification candidate, cash value opportunity, high-value review, beneficiary missing, etc.
- Severity levels: `critical`, `warning`, `opportunity`, `info`

### Agency Portal
- Per-agency view scoped by RLS and `jwt_agency_id()` claim
- Shows active cases, GDC stats, service requests, policy reviews
- Owner mode with PIN unlock

---

## Sidebar Navigation Order

```
Dashboard → Triage → Referrals → SPIFF → Agencies → Cases →
Production → Service → Policies → Reviews → Team →
GDC Import → Policy Import → Lead Import → Pending Import →
Products → Settings
```

---

## Key Decisions & Patterns

1. **`internal_status` is never rendered directly.** Always join to `stage_translations` and use `agency_label`.

2. **GDC is never stored.** Computed as `annual_premium × products.gdc_multiplier` at query time.

3. **DOB is stored as `date` but always displayed masked** (`MM/xx/YYYY`). Never store the year separately or expose the full date.

4. **`is_test = false` filter is mandatory** on every user-facing query. Test records must never appear in production views.

5. **Admin client (`service_role`) for internal pages, user client for portal.** Internal pages bypass RLS because the logged-in user is an admin. Portal pages must use RLS so agencies can only see their own data.

6. **All writes go through API routes** (`/api/...`), never directly from server components. This keeps the mutation logic in one place.

7. **`follow_up_date` is a `date` column** on cases (added in migration `20260525000002`). It was missing initially and caused all case queries to silently fail.

---

## Running Locally

```bash
# Install
npm install

# Start dev server (must be port 3000 — kill stale processes first)
taskkill /IM node.exe /F   # Windows
npm run dev
```

Environment variables needed in `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

The Supabase project is shared — local dev and production both connect to the same database. Schema changes (SQL) need to be run in the Supabase SQL Editor, not via `supabase db push` (migrations are tracked in `supabase/migrations/` for reference but not run via CLI).

---

## What's Next / Known Gaps

- [ ] Policy edit for `carrier`, `policy_number`, `client_name`, `issue_date`, `term_length` (secondary fields not yet in edit form)
- [ ] Review detail page (`/reviews/[id]`) — prep screen and outcome logging
- [ ] Service request detail page  
- [ ] Notification system (the `NotificationBell` component exists in the sidebar but backend not wired)
- [ ] The agency portal's `service_requests` and `policy_reviews` joins in `portal/[slug]/page.tsx` reference old schema columns — needs updating to the new service module structure
- [ ] `customers/search` API: returns customers without their case status (the cases join was removed to fix an ambiguity error; re-add with `cases!customer_id` hint if case status is needed in search results)
