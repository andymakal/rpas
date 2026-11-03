-- =============================================================================
-- Calendar blocks — the first-class time spine
-- Migration: 20261129000001_calendar_blocks_spine.sql
--
-- WHAT THIS IS: the calendar is a first-class spine that workflows hang off of,
-- NOT a feature bolted onto any one workflow (see CALENDAR_DESIGN.md §1). A
-- calendar_block is one block of a PERSON'S time. A stewardship promised
-- callback, a review, a new-policy appointment — any workflow that needs time —
-- REFERENCES a block; none of them OWNS the calendar. This reverses the older
-- `appointments` table (empty, workflow-owned, household-required) which is left
-- untouched and is not used here.
--
-- WHY A NEW TABLE (how IPF did it, and why we diverge on placement): IPF
-- (bobpfromm/ipf-stewardship) has NO standalone calendar table. In IPF an
-- appointment is a STATE of the current next-action on a work episode
-- (episode_next_actions: action_state='scheduled' + scheduled_at, the stated
-- customer zone in action_context.sourceTimezone, exact-vs-inexact as the
-- callbackHasTime/rescheduleHasTime flag, is_current + superseded_at for
-- history). IPF can hang time on the work item because its work_episodes IS a
-- universal work spine. Right Path has NO single universal work object —
-- stewardship outreach is just one workflow — so the calendar MUST be its own
-- spine here. We therefore LIFT IPF's field shapes (instant as timestamptz; the
-- stated zone stored alongside; a has_time flag; a jsonb soft-facts bag;
-- supersede-don't-delete for history) onto this new table, and DO NOT copy IPF's
-- placement of time on the work item.
--
-- TIMEZONE INVARIANT (CALENDAR_DESIGN.md §3): never store a bare wall-clock time
-- and never hard-code an offset. starts_at/ends_at are absolute instants
-- (timestamptz); stated_time_zone is the IANA zone the block was STATED in
-- (the customer's zone for a customer appointment, the producer's own zone for
-- self-held time), so we can always re-render the stated local time correctly
-- across DST. Rendering is per-viewer (each person sees the instant on their own
-- clock) and is a read concern, not stored here.
--
-- SCOPE (Layer A): this migration lands the full spine shape so the model is
-- right, but Layer A only exercises kind='appointment' (an exact-time promised
-- callback). The kind='busy' / kind='hold' cases are the Layer C calendar and
-- are defined here only so the shape need not change later.
--
-- NAMING: the set-aside-time kind is 'hold' (e.g. "hold 4 hours for reviews"),
-- deliberately NOT "reservation", because public.work_reservations already
-- exists as an UNRELATED concept (a transient self-expiring soft lease so two
-- workers don't grab the same subject). A calendar hold is durable, scheduled
-- time; a work_reservation is an ephemeral coordination hint. Keep them distinct.
--
-- ALSO: producers gains a home IANA time_zone, required for Layer C working
-- hours and used to render a producer's own clock. Nullable (unknown) with no
-- default — we never invent a zone; a null falls back to the shared time
-- module's documented default at render time.
--
-- SAFE REPLAY: create-if-not-exists table/indexes/column, create-or-replace
-- trigger. Depends on producers (20261021000001 overlay), customers, and the
-- shared helpers set_updated_at() and jwt_is_admin(). Internal-only; no agency
-- portal exposure. Idempotent.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Producer home timezone (IANA). Required for working hours (Layer C) and to
-- render each producer's own clock. Nullable, no default: NULL = unknown, never
-- a fabricated zone. A valid value is an IANA name like 'America/Chicago'.
-- -----------------------------------------------------------------------------
alter table public.producers
  add column if not exists time_zone text;

comment on column public.producers.time_zone is
  'Producer home IANA time zone (e.g. ''America/New_York'', ''America/Chicago''). '
  'NULL = unknown; never defaulted or fabricated. Used to render the producer''s '
  'own clock and (Layer C) to interpret declared working hours. The shared time '
  'module applies its documented fallback when this is null.';


-- -----------------------------------------------------------------------------
-- 2. The calendar_blocks spine.
-- One block of a person's time. Everything else references it; it references no
-- workflow as an owner.
-- -----------------------------------------------------------------------------
create table if not exists public.calendar_blocks (
  id               uuid primary key default gen_random_uuid(),

  -- WHOSE time this block is. NULLABLE on purpose: a customer appointment may be
  -- UNCLAIMED (offered to an eligible group) before anyone takes it, in which
  -- case producer_id is null and responsibility lives in the eligible tier +
  -- escalation ladder (CALENDAR_DESIGN.md §4 "Ownership before a claim", Layer
  -- B). A 'busy'/'hold' block (someone's own time) always names its producer.
  -- Claiming an appointment sets producer_id.
  producer_id      uuid references public.producers (id) on delete set null,

  -- The three real shapes of a block (CALENDAR_DESIGN.md §4):
  --   'appointment' — a commitment at a time (optionally with a customer).
  --   'busy'        — held time that BLOCKS booking (lunch, out of office).
  --   'hold'        — time set aside to BE FILLED with a kind of work
  --                   ("hold 4 hours for reviews"); matching-purpose
  --                   appointments belong INSIDE it and do not conflict (§4a).
  -- Layer A exercises only 'appointment'.
  kind             text not null
    check (kind in ('appointment', 'busy', 'hold')),

  -- On a 'hold', which work it is set aside for (e.g. 'review'), so the
  -- kind-aware conflict rule (§4a, Layer C) knows what may be booked inside it.
  -- Null for 'appointment'/'busy'.
  purpose          text,

  -- Absolute instants. NEVER a bare wall-clock string. ends_at must be after
  -- starts_at.
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,

  -- The IANA zone the block was STATED in (customer's zone for a customer
  -- appointment; the producer's own zone for self-held time). Lets us re-derive
  -- the stated local time across DST. Required: a block always knows the clock
  -- it was stated on.
  stated_time_zone text not null,

  -- Whether a specific TIME was committed (true) vs only a date / window
  -- (false). Mirrors IPF's callbackHasTime. Only a has_time='true' appointment
  -- is an EXACT-TIME commitment eligible to surface as imminent on My Work
  -- (the dormant rank-1 exact_time_commitment ZEN band). Date-only / windowed
  -- commitments stay as callback availability on the outreach row, not blocks.
  has_time         boolean not null default true,

  -- OPTIONAL customer. Present for a customer appointment; null for 'busy'/'hold'
  -- (held time with no customer, e.g. a producer's own review hours). The
  -- calendar does not require a customer.
  customer_id      uuid references public.customers (id) on delete set null,

  -- NON-OWNING reference to the workflow that created the block, so we can trace
  -- a block back to its origin WITHOUT the workflow owning the calendar. Free
  -- text type + id (e.g. ('stewardship_outreach', <row id>)); not a hard FK, so
  -- a workflow row's deletion never cascades into or blocks the calendar.
  source_type      text,
  source_id        uuid,

  title            text,
  notes            text,
  location         text,

  -- Lifecycle of the block. 'proposed' = created, not yet confirmed (e.g. an
  -- invite sent, awaiting accept); the rest are self-explanatory. Never an
  -- automatic terminal state set by the system without a human action.
  status           text not null default 'proposed'
    check (status in ('proposed', 'confirmed', 'kept', 'missed', 'cancelled', 'rescheduled')),

  -- Optional soft-lease claim, mirroring stewardship_outreach: who has committed
  -- to an unclaimed appointment offered to a group (Layer B). For Layer A a
  -- producer-owned appointment simply carries producer_id and may leave this
  -- null. Kept distinct from producer_id so "offered to a group but claimed by
  -- X" and "X's own time" are not conflated. on delete set null so removing a
  -- producer never deletes the time commitment.
  claimed_by_producer_id uuid references public.producers (id) on delete set null,
  claimed_at             timestamptz,

  -- Supersede-don't-delete history (IPF pattern): a reschedule supersedes the
  -- prior block rather than mutating it, so the trail is preserved. is_current
  -- marks the live block; superseded_at stamps when it was replaced.
  is_current       boolean not null default true,
  superseded_at    timestamptz,
  superseded_by    uuid references public.calendar_blocks (id) on delete set null,

  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint calendar_blocks_time_order check (ends_at > starts_at),
  -- A customer only ever rides an appointment; a busy/hold block is personal
  -- held time with no customer.
  constraint calendar_blocks_customer_only_on_appointment check (
    customer_id is null or kind = 'appointment'
  ),
  -- A purpose only applies to a hold.
  constraint calendar_blocks_purpose_only_on_hold check (
    purpose is null or kind = 'hold'
  ),
  -- A busy/hold block is personal time and must name its producer.
  constraint calendar_blocks_personal_time_has_producer check (
    kind = 'appointment' or producer_id is not null
  )
);

comment on table public.calendar_blocks is
  'The first-class time spine: one block of a person''s time. Workflows (a '
  'stewardship callback, a review, a new-policy appointment) REFERENCE a block '
  'via (source_type, source_id); none owns the calendar. kind: appointment (a '
  'commitment, optionally with a customer) / busy (blocks booking) / hold (time '
  'set aside to be filled, e.g. review hours). Times are absolute instants + the '
  'IANA zone they were stated in (never a bare wall clock). has_time=true marks '
  'an exact-time commitment. producer_id is nullable: an unclaimed appointment '
  'is owned by the eligible tier + escalation ladder until claimed. Named '
  '''hold'' (not ''reservation'') to stay distinct from the unrelated '
  'work_reservations soft-lease primitive.';

-- Each producer's own live blocks on a given instant range — the read behind
-- the Layer A double-booking guard and My Work surfacing.
create index if not exists calendar_blocks_producer_time_idx
  on public.calendar_blocks (producer_id, starts_at)
  where is_current;

-- Unclaimed live appointments (producer_id null), the Layer B group-offer pool.
create index if not exists calendar_blocks_unclaimed_idx
  on public.calendar_blocks (starts_at)
  where is_current and kind = 'appointment' and producer_id is null;

-- Trace blocks back to the workflow that created them.
create index if not exists calendar_blocks_source_idx
  on public.calendar_blocks (source_type, source_id)
  where source_type is not null;

-- A customer's own calendar.
create index if not exists calendar_blocks_customer_idx
  on public.calendar_blocks (customer_id)
  where customer_id is not null;

drop trigger if exists calendar_blocks_set_updated_at on public.calendar_blocks;
create trigger calendar_blocks_set_updated_at
  before update on public.calendar_blocks
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 3. Privileges + RLS. Internal admins (the operators) read; all writes go
-- through the service-role /api routes. Mirrors every existing internal module
-- (projects / stewardship). No agency-portal exposure.
-- -----------------------------------------------------------------------------
grant all on public.calendar_blocks to anon, authenticated, service_role;

alter table public.calendar_blocks enable row level security;

drop policy if exists calendar_blocks_admin_select on public.calendar_blocks;
create policy calendar_blocks_admin_select
  on public.calendar_blocks for select to authenticated
  using (public.jwt_is_admin());

drop policy if exists calendar_blocks_service_all on public.calendar_blocks;
create policy calendar_blocks_service_all
  on public.calendar_blocks for all to service_role
  using (true) with check (true);


-- Refresh PostgREST's schema cache so the new table/column are visible via the API.
notify pgrst, 'reload schema';
