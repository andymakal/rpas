-- =============================================================================
-- Stewardship outreach — durable operational state for the capture flow
-- Migration: 20260927000003_stewardship_outreach.sql
--
-- The capture / stewardship outreach workflow moves a customer through a set of
-- operational queues (ready to email, ready to call, research needed, waiting
-- for response / form / carrier) driven by what happened during outreach. That
-- operational state is NOT derivable from existing durable records:
--   * service_policies.sa_status has only three values (unknown / confirmed /
--     not_on_file) and sa_form_sent_at is a single timestamp — together they
--     cannot represent which outreach queue a customer is in, the last call
--     outcome, a scheduled callback, follow-up timing, or a carrier correction.
--   * customer_prereviews deliberately stores only the producer decision; its
--     comment states workflow position is derived, which holds for the
--     stewardship / documentation / ready split but NOT for the fine-grained
--     outreach queue.
--
-- So this migration adds the smallest persistence needed for the outreach slice
-- to survive refresh: one stewardship_outreach row per open customer_prereview,
-- plus a child table recording which policies are in the current servicing-agent
-- request (vs. shown only as context). Policy facts stay authoritative on
-- service_policies; servicing-agent status stays on service_policies
-- (sa_status / sa_form_sent_at). This table holds only non-derivable workflow
-- state. No automatic lost/closed state exists: every terminal-looking outcome
-- (not interested, nothing found) is an explicit human-recorded value, never a
-- status the system closes on its own.
--
-- Depends on: customer_prereviews, customers, service_policies, producers,
--             set_updated_at(), jwt_is_admin() (all earlier in the chain).
-- =============================================================================


-- =============================================================================
-- 1. STEWARDSHIP OUTREACH
-- One row per open capture work item (1:1 with a customer_prereview). Holds the
-- current outreach queue and the small amount of per-queue operational state the
-- prototype carries.
-- =============================================================================
create table if not exists public.stewardship_outreach (
  id            uuid primary key default gen_random_uuid(),

  -- the capture work item this outreach belongs to (1:1)
  prereview_id  uuid not null references public.customer_prereviews (id) on delete cascade,

  -- current outreach queue — the workflow state machine
  queue         text not null default 'ready-to-email'
    check (queue in (
      'ready-to-email', 'ready-to-call', 'research-needed',
      'waiting-for-response', 'waiting-for-form', 'waiting-for-carrier'
    )),

  -- why a 'ready-to-call' item needs a call (selects the script); null otherwise
  call_reason   text
    check (call_reason in ('no-email', 'email-bounced', 'no-response', 'callback-due')),

  -- why a 'research-needed' item is in research; null otherwise
  research_reason text
    check (research_reason in ('no-contact', 'bad-number', 'bounce-no-phone')),

  -- last recorded call outcome (never auto-advances; human-recorded)
  last_call_outcome text
    check (last_call_outcome in ('reached', 'voicemail', 'bad-number', 'not-interested', 'callback')),

  -- scheduled callback date when the customer asked us to call back
  callback_date date,

  -- when the initial email was sent (enters waiting-for-response)
  email_sent_at timestamptz,
  -- when a follow-up becomes due
  follow_up_due date,

  -- when the signed form was submitted to the carrier (enters waiting-for-carrier)
  submitted_at  timestamptz,
  -- carrier-requested correction text — actionable work within waiting-for-carrier
  carrier_correction text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.stewardship_outreach is
  'Durable operational state for the stewardship / capture outreach flow. One '
  'row per open customer_prereview. Holds only the non-derivable outreach queue '
  'and per-queue state; policy facts stay on service_policies and servicing-agent '
  'status stays on service_policies.sa_status / sa_form_sent_at.';

comment on column public.stewardship_outreach.queue is
  'Outreach workflow state. ready-to-email / ready-to-call / research-needed are '
  'action queues; waiting-for-response / waiting-for-form / waiting-for-carrier '
  'are check/waiting states. No automatic closed/lost state exists.';

-- One outreach row per pre-review.
create unique index if not exists stewardship_outreach_prereview_key
  on public.stewardship_outreach (prereview_id);

-- Queue board filtering.
create index if not exists stewardship_outreach_queue_idx
  on public.stewardship_outreach (queue);

-- Callbacks that resurface on a date.
create index if not exists stewardship_outreach_callback_idx
  on public.stewardship_outreach (callback_date)
  where callback_date is not null;

create trigger stewardship_outreach_set_updated_at
  before update on public.stewardship_outreach
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 2. STEWARDSHIP OUTREACH POLICIES
-- Which service_policies are included in the CURRENT servicing-agent request for
-- this outreach item. Membership is operational and non-derivable: all known
-- holdings stay visible as context (queried from service_policies by customer),
-- but only the policies recorded here are "in the request" and go on the form.
-- =============================================================================
create table if not exists public.stewardship_outreach_policies (
  outreach_id uuid not null references public.stewardship_outreach (id) on delete cascade,
  policy_id   uuid not null references public.service_policies (id)     on delete cascade,
  primary key (outreach_id, policy_id)
);

comment on table public.stewardship_outreach_policies is
  'Policies included in the current servicing-agent request for an outreach item. '
  'Other known holdings remain visible as customer context but are not listed '
  'here. Term / non-cash-value policies may be present as context without being '
  'in the request; they never gate the stewardship work.';

create index if not exists stewardship_outreach_policies_policy_idx
  on public.stewardship_outreach_policies (policy_id);


-- =============================================================================
-- 3. ROW LEVEL SECURITY
-- Internal staff (admin) read; all writes via service_role. Matches the service
-- module and the pre-review tables. Internal-only; no agency portal access.
-- =============================================================================
alter table public.stewardship_outreach          enable row level security;
alter table public.stewardship_outreach_policies enable row level security;

create policy stewardship_outreach_admin_select
  on public.stewardship_outreach for select to authenticated
  using (public.jwt_is_admin());

create policy stewardship_outreach_all
  on public.stewardship_outreach for all to service_role
  using (true) with check (true);

create policy stewardship_outreach_policies_admin_select
  on public.stewardship_outreach_policies for select to authenticated
  using (public.jwt_is_admin());

create policy stewardship_outreach_policies_all
  on public.stewardship_outreach_policies for all to service_role
  using (true) with check (true);
