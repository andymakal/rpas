-- =============================================================================
-- Add context column to lost_reasons
-- Migration: 20260625000001_lost_reasons_context.sql
--
-- Triage (Gabe/Dulce) and producers have different "not interested" scenarios.
-- Context values:
--   triage   — shown only when the case is still in triage
--   producer — shown only when the case is in a producer pipeline stage
--   both     — shown in all stages
-- =============================================================================

alter table public.lost_reasons
  add column if not exists context text not null default 'both'
  check (context in ('triage', 'producer', 'both'));

comment on column public.lost_reasons.context is
  'Controls which pipeline stage sees this reason: triage, producer, or both.';

-- Re-classify existing reasons: everything is producer or both by default
-- (they all make sense after a producer conversation).
-- "No quote" is triage-only — if someone won't even take a quote they never
-- made it to a producer.
update public.lost_reasons
set context = 'triage'
where internal_code = 'not_interested_no_quote';

-- Price, options, underwriting, timing, existing, other → producer only
update public.lost_reasons
set context = 'producer'
where internal_code in (
  'not_interested_price',
  'not_interested_options',
  'not_interested_underwriting',
  'not_interested_timing',
  'not_interested_existing',
  'not_interested_other'
);

-- elsewhere stays 'both' (pre-existing coverage discovered at any stage)

-- Add triage-specific reasons that don't apply to producer conversations
insert into public.lost_reasons (internal_code, agency_label, sort_order, context) values
  ('triage_never_responded',  'Never responded',           10, 'triage'),
  ('triage_wrong_number',     'Wrong number / bad contact', 11, 'triage'),
  ('triage_language_barrier', 'Language barrier',           12, 'triage'),
  ('triage_called_back_ni',   'Called back — not interested', 13, 'triage')
on conflict (internal_code) do update
  set agency_label = excluded.agency_label,
      sort_order   = excluded.sort_order,
      context      = excluded.context;
