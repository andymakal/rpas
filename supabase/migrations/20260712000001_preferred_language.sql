-- =============================================================================
-- Add preferred_language; clean up lost_reasons context and labels
-- Migration: 20260712000001_preferred_language.sql
--
-- 1. Replace spanish_speaking boolean with preferred_language text on customers.
--    Accepted values: en, es, zh, ru, vi, other
-- 2. Rationalize triage vs producer lost_reasons — remove redundancies and
--    fix the rating label (client WITHDRAWS when carrier gives a substandard
--    rating they can't afford; the carrier did not decline them).
-- =============================================================================

-- ── 1. preferred_language ─────────────────────────────────────────────────────

alter table public.customers
  add column if not exists preferred_language text not null default 'en'
  check (preferred_language in ('en', 'es', 'zh', 'ru', 'vi', 'other'));

comment on column public.customers.preferred_language is
  'ISO-639-1 code for client preferred language. en = English (default). Used for triage badge and routing notes.';

-- Migrate existing spanish-speaking flag before it is removed from the codebase
update public.customers
  set preferred_language = 'es'
  where spanish_speaking = true
    and preferred_language = 'en';

-- ── 2. Triage lost_reasons ────────────────────────────────────────────────────

-- Language barrier is no longer a lost reason — AI voice translators and phone
-- apps provide a workaround; it is a routing/capability note, not a lost outcome.
delete from public.lost_reasons where internal_code = 'triage_language_barrier';

-- Consolidate: not_interested_no_quote is the same outcome as triage_called_back_ni
-- at this stage (client won't even take a call). Use one clean code.
delete from public.lost_reasons where internal_code = 'not_interested_no_quote';

-- Triage canonical set: sort_order 10–49
update public.lost_reasons set agency_label = 'Wrong number / bad contact', sort_order = 10
  where internal_code = 'triage_wrong_number';

update public.lost_reasons set agency_label = 'Never responded', sort_order = 20
  where internal_code = 'triage_never_responded';

update public.lost_reasons set agency_label = 'Not interested — declined on call', sort_order = 30
  where internal_code = 'triage_called_back_ni';

insert into public.lost_reasons (internal_code, agency_label, sort_order, context)
  values ('triage_has_coverage', 'Already has coverage', 40, 'triage')
  on conflict (internal_code) do update
    set agency_label = excluded.agency_label,
        sort_order   = excluded.sort_order,
        context      = excluded.context;

-- ── 3. Producer lost_reasons ──────────────────────────────────────────────────
-- sort_order 50–99 so they sort after all triage reasons if ever shown together

update public.lost_reasons
  set context = 'producer',
      agency_label = 'Client declined — pricing / budget',
      sort_order = 50
  where internal_code = 'price_objection';

-- Client WITHDREW their application after the carrier returned a substandard
-- rating they couldn't afford or that conflicted with their sensitivities.
-- This is the client's decision — not a carrier decline.
update public.lost_reasons
  set context = 'producer',
      agency_label = 'Client withdrew — health rating',
      sort_order = 60
  where internal_code = 'rating_objection';

update public.lost_reasons
  set context = 'producer',
      agency_label = 'Client found other coverage',
      sort_order = 70
  where internal_code = 'found_better_coverage';

update public.lost_reasons
  set context = 'producer',
      sort_order = 80
  where internal_code = 'client_ghosted';

update public.lost_reasons
  set context = 'producer',
      agency_label = 'Carrier decision — not approved',
      sort_order = 90
  where internal_code = 'carrier_decline';

insert into public.lost_reasons (internal_code, agency_label, sort_order, context)
  values ('client_withdrew_other', 'Client withdrew — other reason', 85, 'producer')
  on conflict (internal_code) do update
    set agency_label = excluded.agency_label,
        sort_order   = excluded.sort_order,
        context      = excluded.context;

-- Carry the 'not_interested_underwriting' producer code forward with a cleaner
-- label so it doesn't conflict with rating_objection.
update public.lost_reasons
  set agency_label = 'Declined — health concerns (pre-application)',
      sort_order = 62
  where internal_code = 'not_interested_underwriting';
