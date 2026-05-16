-- =============================================================================
-- RPAS Agency Seed Data
-- Migration: 20260516000004_agencies_seed.sql
--
-- Source: Makal 2026 Dashboard.xlsx — Settings sheet, Agent Partners column.
-- 125 agency entries. Slugs are stable identifiers; tokens generated on first
-- insert only (on conflict do nothing).
--
-- RONSVAILE typo corrected to RONSVALLE before seeding.
-- Agencies with unknown SML team have sml_team_id = null — update when confirmed.
-- =============================================================================

-- Fix typo from Phase 1 seed: RONSVAILE → RONSVALLE
update public.sml_teams
   set code = 'RONSVALLE', display_name = 'Ronsvalle'
 where code = 'RONSVAILE';


insert into public.agencies (name, slug, dashboard_token, sml_team_id, is_active) values

  -- ── SHOKALOOK (34) ──────────────────────────────────────────────────────────
  ('ALEY, KRIS',                    'aley-kris',           gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('ANDUJAR INSURANCE AGENCY',      'andujar-hector',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('MATT BARCZYK AGENCY INC',       'barczyk-matthew',     gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('BATES, DAVID',                  'bates-david',         gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('BIANCO, BRITTNEY',              'bianco-brittany',     gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('BICKART, MICHAEL',              'bickart-michael',     gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('SCOTT BLACK LLC',               'black-scott',         gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('BOGDAN, BLAIR',                 'bogdan-blair',        gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('LISA BROWN AGENCY',             'brown-lisa',          gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('BRUMBAUGH, JILL',               'brumbaugh-jill',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('BUHL INSURANCE AGENCY INC',     'buhl-aaron',          gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('DEASY, RYAN',                   'deasy-ryan',          gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('EVANS, DANA',                   'evans-dana',          gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('GAGIANAS, NICHOLAS',            'gagianas-nick',       gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('HUGHES, SHALICIA',              'hughes-shalicia',     gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('JOHN JEVICKY AGENCY',           'jevicky-john',        gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('MALBURG, LESLIE JANE',          'malburg-leslie',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('NICASTRO INSURANCE AGENCY INC', 'nicastro-gino',       gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('OSINUGA, FISAYO',               'osinuga-fisayo',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('RADER CONSULTING LLC',          'rader-christopher',   gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('RALPH FAMILY INSURANCE',        'ralph-brian',         gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('REDINGER, LANCE',               'redinger-lance',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('REIMER, MICHAEL',               'reimer-michael',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('REUSS AGENCY LLC',              'reuss-kimberly',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('ROSE S INSURANCE INC',          'rose-don',            gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('SHEELEY AGENCY',                'sheeley-debbie',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('THE STIGER AGENCY INC',         'stiger-heather',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('TALT, MATTHEW',                 'talt-matthew',        gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('THUMM, AUSTIN',                 'thumm-austin',        gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('WADE, MIKE',                    'wade-mike',           gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('STACY M WAID LLC',              'waid-stacy',          gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('JEFFREY J WALCH',               'walch-jeff',          gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('WALCH, KRISTEN',                'walch-kristen',       gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),
  ('WALLING, MICHAEL',              'walling-mike',        gen_random_uuid()::text, (select id from public.sml_teams where code = 'SHOKALOOK'), true),

  -- ── COLLINS (29) ────────────────────────────────────────────────────────────
  ('ANDRES, JOE',                        'andres-joseph',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('BEIMEL, HAL',                        'beimel-hal',         gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('TOM BIRKS AGENCY (PA)',              'birks-thomas-pa',    gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('BOWLER, RYAN',                       'bowler-ryan',        gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('COLUCCI, DEBRA',                     'colucci-debra',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('GEORGE DENGER INS AGENCIES INC',     'denger-george',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('KEVIN DICKEY AGENCY',                'dickey-kevin',       gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('J DOUGHERTY AGENCY',                 'dougherty-jeff',     gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('FISHER, MELISSA',                    'fisher-melissa',     gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('FISHER, TIMOTHY',                    'fisher-tim',         gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('FOSSILE, DANIEL',                    'fossile-dan',        gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('GIBSON, JOSH',                       'gibson-josh',        gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('HUGHES, AMY',                        'hughes-amy',         gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('KANAREK, TANIA',                     'kanarek-tania',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('MCNEALIS, GARY',                     'mcnealis-gary',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('RODARMEL, RENNIE JR',                'rodarmel-rennie-jr', gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('RODARMEL, RENNIE SR',                'rodarmel-rennie-sr', gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('ROSS, MICHAEL',                      'ross-michael',       gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('SCHAEFFER, MIKE',                    'schaeffer-mike',     gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('SHAW, ROBERT L',                     'shaw-rob',           gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('SHEEHAN INSURANCE LLC',              'sheehan-cullen',     gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('SIDDIQUI, FARAAZ',                   'siddiqui-faraaz',    gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('STONE, TRICIA',                      'stone-tricia',       gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('EARL TALARICO AGENCY',               'talarico-earl',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('TSIKALAS INSURANCE AGENCY (Brian)',  'tsikalas-brian',     gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('TSIKALAS INSURANCE AGENCY (Perry)',  'tsikalas-perry',     gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('YARROS, DAN',                        'yarros-dan',         gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),
  ('ZELESNICK FINANCIAL GROUP, INC',     'zelesnick-chris',    gen_random_uuid()::text, (select id from public.sml_teams where code = 'COLLINS'), true),

  -- ── LANGDALE (14) ───────────────────────────────────────────────────────────
  ('DUBLIN INSURANCE AGENCY LLC',        'belli-nancy',        gen_random_uuid()::text, (select id from public.sml_teams where code = 'LANGDALE'), true),
  ('BINSURANCE LLC',                     'bin-danny',          gen_random_uuid()::text, (select id from public.sml_teams where code = 'LANGDALE'), true),
  ('J L B AGENCY INC',                   'burger-john',        gen_random_uuid()::text, (select id from public.sml_teams where code = 'LANGDALE'), true),
  ('WESTDALE INSURANCE AGENCY INC',      'dale-christian',     gen_random_uuid()::text, (select id from public.sml_teams where code = 'LANGDALE'), true),
  ('ELIASON, KEVIN',                     'eliason-kevin',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'LANGDALE'), true),
  ('KING ASSET PROTECTION INC',          'king-brian',         gen_random_uuid()::text, (select id from public.sml_teams where code = 'LANGDALE'), true),
  ('LENTZ AGENCY',                       'lentz-brian',        gen_random_uuid()::text, (select id from public.sml_teams where code = 'LANGDALE'), true),
  ('DAVID LIEBERMAN FINANCIAL SERVICES', 'lieberman-david-pa', gen_random_uuid()::text, (select id from public.sml_teams where code = 'LANGDALE'), true),
  ('MCQUOID, BRIAN',                     'mcquoid-brian',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'LANGDALE'), true),
  ('MITCHELL, MOSES',                    'mitchell-moses',     gen_random_uuid()::text, (select id from public.sml_teams where code = 'LANGDALE'), true),
  ('NICOLUCCI, JOHN',                    'nicolucci-john',     gen_random_uuid()::text, (select id from public.sml_teams where code = 'LANGDALE'), true),
  ('PROSSEN, BRIAN',                     'prossen-brian',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'LANGDALE'), true),
  ('RICCI, HANK',                        'ricci-hank',         gen_random_uuid()::text, (select id from public.sml_teams where code = 'LANGDALE'), true),
  ('VEREB, LINDSAY',                     'vereb-lindsay',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'LANGDALE'), true),

  -- ── WISCHUM (16) ────────────────────────────────────────────────────────────
  ('ANDERSON INS SERVICES INC',          'anderson-tonia',     gen_random_uuid()::text, (select id from public.sml_teams where code = 'WISCHUM'), true),
  ('CASSIDY AGENCY INC',                 'cassidy-jerry-amy',  gen_random_uuid()::text, (select id from public.sml_teams where code = 'WISCHUM'), false), -- succeeded by Maltsev, Gene
  ('CONNELLY, JANA',                     'connelly-jana',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'WISCHUM'), true),
  ('DOWNEY, DAVID',                      'downey-david',       gen_random_uuid()::text, (select id from public.sml_teams where code = 'WISCHUM'), true),
  ('EBERSOLE AGENCY',                    'ebersole-heather',   gen_random_uuid()::text, (select id from public.sml_teams where code = 'WISCHUM'), true),
  ('FITZMAURICE, KEVIN',                 'fitzmaurice-kevin',  gen_random_uuid()::text, (select id from public.sml_teams where code = 'WISCHUM'), true),
  ('JAMES, JOHANNA',                     'james-johanna',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'WISCHUM'), true),
  ('TIM MCSHANE AGENCY INC',             'mcshane-tim',        gen_random_uuid()::text, (select id from public.sml_teams where code = 'WISCHUM'), true),
  ('BRIAN MILLER AGENCY',                'miller-brian',       gen_random_uuid()::text, (select id from public.sml_teams where code = 'WISCHUM'), true),
  ('O''SULLIVAN, DONNA',                 'osullivan-donna',    gen_random_uuid()::text, (select id from public.sml_teams where code = 'WISCHUM'), true),
  ('PERKINS, MONICA',                    'perkins-monica',     gen_random_uuid()::text, (select id from public.sml_teams where code = 'WISCHUM'), true),
  ('BERNIERI ASSOCIATES INSURANCE',      'ritter-greg',        gen_random_uuid()::text, (select id from public.sml_teams where code = 'WISCHUM'), true),
  ('STEINER INSURANCE LLC',              'steiner-kristy',     gen_random_uuid()::text, (select id from public.sml_teams where code = 'WISCHUM'), true),
  ('VANDERBECK, BRANDON',                'vanderbeck-brandon', gen_random_uuid()::text, (select id from public.sml_teams where code = 'WISCHUM'), true),
  ('WARD, JIM',                          'ward-jim',           gen_random_uuid()::text, (select id from public.sml_teams where code = 'WISCHUM'), true),
  ('TJY AGENCY LLC',                     'youngman-theodore',  gen_random_uuid()::text, (select id from public.sml_teams where code = 'WISCHUM'), true),

  -- ── RONSVALLE (8) ───────────────────────────────────────────────────────────
  ('CICMANSKY, LORGIA',                  'cicmansky-lorgia',   gen_random_uuid()::text, (select id from public.sml_teams where code = 'RONSVALLE'), true),
  ('DATIL INS AGENCY',                   'datil-bruce',        gen_random_uuid()::text, (select id from public.sml_teams where code = 'RONSVALLE'), true),
  ('DWYER, SUZANNE',                     'dwyer-suzanne',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'RONSVALLE'), true),
  ('JENNERSVILLE INSURANCE AGENCY',      'stead-robert',       gen_random_uuid()::text, (select id from public.sml_teams where code = 'RONSVALLE'), true),
  ('TAUB, STEVEN',                       'taub-steven',        gen_random_uuid()::text, (select id from public.sml_teams where code = 'RONSVALLE'), true),
  ('TRALIE, JOSEPH',                     'tralie-joseph',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'RONSVALLE'), true),
  ('VACCHIANO INSURANCE AGENCY INC',     'vacchiano-sal',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'RONSVALLE'), true),
  ('WADE INS AGENCY',                    'wade-joe',           gen_random_uuid()::text, (select id from public.sml_teams where code = 'RONSVALLE'), true),

  -- ── TEAM MAKAL EFS (8) ──────────────────────────────────────────────────────
  ('DEMAIO, CHRISTOPHER',                'demaio-christopher', gen_random_uuid()::text, (select id from public.sml_teams where code = 'TEAM MAKAL EFS'), true),
  ('DEMAIO, PETER',                      'demaio-peter',       gen_random_uuid()::text, (select id from public.sml_teams where code = 'TEAM MAKAL EFS'), true),
  ('THE EKBLADE-RYNASKI AGENCY LLC',     'ekblade-erik',       gen_random_uuid()::text, (select id from public.sml_teams where code = 'TEAM MAKAL EFS'), true),
  ('LECHMANIK, MARK',                    'lechmanik-mark',     gen_random_uuid()::text, (select id from public.sml_teams where code = 'TEAM MAKAL EFS'), true),
  ('MAKAL, ANDY',                        'makal-andy-solo',    gen_random_uuid()::text, (select id from public.sml_teams where code = 'TEAM MAKAL EFS'), true),
  ('1ST CHOICE INSURANCE GROUP',         'sizemore-jennifer',  gen_random_uuid()::text, (select id from public.sml_teams where code = 'TEAM MAKAL EFS'), true),
  ('TAYLOR, JARED',                      'taylor-jared',       gen_random_uuid()::text, (select id from public.sml_teams where code = 'TEAM MAKAL EFS'), true),
  ('MODERN CONSULTING INC',              'waltrip-tim',        gen_random_uuid()::text, (select id from public.sml_teams where code = 'TEAM MAKAL EFS'), true),

  -- ── NJ (3) ──────────────────────────────────────────────────────────────────
  ('TOM BIRKS AGENCY (NJ)',              'birks-thomas-nj',    gen_random_uuid()::text, (select id from public.sml_teams where code = 'NJ'), true),
  ('HORTA, CHARLES',                     'horta-charles-nj',   gen_random_uuid()::text, (select id from public.sml_teams where code = 'NJ'), true),
  ('LIEBERMAN FINANCIAL',                'lieberman-david-nj', gen_random_uuid()::text, (select id from public.sml_teams where code = 'NJ'), true),

  -- ── VA (2) ──────────────────────────────────────────────────────────────────
  ('NEW TOWN INSURANCE AGENCY INC',      'mccall-amanda-va',   gen_random_uuid()::text, (select id from public.sml_teams where code = 'VA'), true),
  ('MCCALL INC',                         'mccall-mike-va',     gen_random_uuid()::text, (select id from public.sml_teams where code = 'VA'), true),

  -- ── AL (2) ──────────────────────────────────────────────────────────────────
  ('BO COCHRAN AGENCY LLC',              'cochran-bo-al',      gen_random_uuid()::text, (select id from public.sml_teams where code = 'AL'), true),
  ('JORDAN, EARNEST J',                  'jordan-earnest-al',  gen_random_uuid()::text, (select id from public.sml_teams where code = 'AL'), true),

  -- ── RI (1) ──────────────────────────────────────────────────────────────────
  ('NAPPI, JENNIFER',                    'nappi-jennifer-ri',  gen_random_uuid()::text, (select id from public.sml_teams where code = 'RI'), true),

  -- ── CT (2) ──────────────────────────────────────────────────────────────────
  ('ANTHONY J MARCIANO AGENCY LLC',      'marciano-anthony-ct',gen_random_uuid()::text, (select id from public.sml_teams where code = 'CT'), true),
  ('SAUNDERS INSURANCE AGENCY LLC',      'saunders-michael-ct',gen_random_uuid()::text, (select id from public.sml_teams where code = 'CT'), true),

  -- ── NH (1) ──────────────────────────────────────────────────────────────────
  ('THOMPSON, CRYSTAL',                  'thompson-crystal-nh',gen_random_uuid()::text, (select id from public.sml_teams where code = 'NH'), true),

  -- ── SML TEAM UNCONFIRMED — update sml_team_id when confirmed (6) ───────────
  ('H&A INSURANCE',                      'almaguer-hermes',    gen_random_uuid()::text, null, true),
  ('CHIAVERINI, ANNA',                   'chiaverini-anna',    gen_random_uuid()::text, null, true),
  ('COMO, PAUL',                         'como-paul',          gen_random_uuid()::text, null, true),
  ('JONES, DAVID',                       'jones-david',        gen_random_uuid()::text, null, true),
  ('MALTSEV, GENE',                      'maltsev-gene',       gen_random_uuid()::text, (select id from public.sml_teams where code = 'WISCHUM'), true),
  ('VALAIS, MARIO',                      'valais-mario',       gen_random_uuid()::text, null, true)

on conflict (slug) do nothing;
