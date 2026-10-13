-- =============================================================================
-- Servicing-Agent Onboarding — refusal stop, resilient handoff, and
-- clear-verification-on-contact-change
-- Migration: 20261101000001_onboarding_followups_refusal_handoff.sql
--
-- Three additive corrections. None redesign the workflow.
--
--   1. Explicit refusal stop. A customer who explicitly declines
--      ('not-interested') must stop surfacing for further outreach until a human
--      deliberately reopens them. stewardship_outreach.refused_at records that
--      stop. It is NOT an automatic lost/closed state (none exists): it is a
--      human-recorded disposition that suppresses resurfacing, reversible via an
--      explicit reopen. The item keeps its queue; actionable/resurfacing reads
--      simply skip refused items while refused_at is set.
--
--   2. Resilient Initial Analysis handoff. The handoff at onboarding completion
--      must never be silently lost. customer_prereviews.handoff_status records
--      the outcome ('done' | 'failed'), and handoff_error carries the reason on
--      failure, so a failed handoff is visible and retryable instead of
--      swallowed by a best-effort catch. Null = no handoff attempted yet.
--
--   3. Clear contact verification when the contact value changes. The
--      customers.*_verified_at flags (added 20261031000001) record that a
--      customer confirmed a value is correct. If that value later changes, the
--      confirmation no longer applies and must clear. A trigger does this at the
--      database for EVERY write path (the customer edit API, imports, the
--      stewardship research-found write), so no single code path can forget it.
--      Address verification tracks the mailing address across BOTH conventions
--      present in this schema (street and address_line1) plus city/state/zip.
--
-- Depends on: stewardship_outreach (20260927000003), customer_prereviews +
-- the verification/completion columns (20261031000001). Additive and nullable;
-- no backfill. Grants re-applied for the stewardship table per its convention.
-- =============================================================================


-- 1. Refusal stop (explicit, reversible; not an auto-close).
alter table public.stewardship_outreach
  add column if not exists refused_at timestamptz;

comment on column public.stewardship_outreach.refused_at is
  'When the customer explicitly declined further servicing-agent outreach '
  '(call outcome not-interested). While set, the item is suppressed from '
  'actionable/resurfacing reads. Cleared by an explicit reopen. Human-recorded; '
  'never an automatic lost/closed state.';

grant all on public.stewardship_outreach to anon, authenticated, service_role;


-- 2. Resilient handoff outcome on the pre-review.
alter table public.customer_prereviews
  add column if not exists handoff_status text
    check (handoff_status in ('done', 'failed')),
  add column if not exists handoff_error  text;

comment on column public.customer_prereviews.handoff_status is
  'Outcome of the Initial Analysis handoff triggered at onboarding completion: '
  'done = the analysis prep item was created/confirmed; failed = the handoff '
  'errored and must be retried (see handoff_error). Null = not attempted. A '
  'failed handoff is never silently lost.';
comment on column public.customer_prereviews.handoff_error is
  'Error detail when handoff_status = failed, for diagnosis and retry.';


-- 3. Clear verification flags when the corresponding contact value changes.
create or replace function public.clear_contact_verification_on_change()
returns trigger
language plpgsql
as $$
begin
  -- Phone: clear phone_verified_at when the phone value changes.
  if new.phone is distinct from old.phone then
    new.phone_verified_at := null;
  end if;

  -- Email: clear email_verified_at when the email value changes.
  if new.email is distinct from old.email then
    new.email_verified_at := null;
  end if;

  -- Address: clear address_verified_at when any component of the mailing
  -- address changes. Both street conventions are watched (real data uses
  -- `street`; `address_line1` exists for the stewardship form), plus city /
  -- state / zip.
  if new.street       is distinct from old.street
     or new.address_line1 is distinct from old.address_line1
     or new.city       is distinct from old.city
     or new.state      is distinct from old.state
     or new.zip        is distinct from old.zip then
    new.address_verified_at := null;
  end if;

  return new;
end;
$$;

comment on function public.clear_contact_verification_on_change() is
  'Clears a customers.*_verified_at flag whenever its corresponding contact '
  'value changes, so a stale confirmation never outlives the value it confirmed.';

drop trigger if exists customers_clear_contact_verification on public.customers;
create trigger customers_clear_contact_verification
  before update on public.customers
  for each row
  execute function public.clear_contact_verification_on_change();
