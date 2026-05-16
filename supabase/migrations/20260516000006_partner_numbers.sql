-- =============================================================================
-- Migration: Allstate Partner Numbers on Agencies
-- Migration: 20260516000006_partner_numbers.sql
--
-- Source: AF New Business Policy and Transaction Detail Report (AF NB Policy Details sheet)
-- Generated: 2026-05-16
--
-- Partner number format: full Allstate format begins with "A0" (e.g. A0C4775).
-- The DASH compensation report drops the leading "A", showing e.g. "0C4775".
-- All values here restore the leading "A": stored as "A" + DASH value.
--
-- VERIFY BEFORE RUNNING: Confirm one known partner number (e.g. Kris Aley's)
-- against the Allstate agent portal to ensure the A0 prefix format is correct.
--
-- MATCH SUMMARY (37 unique partner numbers found in comp report + 1 manual add)
--   All 38 resolved — no pending items.
--
--   Notes:
--   - McQuoid: Allstate typo (MCQUIOD in system) — confirmed same person
--   - Tom Birks: 0B2987 = NJ, 0D9474 = PA
--   - Amanda McCall: 0C6074 (New Town Insurance Agency Inc)
--   - Michael McCall: 057842 (different number series, no letter prefix;
--     no business placed yet so not in comp report — added manually)
-- =============================================================================


-- ── 35 confirmed matches ──────────────────────────────────────────────────────

update public.agencies set allstate_partner_number = 'A0A0466' where slug = 'burger-john';
update public.agencies set allstate_partner_number = 'A0A3310' where slug = 'andres-joseph';
update public.agencies set allstate_partner_number = 'A0A3381' where slug = 'mcquoid-brian';
update public.agencies set allstate_partner_number = 'A0A5297' where slug = 'malburg-leslie';
update public.agencies set allstate_partner_number = 'A0A7841' where slug = 'brown-lisa';
update public.agencies set allstate_partner_number = 'A0A8443' where slug = 'brumbaugh-jill';
update public.agencies set allstate_partner_number = 'A0B0858' where slug = 'sheeley-debbie';
update public.agencies set allstate_partner_number = 'A0B3292' where slug = 'lentz-brian';
update public.agencies set allstate_partner_number = 'A0B7073' where slug = 'reuss-kimberly';
update public.agencies set allstate_partner_number = 'A0B9205' where slug = 'walling-mike';
update public.agencies set allstate_partner_number = 'A0B9477' where slug = 'redinger-lance';
update public.agencies set allstate_partner_number = 'A0C2025' where slug = 'beimel-hal';
update public.agencies set allstate_partner_number = 'A0C2161' where slug = 'yarros-dan';
update public.agencies set allstate_partner_number = 'A0C3187' where slug = 'hughes-amy';
update public.agencies set allstate_partner_number = 'A0C3739' where slug = 'jevicky-john';
update public.agencies set allstate_partner_number = 'A0C3746' where slug = 'waid-stacy';
update public.agencies set allstate_partner_number = 'A0C3748' where slug = 'black-scott';
update public.agencies set allstate_partner_number = 'A0C3883' where slug = 'fisher-tim';
update public.agencies set allstate_partner_number = 'A0C4775' where slug = 'makal-andy-solo';
update public.agencies set allstate_partner_number = 'A0C5499' where slug = 'ebersole-heather';
update public.agencies set allstate_partner_number = 'A0C6074' where slug = 'mccall-amanda-va';
update public.agencies set allstate_partner_number = 'A0C6712' where slug = 'eliason-kevin';
update public.agencies set allstate_partner_number = 'A0D1199' where slug = 'talarico-earl';
update public.agencies set allstate_partner_number = 'A0D2179' where slug = 'ritter-greg';
update public.agencies set allstate_partner_number = 'A0D6212' where slug = 'thumm-austin';
update public.agencies set allstate_partner_number = 'A0D7480' where slug = 'vanderbeck-brandon';
update public.agencies set allstate_partner_number = 'A0D8066' where slug = 'evans-dana';
update public.agencies set allstate_partner_number = 'A0D8071' where slug = 'sizemore-jennifer';
update public.agencies set allstate_partner_number = 'A0D8484' where slug = 'bowler-ryan';
update public.agencies set allstate_partner_number = 'A0D8495' where slug = 'aley-kris';
update public.agencies set allstate_partner_number = 'A0D8781' where slug = 'bianco-brittany';
update public.agencies set allstate_partner_number = 'A0E0148' where slug = 'talt-matthew';
update public.agencies set allstate_partner_number = 'A0E0422' where slug = 'andujar-hector';
update public.agencies set allstate_partner_number = 'A0E0535' where slug = 'rader-christopher';
update public.agencies set allstate_partner_number = 'A0F0299' where slug = 'bin-danny';


-- ── Remaining confirmed matches ───────────────────────────────────────────────

-- Tom Birks: 0B2987 = NJ, 0D9474 = PA (confirmed)
update public.agencies set allstate_partner_number = 'A0B2987' where slug = 'birks-thomas-nj';
update public.agencies set allstate_partner_number = 'A0D9474' where slug = 'birks-thomas-pa';

-- Michael McCall: number is 057842 (no letter prefix — different Allstate series)
-- No business placed yet so won't appear in comp report; added for future matching.
update public.agencies set allstate_partner_number = 'A057842' where slug = 'mccall-mike-va';
