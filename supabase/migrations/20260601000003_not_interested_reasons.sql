-- =============================================================================
-- Expand and clean up "not interested" lost reasons
-- Migration: 20260601000003_not_interested_reasons.sql
--
-- Existing reasons had verbose labels. Updating to shorter, scan-friendly
-- versions and adding missing reasons (underwriting, timing, existing
-- coverage, other) that the referral team needs.
-- =============================================================================

-- Shorten existing labels
update public.lost_reasons
set agency_label = 'Cost — pricing too high'
where internal_code = 'not_interested_price';

update public.lost_reasons
set agency_label = 'Declined to receive a quote'
where internal_code = 'not_interested_no_quote';

update public.lost_reasons
set agency_label = 'No appealing options available'
where internal_code = 'not_interested_options';

-- Add missing reasons
insert into public.lost_reasons (internal_code, agency_label, sort_order) values
  ('not_interested_underwriting', 'Underwriting — health concerns',    18),
  ('not_interested_timing',       'Not the right time',                19),
  ('not_interested_existing',     'Already has adequate coverage',     20),
  ('not_interested_other',        'Other',                             99)
on conflict (internal_code) do nothing;
