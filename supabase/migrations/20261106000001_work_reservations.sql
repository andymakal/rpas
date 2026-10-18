-- =============================================================================
-- Automatic temporary work reservations — the shared coordination primitive
-- Migration: 20261106000001_work_reservations.sql
--
-- WHAT THIS IS: one small, reusable mechanism that lets several employees work
-- the SAME shared activity (Send Introductory Emails, Contact Research, and any
-- future activity) without two of them landing on the same customer. Opening an
-- activity automatically reserves the next available eligible subject; a second
-- employee is handed a different one; Save & Next hands over the next available
-- subject without any button; completing, skipping, or leaving releases it.
--
-- WHAT THIS IS NOT: it is NOT ownership, assignment, or a workflow status. A
-- reservation is a soft, time-boxed lease — a coordination hint, nothing more.
-- It never changes any business record, never decides a customer outcome, and
-- can never leave a permanent hold: every reservation carries an expiry, so a
-- closed browser, a lost connection, or an abandoned session frees the subject
-- automatically once the lease lapses. This is deliberately DISTINCT from the
-- Stewardship board's claimed_by_producer_id (a permanent, explicit board
-- commitment): reservations are temporary and span activities whose subject is
-- a customer (Contact Research) as well as an outreach row (intro emails).
--
-- HOW IT STAYS RELIABLE UNDER CONCURRENCY: the subject is identified by
-- (activity_key, subject_type, subject_id) with a UNIQUE index, and all state
-- changes go through SECURITY DEFINER functions that take a row lock
-- (INSERT ... ON CONFLICT, and SELECT ... FOR UPDATE SKIP LOCKED when scanning
-- a candidate list). Two employees acting at the same instant can never both
-- win the same subject; the loser simply gets the next available one. Expiry is
-- enforced at read time (a lapsed lease is treated as free and is overwritten
-- in place), so no background job or cron is required for recovery.
--
-- SAFE REPLAY: create-if-not-exists table/indexes and create-or-replace
-- functions; a re-run is a no-op. Depends on producers (20261021000001 overlay
-- established the capability model) and the shared helpers jwt_is_admin() and
-- set_updated_at().
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The reservation table.
-- One live row per (activity_key, subject_type, subject_id). The row is reused
-- across reservations of the same subject: when a lease lapses or is released,
-- the next reserver UPDATEs the existing row rather than inserting a new one, so
-- the unique index is the single source of truth for "who, if anyone, holds
-- this subject right now".
-- -----------------------------------------------------------------------------
create table if not exists public.work_reservations (
  id            uuid primary key default gen_random_uuid(),
  -- The activity this reservation coordinates. A free-form stable key (the same
  -- key space the capability catalog uses, e.g. 'introductory_emails',
  -- 'contact_research') so the primitive is reusable without a schema change per
  -- activity. Reservations for different activities never collide even on the
  -- same subject.
  activity_key  text not null,
  -- What KIND of thing is reserved, so the same subject id space can mean an
  -- outreach row for one activity and a customer for another.
  subject_type  text not null check (subject_type in ('stewardship_outreach', 'customer')),
  -- The reserved subject's id (an outreach row id or a customer id). Not a hard
  -- FK: a reservation is a transient coordination hint, and we never want a
  -- subject delete to be blocked by, or cascade into, a lease. Stale rows simply
  -- expire and are ignored.
  subject_id    uuid not null,
  -- The current holder. The reservation always has a holder while live; on
  -- release the row is deleted or its expiry is cleared by the next reserver.
  producer_id   uuid not null references public.producers (id) on delete cascade,
  -- When the lease lapses. Always in the future for a live reservation; a row
  -- whose expires_at <= now() is treated as free and may be taken by anyone.
  expires_at    timestamptz not null,
  -- Last heartbeat, refreshed by the client while the employee is actively
  -- working. Advisory only (expires_at is the authority); kept for observability.
  heartbeat_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.work_reservations is
  'Temporary, self-expiring coordination leases so multiple employees can work '
  'the same shared activity without colliding on the same subject. NOT ownership, '
  'assignment, or a workflow status: a reservation changes no business record and '
  'always expires, so an abandoned session never leaves a permanent hold. One '
  'live row per (activity_key, subject_type, subject_id); all state changes go '
  'through the reserve/release/heartbeat functions for concurrency safety.';

-- One live reservation per subject per activity. UPSERT target.
create unique index if not exists work_reservations_subject_key
  on public.work_reservations (activity_key, subject_type, subject_id);

-- Fast "what do I currently hold / is this subject reserved" lookups.
create index if not exists work_reservations_holder_idx
  on public.work_reservations (activity_key, producer_id);
create index if not exists work_reservations_expiry_idx
  on public.work_reservations (expires_at);

drop trigger if exists work_reservations_set_updated_at on public.work_reservations;
create trigger work_reservations_set_updated_at
  before update on public.work_reservations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. RLS. Internal admins (the operators who run these activities) may read
-- their coordination state; all writes go through the service-role API routes,
-- which call the functions below. No agency-portal exposure.
-- -----------------------------------------------------------------------------
alter table public.work_reservations enable row level security;

drop policy if exists work_reservations_admin_select on public.work_reservations;
create policy work_reservations_admin_select
  on public.work_reservations for select
  using (public.jwt_is_admin());

drop policy if exists work_reservations_service_all on public.work_reservations;
create policy work_reservations_service_all
  on public.work_reservations for all
  to service_role
  using (true) with check (true);

grant all on public.work_reservations to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. reserve_work_subject — atomically reserve ONE specific subject.
-- Returns the holder after the call. Succeeds (returns the caller) when the
-- subject is free, already the caller's (idempotent, refreshes the lease), or
-- held by someone else whose lease has LAPSED (taken over). Returns the OTHER
-- holder's id (not the caller) when a live lease is held by someone else, so the
-- caller can tell it did not get the subject.
--
-- Concurrency: INSERT ... ON CONFLICT DO UPDATE with a WHERE that only lets the
-- update through when the existing lease is the caller's or has expired. The
-- conflict path locks the row, so two simultaneous callers serialize and at most
-- one wins a contested subject.
-- -----------------------------------------------------------------------------
create or replace function public.reserve_work_subject(
  p_activity_key text,
  p_subject_type text,
  p_subject_id   uuid,
  p_producer_id  uuid,
  p_ttl_seconds  integer default 180
)
  returns table (held_by uuid, is_mine boolean)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_now        timestamptz := now();
  v_expires    timestamptz := now() + make_interval(secs => greatest(p_ttl_seconds, 30));
  v_holder     uuid;
begin
  insert into public.work_reservations as wr
    (activity_key, subject_type, subject_id, producer_id, expires_at, heartbeat_at)
  values
    (p_activity_key, p_subject_type, p_subject_id, p_producer_id, v_expires, v_now)
  on conflict (activity_key, subject_type, subject_id) do update
    set producer_id  = excluded.producer_id,
        expires_at   = excluded.expires_at,
        heartbeat_at = excluded.heartbeat_at
    -- Take over ONLY when the existing lease is the caller's (refresh) or has
    -- lapsed (automatic recovery). A live lease held by someone else blocks the
    -- update, leaving their row untouched.
    where wr.producer_id = excluded.producer_id
       or wr.expires_at <= v_now
  returning wr.producer_id into v_holder;

  if v_holder is not null then
    -- We inserted or won the takeover/refresh.
    return query select v_holder, true;
    return;
  end if;

  -- The ON CONFLICT update was blocked: a live lease is held by someone else.
  select wr.producer_id into v_holder
    from public.work_reservations wr
   where wr.activity_key = p_activity_key
     and wr.subject_type = p_subject_type
     and wr.subject_id   = p_subject_id;
  return query select v_holder, (v_holder = p_producer_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. reserve_next_work_subject — the Save & Next primitive.
-- Given an ORDERED list of candidate subject ids (the caller's eligible,
-- in-scope, still-to-do work, computed by the activity's own API), atomically
-- reserve the FIRST candidate that is free or already the caller's, skipping any
-- held live by someone else. Returns the reserved subject id, or NULL when every
-- candidate is currently taken.
--
-- Concurrency: each candidate is probed with the same race-safe reserve as above
-- inside one function call; SKIP LOCKED on the lock probe means a subject another
-- transaction is mid-reserving is passed over rather than waited on, so two
-- employees calling Save & Next at the same instant walk to different subjects.
-- -----------------------------------------------------------------------------
create or replace function public.reserve_next_work_subject(
  p_activity_key   text,
  p_subject_type   text,
  p_candidate_ids  uuid[],
  p_producer_id    uuid,
  p_ttl_seconds    integer default 180
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_now      timestamptz := now();
  v_expires  timestamptz := now() + make_interval(secs => greatest(p_ttl_seconds, 30));
  v_id       uuid;
  v_locked   uuid;
  v_winner   uuid;
begin
  if p_candidate_ids is null then
    return null;
  end if;

  foreach v_id in array p_candidate_ids loop
    -- Is there an existing reservation row for this subject? Lock it so a
    -- concurrent reserve of the same subject serializes; SKIP LOCKED means a
    -- subject another worker is actively reserving is passed over immediately.
    select wr.producer_id into v_locked
      from public.work_reservations wr
     where wr.activity_key = p_activity_key
       and wr.subject_type = p_subject_type
       and wr.subject_id   = v_id
     for update skip locked;

    if not found then
      -- No row at all, OR the row is locked by a concurrent txn. Try a plain
      -- insert; if someone just inserted it, the unique index rejects us and we
      -- move on to the next candidate.
      begin
        insert into public.work_reservations
          (activity_key, subject_type, subject_id, producer_id, expires_at, heartbeat_at)
        values
          (p_activity_key, p_subject_type, v_id, p_producer_id, v_expires, v_now);
        v_winner := v_id;
        exit;
      exception when unique_violation then
        -- Lost the insert race (or it was lock-skipped): try the next candidate.
        continue;
      end;
    end if;

    -- A row exists and we hold its lock. Take it if it is ours or has lapsed.
    if v_locked = p_producer_id or exists (
      select 1 from public.work_reservations wr
       where wr.activity_key = p_activity_key
         and wr.subject_type = p_subject_type
         and wr.subject_id   = v_id
         and wr.expires_at  <= v_now
    ) then
      update public.work_reservations
         set producer_id = p_producer_id,
             expires_at  = v_expires,
             heartbeat_at = v_now
       where activity_key = p_activity_key
         and subject_type = p_subject_type
         and subject_id   = v_id;
      v_winner := v_id;
      exit;
    end if;
    -- Otherwise it is live and someone else's: move on.
  end loop;

  return v_winner;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. heartbeat_work_reservation — extend the caller's live lease.
-- Only extends a lease the caller actually holds and that has not already
-- lapsed; returns true when extended. A lapsed or foreign lease is never
-- resurrected here (that is a reserve, not a heartbeat), so a stale client can
-- never steal a subject back by heartbeating.
-- -----------------------------------------------------------------------------
create or replace function public.heartbeat_work_reservation(
  p_activity_key text,
  p_subject_type text,
  p_subject_id   uuid,
  p_producer_id  uuid,
  p_ttl_seconds  integer default 180
)
  returns boolean
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_now     timestamptz := now();
  v_expires timestamptz := now() + make_interval(secs => greatest(p_ttl_seconds, 30));
  v_hit     integer;
begin
  update public.work_reservations
     set expires_at = v_expires,
         heartbeat_at = v_now
   where activity_key = p_activity_key
     and subject_type = p_subject_type
     and subject_id   = p_subject_id
     and producer_id  = p_producer_id
     and expires_at   > v_now;
  get diagnostics v_hit = row_count;
  return v_hit > 0;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. release_work_subject — drop the caller's reservation.
-- Deletes only the caller's own live row (completing, skipping, or leaving).
-- A subject the caller no longer holds (already expired and taken by someone
-- else) is left untouched, so a late release can never remove another worker's
-- reservation. Returns true when a row was released.
-- -----------------------------------------------------------------------------
create or replace function public.release_work_subject(
  p_activity_key text,
  p_subject_type text,
  p_subject_id   uuid,
  p_producer_id  uuid
)
  returns boolean
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_hit integer;
begin
  delete from public.work_reservations
   where activity_key = p_activity_key
     and subject_type = p_subject_type
     and subject_id   = p_subject_id
     and producer_id  = p_producer_id;
  get diagnostics v_hit = row_count;
  return v_hit > 0;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. reserved_subject_ids — the set of subjects currently reserved by SOMEONE
-- ELSE (a live lease held by another producer), so an activity's list API can
-- exclude them from the candidate pool it offers a caller. Expired leases are
-- filtered out, so recovery is automatic at read time.
-- -----------------------------------------------------------------------------
create or replace function public.reserved_subject_ids(
  p_activity_key text,
  p_subject_type text,
  p_producer_id  uuid
)
  returns setof uuid
  language sql
  security definer
  set search_path = public
as $$
  select wr.subject_id
    from public.work_reservations wr
   where wr.activity_key = p_activity_key
     and wr.subject_type = p_subject_type
     and wr.expires_at   > now()
     and wr.producer_id <> p_producer_id;
$$;

grant execute on function public.reserve_work_subject(text, text, uuid, uuid, integer) to service_role;
grant execute on function public.reserve_next_work_subject(text, text, uuid[], uuid, integer) to service_role;
grant execute on function public.heartbeat_work_reservation(text, text, uuid, uuid, integer) to service_role;
grant execute on function public.release_work_subject(text, text, uuid, uuid) to service_role;
grant execute on function public.reserved_subject_ids(text, text, uuid) to service_role;

notify pgrst, 'reload schema';
