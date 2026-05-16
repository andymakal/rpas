-- =============================================================================
-- Migration: More Allstate Partner Numbers
-- Migration: 20260516000007_more_partner_numbers.sql
--
-- Source: GDC import batch e37ed8bc-2331-48a5-a0ba-598e54f12be4
-- Generated: 2026-05-16
--
-- Resolves 40 unmatched partner numbers from the first compensation report import.
-- All agencies were already in the agencies table but lacked allstate_partner_number.
-- Five agencies (marked NEW) were not in the seed and are inserted here.
--
-- VERIFY BEFORE RUNNING:
--   RODARMEL, RENNEL W (A017735) — mapped to rodarmel-rennie-sr; confirm Sr vs Jr
--   TSIKALAS (A044166)           — mapped to tsikalas-brian; confirm Brian vs Perry
-- =============================================================================


-- =============================================================================
-- 1. INSERT FIVE AGENCIES NOT IN ORIGINAL SEED
-- =============================================================================

-- Kansas/Missouri agencies inherited when Bob joined the team.
-- sml_team_id left null until a KS/MO SML team is created.
insert into public.agencies (name, slug, dashboard_token, sml_team_id, is_active)
values
  ('THE TIFFANY AGCY INC',  'tiffany-agency',  gen_random_uuid()::text, null, true),
  ('STAGG, AMANDA',         'stagg-amanda',    gen_random_uuid()::text, null, true),
  ('CARTER AGENCY',         'carter-agency',   gen_random_uuid()::text, null, true),
  ('THE BINNER GROUP',      'binner-group',    gen_random_uuid()::text, null, true),
  ('REINHART, TONY',        'reinhart-tony',   gen_random_uuid()::text, null, true)
on conflict (slug) do nothing;


-- =============================================================================
-- 2. SET PARTNER NUMBERS — agencies already in seed
-- =============================================================================

update public.agencies set allstate_partner_number = 'A032787' where slug = 'bogdan-blair';
update public.agencies set allstate_partner_number = 'A047816' where slug = 'rose-don';
update public.agencies set allstate_partner_number = 'A050310' where slug = 'nappi-jennifer-ri';
update public.agencies set allstate_partner_number = 'A062694' where slug = 'dickey-kevin';
update public.agencies set allstate_partner_number = 'A063577' where slug = 'waltrip-tim';         -- MODERN CONSULTING INC
update public.agencies set allstate_partner_number = 'A041722' where slug = 'colucci-debra';
update public.agencies set allstate_partner_number = 'A005665' where slug = 'osullivan-donna';
update public.agencies set allstate_partner_number = 'A0F9833' where slug = 'maltsev-gene';
update public.agencies set allstate_partner_number = 'A035887' where slug = 'horta-charles-nj';   -- CHARLES HORTA INC
update public.agencies set allstate_partner_number = 'A017898' where slug = 'mcshane-tim';
update public.agencies set allstate_partner_number = 'A048528' where slug = 'nicastro-gino';
update public.agencies set allstate_partner_number = 'A0D1116' where slug = 'siddiqui-faraaz';
update public.agencies set allstate_partner_number = 'A063183' where slug = 'steiner-kristy';
update public.agencies set allstate_partner_number = 'A037285' where slug = 'king-brian';
update public.agencies set allstate_partner_number = 'A079915' where slug = 'buhl-aaron';
update public.agencies set allstate_partner_number = 'A099187' where slug = 'denger-george';
update public.agencies set allstate_partner_number = 'A058161' where slug = 'anderson-tonia';
update public.agencies set allstate_partner_number = 'A079153' where slug = 'taub-steven';
update public.agencies set allstate_partner_number = 'A041922' where slug = 'downey-david';
update public.agencies set allstate_partner_number = 'A051772' where slug = 'fisher-melissa';
update public.agencies set allstate_partner_number = 'A024224' where slug = 'walch-jeff';
update public.agencies set allstate_partner_number = 'A078114' where slug = 'jordan-earnest-al';
update public.agencies set allstate_partner_number = 'A037817' where slug = 'walch-kristen';
update public.agencies set allstate_partner_number = 'A063763' where slug = 'lieberman-david-nj'; -- LIEBERMAN FINANCIAL
update public.agencies set allstate_partner_number = 'A061536' where slug = 'ricci-hank';
update public.agencies set allstate_partner_number = 'A051883' where slug = 'cochran-bo-al';
update public.agencies set allstate_partner_number = 'A050561' where slug = 'sheehan-cullen';
update public.agencies set allstate_partner_number = 'A060571' where slug = 'saunders-michael-ct';
update public.agencies set allstate_partner_number = 'A036201' where slug = 'james-johanna';
update public.agencies set allstate_partner_number = 'A042230' where slug = 'stead-robert';       -- JENNERSVILLE INS AY
update public.agencies set allstate_partner_number = 'A038957' where slug = 'ralph-brian';
update public.agencies set allstate_partner_number = 'A064808' where slug = 'ekblade-erik';
update public.agencies set allstate_partner_number = 'A030360' where slug = 'wade-joe';

-- VERIFY: RODARMEL, RENNEL W — assuming Sr; change to rodarmel-rennie-jr if wrong
update public.agencies set allstate_partner_number = 'A017735' where slug = 'rodarmel-rennie-sr';

-- Perry Tsikalas confirmed
update public.agencies set allstate_partner_number = 'A044166' where slug = 'tsikalas-perry';


-- =============================================================================
-- 3. SET PARTNER NUMBERS — five new agencies inserted above
-- =============================================================================

update public.agencies set allstate_partner_number = 'A0A1614' where slug = 'tiffany-agency';
update public.agencies set allstate_partner_number = 'A0B4710' where slug = 'stagg-amanda';
update public.agencies set allstate_partner_number = 'A0B3215' where slug = 'carter-agency';
update public.agencies set allstate_partner_number = 'A048451' where slug = 'binner-group';
update public.agencies set allstate_partner_number = 'A0A7900' where slug = 'reinhart-tony';


-- =============================================================================
-- 4. BACKFILL GDC RECORDS — link previously unmatched rows to their agencies
-- =============================================================================

update public.gdc_records g
set agency_id = a.id
from public.agencies a
where g.agency_id is null
  and g.allstate_partner_number = a.allstate_partner_number;
