-- =============================================================================
-- Migration: Allstate Partner Numbers on Agencies
-- Migration: 20260516000006_partner_numbers.sql
--
-- Source: AF New Business Policy and Transaction Detail Report (AF NB Policy Details sheet)
-- Generated: 2026-05-16
--
-- Partner number format is 0[letter]#### (e.g. 0A0466, 0C4775) — NOT "A0" prefix.
--
-- MATCH SUMMARY (37 unique partner numbers found in comp report)
--   Matched cleanly    : 33
--   Matched with note  :  1  (0C6074 — see note below)
--   Unmatched          :  3  (see commented section at bottom — needs manual confirmation)
--
-- THREE ITEMS NEED MANUAL REVIEW BEFORE UNCOMMENTING:
--
--   1. 0A3381 MCQUIOD, BRIAN
--      Comp report spells the name MCQUIOD; seed has MCQUOID (transposed letters).
--      Almost certainly the same person. Confirm and uncomment.
--
--   2. 0B2987 TOM BIRKS AGENCY
--      Two agencies share this name: birks-thomas-pa and birks-thomas-nj.
--      Determine which entity this number belongs to, then uncomment one line.
--
--   3. 0D9474 TOM BIRKS AGENCY
--      Second Birks number in the comp report. Likely the other PA/NJ entity.
--      Pair with 0B2987 determination above.
--
--   4. 0C6074 NEW TOWN INSURANCE AGENCY INC (note, not unmatched)
--      Assigned to mccall-amanda-va below. Confirm whether mccall-mike-va
--      is a separate entity needing its own number.
-- =============================================================================


-- ── 34 clean matches ─────────────────────────────────────────────────────────

update public.agencies set allstate_partner_number = '0A0466' where slug = 'burger-john';
update public.agencies set allstate_partner_number = '0A3310' where slug = 'andres-joseph';
update public.agencies set allstate_partner_number = '0A5297' where slug = 'malburg-leslie';
update public.agencies set allstate_partner_number = '0A7841' where slug = 'brown-lisa';
update public.agencies set allstate_partner_number = '0A8443' where slug = 'brumbaugh-jill';
update public.agencies set allstate_partner_number = '0B0858' where slug = 'sheeley-debbie';
update public.agencies set allstate_partner_number = '0B3292' where slug = 'lentz-brian';
update public.agencies set allstate_partner_number = '0B7073' where slug = 'reuss-kimberly';
update public.agencies set allstate_partner_number = '0B9205' where slug = 'walling-mike';
update public.agencies set allstate_partner_number = '0B9477' where slug = 'redinger-lance';
update public.agencies set allstate_partner_number = '0C2025' where slug = 'beimel-hal';
update public.agencies set allstate_partner_number = '0C2161' where slug = 'yarros-dan';
update public.agencies set allstate_partner_number = '0C3187' where slug = 'hughes-amy';
update public.agencies set allstate_partner_number = '0C3739' where slug = 'jevicky-john';
update public.agencies set allstate_partner_number = '0C3746' where slug = 'waid-stacy';
update public.agencies set allstate_partner_number = '0C3748' where slug = 'black-scott';
update public.agencies set allstate_partner_number = '0C3883' where slug = 'fisher-tim';
update public.agencies set allstate_partner_number = '0C4775' where slug = 'makal-andy-solo';
update public.agencies set allstate_partner_number = '0C5499' where slug = 'ebersole-heather';
update public.agencies set allstate_partner_number = '0C6074' where slug = 'mccall-amanda-va'; -- see note above
update public.agencies set allstate_partner_number = '0C6712' where slug = 'eliason-kevin';
update public.agencies set allstate_partner_number = '0D1199' where slug = 'talarico-earl';
update public.agencies set allstate_partner_number = '0D2179' where slug = 'ritter-greg';
update public.agencies set allstate_partner_number = '0D6212' where slug = 'thumm-austin';
update public.agencies set allstate_partner_number = '0D7480' where slug = 'vanderbeck-brandon';
update public.agencies set allstate_partner_number = '0D8066' where slug = 'evans-dana';
update public.agencies set allstate_partner_number = '0D8071' where slug = 'sizemore-jennifer';
update public.agencies set allstate_partner_number = '0D8484' where slug = 'bowler-ryan';
update public.agencies set allstate_partner_number = '0D8495' where slug = 'aley-kris';
update public.agencies set allstate_partner_number = '0D8781' where slug = 'bianco-brittany';
update public.agencies set allstate_partner_number = '0E0148' where slug = 'talt-matthew';
update public.agencies set allstate_partner_number = '0E0422' where slug = 'andujar-hector';
update public.agencies set allstate_partner_number = '0E0535' where slug = 'rader-christopher';
update public.agencies set allstate_partner_number = '0F0299' where slug = 'bin-danny';


-- ── Needs manual confirmation — uncomment after verifying ────────────────────

-- 1. McQuoid — comp report has MCQUIOD (likely typo); confirm before applying:
-- update public.agencies set allstate_partner_number = '0A3381' where slug = 'mcquoid-brian';

-- 2 & 3. Tom Birks — two numbers, two agencies (PA and NJ). Assign accordingly:
-- update public.agencies set allstate_partner_number = '0B2987' where slug = 'birks-thomas-pa';
-- update public.agencies set allstate_partner_number = '0D9474' where slug = 'birks-thomas-nj';
-- -- OR swap the two numbers above if PA/NJ assignment is reversed.
