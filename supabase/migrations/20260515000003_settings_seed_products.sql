-- =============================================================================
-- RPAS Settings Layer — Product Catalog Seed
-- Migration: 20260515000003_settings_seed_products.sql
--
-- Source: "Company" + "Product" + "GDC Percentage" columns from Settings sheet.
-- Run AFTER 20260515000002 (carriers and product_types must exist).
-- All inserts use ON CONFLICT DO NOTHING — safe to re-run.
--
-- CARRIER ASSIGNMENT NOTES:
--   - Rows are paired as they appear in the Settings sheet (Company col + Product col).
--   - Some pairings may reflect Allstate's internal routing rather than strict
--     issuing carrier. Verify with Michelle (underwriting) before overriding.
--   - carrier_id is looked up by name using a subquery; if the carrier name
--     doesn't match exactly, the insert silently assigns null. Check logs.
--   - Products after the carrier list runs out in the Settings sheet
--     are inserted with carrier_id = null and marked with "-- verify carrier".
--
-- AGE BANDING:
--   - Annuity products with age-banded GDC schedules share a base product name.
--     min_age / max_age differentiate them. At case entry, select the row
--     matching the client's age at application.
--   - Life products with age in the name (e.g., "Full Pay Under 65") use
--     null age bands — the name itself encodes the band.
--
-- GDC MULTIPLIER KEY:
--   - Life products: values like 1.17 mean 117% of annual premium.
--     This is the Allstate Financial Services GDC schedule, not a percentage.
--   - Annuity products: values like 0.055 mean 5.5% of premium/deposit.
--   - Mutual funds / IRAs: values like 0.01 mean 1% (trail or transaction).
-- =============================================================================


-- =============================================================================
-- HELPER: We'll look up carrier IDs and product type IDs by name inline.
-- Supabase Postgres supports subqueries in insert values.
-- =============================================================================


-- =============================================================================
-- LIFE PRODUCTS — paired from Settings sheet (Company | Product | Multiplier)
-- =============================================================================

-- ── Lincoln ──────────────────────────────────────────────────────────────────
insert into public.products (name, carrier_id, product_type_id, gdc_multiplier) values
  ('Asset Edge VUL',
    (select id from public.carriers where name = 'Lincoln Life & Annuity Company of New York'),
    (select id from public.product_types where name = 'Variable Universal Life (VUL)'),
    1.17),
  ('Lincoln Wealth Accumulate IUL',
    (select id from public.carriers where name = 'Lincoln Life & Annuity Company of New York'),
    (select id from public.product_types where name = 'Indexed Universal Life (IUL)'),
    1.26),
  ('Lincoln VULOne',
    (select id from public.carriers where name = 'Lincoln Life & Annuity Company of New York'),
    (select id from public.product_types where name = 'Variable Universal Life (VUL)'),
    1.17),
  ('Money Guard Fixed',
    -- Lincoln long-term care hybrid (Lincoln MoneyGuard)
    (select id from public.carriers where name = 'Lincoln Life & Annuity Company of New York'),
    (select id from public.product_types where name = 'Long-Term Care Hybrid'),
    0.70),
  ('Money Guard Market',
    (select id from public.carriers where name = 'Lincoln Life & Annuity Company of New York'),
    (select id from public.product_types where name = 'Long-Term Care Hybrid'),
    0.70)
on conflict do nothing;

-- ── Protective Life ───────────────────────────────────────────────────────────
insert into public.products (name, carrier_id, product_type_id, gdc_multiplier) values
  ('Term Accel 10',
    (select id from public.carriers where name = 'Protective Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.18),
  ('Term Accel 15',
    (select id from public.carriers where name = 'Protective Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.29),
  ('Term Accel 20',
    (select id from public.carriers where name = 'Protective Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.41),
  ('Term Accel 30',
    (select id from public.carriers where name = 'Protective Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.41),
  ('Secure Lifetime GUL 3',
    -- Protective Secure Lifetime GUL series
    (select id from public.carriers where name = 'Protective Life Insurance Company'),
    (select id from public.product_types where name = 'Guaranteed Universal Life (GUL)'),
    1.20),
  ('Select-A-Term 10',
    (select id from public.carriers where name = 'Protective Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.10),
  ('Select-A-Term 15',
    (select id from public.carriers where name = 'Protective Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.20),
  ('Select-A-Term 16-19',
    (select id from public.carriers where name = 'Protective Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.35),
  ('Select-A-Term 20+',
    (select id from public.carriers where name = 'Protective Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.40)
on conflict do nothing;

-- ── Foresters ─────────────────────────────────────────────────────────────────
insert into public.products (name, carrier_id, product_type_id, gdc_multiplier) values
  ('Advantage Plus II WL Full Pay Under 65',
    (select id from public.carriers where name = 'Foresters Financial Life Insurance'),
    (select id from public.product_types where name = 'Whole Life'),
    1.30),
  ('Advantage Plus II WL Full Pay 66-70',
    (select id from public.carriers where name = 'Foresters Financial Life Insurance'),
    (select id from public.product_types where name = 'Whole Life'),
    1.20),
  ('Advantage Plus II WL Full Pay 71-75',
    (select id from public.carriers where name = 'Foresters Financial Life Insurance'),
    (select id from public.product_types where name = 'Whole Life'),
    1.10),
  ('Advantage Plus II WL 20 Pay Under 65',
    (select id from public.carriers where name = 'Foresters Financial Life Insurance'),
    (select id from public.product_types where name = 'Whole Life'),
    0.825),
  ('Advantage Plus II WL 20 Pay 66-70',
    (select id from public.carriers where name = 'Foresters Financial Life Insurance'),
    (select id from public.product_types where name = 'Whole Life'),
    0.775),
  ('Advantage Plus II WL 20 Pay 71-75',
    (select id from public.carriers where name = 'Foresters Financial Life Insurance'),
    (select id from public.product_types where name = 'Whole Life'),
    0.725),
  ('Foresters UL',
    -- Listed as "Covr - Mutual of Omaha | Foresters UL" in Settings sheet.
    -- Likely a Foresters product placed via Covr channel. Verify.
    (select id from public.carriers where name = 'Foresters Financial Life Insurance'),
    (select id from public.product_types where name = 'Universal Life (UL)'),
    1.30),
  ('Strong Foundations Term 10',
    (select id from public.carriers where name = 'Foresters Financial Life Insurance'),
    (select id from public.product_types where name = 'Term Life'),
    1.30),
  ('Strong Foundations Term 15',
    (select id from public.carriers where name = 'Foresters Financial Life Insurance'),
    (select id from public.product_types where name = 'Term Life'),
    1.50),
  ('Strong Foundations Term 20',
    (select id from public.carriers where name = 'Foresters Financial Life Insurance'),
    (select id from public.product_types where name = 'Term Life'),
    1.50),
  ('Strong Foundations Term 30',
    (select id from public.carriers where name = 'Foresters Financial Life Insurance'),
    (select id from public.product_types where name = 'Term Life'),
    1.50)
on conflict do nothing;

-- ── Corebridge / AIG ─────────────────────────────────────────────────────────
insert into public.products (name, carrier_id, product_type_id, gdc_multiplier) values
  ('Max Accumulator+ III IUL',
    (select id from public.carriers where name = 'Corebridge Financial'),
    (select id from public.product_types where name = 'Indexed Universal Life (IUL)'),
    1.30)
on conflict do nothing;

-- ── John Hancock ─────────────────────────────────────────────────────────────
insert into public.products (name, carrier_id, product_type_id, gdc_multiplier) values
  ('Vitality Term 10',
    (select id from public.carriers where name = 'John Hancock Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.17),
  ('Vitality Term 15',
    (select id from public.carriers where name = 'John Hancock Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.31),
  ('Vitality Term 20-30',
    (select id from public.carriers where name = 'John Hancock Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.38),
  ('Protection Extend IUL',
    (select id from public.carriers where name = 'John Hancock Life Insurance Company'),
    (select id from public.product_types where name = 'Indexed Universal Life (IUL)'),
    0.58),
  ('Protection Term 10',
    (select id from public.carriers where name = 'John Hancock Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.10),
  ('Protection Term 15',
    (select id from public.carriers where name = 'John Hancock Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.20),
  ('Protection Term 20-30',
    (select id from public.carriers where name = 'John Hancock Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.25),
  ('Protection IUL',
    (select id from public.carriers where name = 'John Hancock Life Insurance Company'),
    (select id from public.product_types where name = 'Indexed Universal Life (IUL)'),
    1.20)
on conflict do nothing;

-- ── Everlake (fka Allstate Life) ─────────────────────────────────────────────
insert into public.products (name, carrier_id, product_type_id, gdc_multiplier) values
  ('Life Elements 10',
    (select id from public.carriers where name = 'Everlake Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.18),
  ('Life Elements 15',
    (select id from public.carriers where name = 'Everlake Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.29),
  ('Life Elements 20',
    (select id from public.carriers where name = 'Everlake Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.41),
  ('Life Elements 30',
    (select id from public.carriers where name = 'Everlake Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.41)
on conflict do nothing;

-- ── Gerber ───────────────────────────────────────────────────────────────────
insert into public.products (name, carrier_id, product_type_id, gdc_multiplier) values
  ('Gerber Guaranteed Issue WL',
    (select id from public.carriers where name = 'Gerber Life Insurance Company'),
    (select id from public.product_types where name = 'Guaranteed Issue Whole Life (GI WL)'),
    0.6775)
on conflict do nothing;

-- ── Equitable ─────────────────────────────────────────────────────────────────
insert into public.products (name, carrier_id, product_type_id, gdc_multiplier) values
  ('WealthBuilder IUL',
    (select id from public.carriers where name = 'Equitable Financial Life Insurance Company'),
    (select id from public.product_types where name = 'Indexed Universal Life (IUL)'),
    1.26)
on conflict do nothing;

-- ── North American (Sammons Financial) ───────────────────────────────────────
insert into public.products (name, carrier_id, product_type_id, gdc_multiplier) values
  ('WealthPreserve 2 IUL',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Indexed Universal Life (IUL)'),
    1.17),
  ('WealthPreserve 2 SIUL',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Indexed Universal Life (IUL)'),
    1.17)
on conflict do nothing;

-- ── Pacific Life ──────────────────────────────────────────────────────────────
insert into public.products (name, carrier_id, product_type_id, gdc_multiplier) values
  ('Indexed Choice UL',
    (select id from public.carriers where name = 'Pacific Life Insurance Company'),
    (select id from public.product_types where name = 'Indexed Universal Life (IUL)'),
    1.30)
on conflict do nothing;

-- ── Covr platform products ────────────────────────────────────────────────────
insert into public.products (name, carrier_id, product_type_id, gdc_multiplier) values
  ('Your Term 10 Non-Med',
    (select id from public.carriers where name = 'Assurity Life Insurance (via Covr)'),
    (select id from public.product_types where name = 'Term Life'),
    0.98),
  ('Your Term 15+ Non-Med',
    (select id from public.carriers where name = 'Massachusetts Mutual Life Insurance (via Covr)'),
    (select id from public.product_types where name = 'Term Life'),
    1.45),
  ('Your Term 10 Med',
    (select id from public.carriers where name = 'Principal Life Insurance (via Covr)'),
    (select id from public.product_types where name = 'Term Life'),
    0.98),
  ('Your Term 15+ Med',
    (select id from public.carriers where name = 'Ameritas Life Partners (via Covr)'),
    (select id from public.product_types where name = 'Term Life'),
    1.30)
on conflict do nothing;

-- ── Products requiring carrier verification (null carrier_id) ─────────────────
-- These appear in the Settings sheet after the carrier column runs out,
-- or the carrier association is uncertain. Update carrier_id when confirmed.
insert into public.products (name, carrier_id, product_type_id, gdc_multiplier, notes) values

  -- Venerable / Nationwide / Jackson National — classic choice series
  -- Settings sheet pairs these carriers to Classic Choice products row-by-row.
  -- These may be separate carrier products or internal naming. Verify with Michelle.
  ('Classic Choice 10',
    (select id from public.carriers where name = 'Venerable Insurance and Annuity Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.19, 'Verify carrier'),
  ('Classic Choice 15',
    (select id from public.carriers where name = 'Nationwide Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.32, 'Verify carrier'),
  ('Classic Choice 20+',
    (select id from public.carriers where name = 'Jackson National Life Insurance Company'),
    (select id from public.product_types where name = 'Term Life'),
    1.42, 'Verify carrier'),

  -- Carrier unknown — inserted with null
  ('Lifetime Assurance UL',   null,
    (select id from public.product_types where name = 'Universal Life (UL)'),
    1.30, 'Verify carrier — listed as NFS in Settings sheet'),
  ('Non-Par WL',              null,
    (select id from public.product_types where name = 'Whole Life'),
    1.30, 'Verify carrier — listed as American Funds in Settings sheet'),
  ('Strategic Objectives VUL II', null,
    (select id from public.product_types where name = 'Variable Universal Life (VUL)'),
    1.25, 'Verify carrier — listed as Invesco in Settings sheet'),
  ('Value+ Protector II IUL', null,
    (select id from public.product_types where name = 'Indexed Universal Life (IUL)'),
    1.20, 'Verify carrier'),
  ('American Elite WL 2',     null,
    (select id from public.product_types where name = 'Whole Life'),
    0.85, 'Verify carrier'),
  ('Accumulation VUL',        null,
    (select id from public.product_types where name = 'Variable Universal Life (VUL)'),
    1.20, 'Verify carrier'),
  ('Custom Choice UL 10',     null,
    (select id from public.product_types where name = 'Universal Life (UL)'),
    1.10, 'Verify carrier — possibly Protective'),
  ('Custom Choice UL 15',     null,
    (select id from public.product_types where name = 'Universal Life (UL)'),
    1.25, 'Verify carrier'),
  ('Custom Choice UL 20',     null,
    (select id from public.product_types where name = 'Universal Life (UL)'),
    1.30, 'Verify carrier'),
  ('Custom Choice UL 30',     null,
    (select id from public.product_types where name = 'Universal Life (UL)'),
    1.30, 'Verify carrier'),
  ('Wealth Protector IUL',    null,
    (select id from public.product_types where name = 'Indexed Universal Life (IUL)'),
    1.26, 'Verify carrier')

on conflict do nothing;


-- =============================================================================
-- EQUITABLE ANNUITIES (age-banded)
-- SCS = Structured Capital Strategies (RILA)
-- Retirement Cornerstone = Variable Annuity
-- =============================================================================
insert into public.products
  (name, carrier_id, product_type_id, gdc_multiplier, min_age, max_age) values

  ('Structured Capital Strategies (SCS) Income',
    (select id from public.carriers where name = 'Equitable Financial Life Insurance Company'),
    (select id from public.product_types where name = 'Registered Index-Linked Annuity (RILA)'),
    0.060, 45, 80),

  ('SCS Plus 21 B',
    (select id from public.carriers where name = 'Equitable Financial Life Insurance Company'),
    (select id from public.product_types where name = 'Registered Index-Linked Annuity (RILA)'),
    0.060, 0, 80),
  ('SCS Plus 21 B',
    (select id from public.carriers where name = 'Equitable Financial Life Insurance Company'),
    (select id from public.product_types where name = 'Registered Index-Linked Annuity (RILA)'),
    0.0325, 81, 85),

  ('SCS Plus 21 Select',
    (select id from public.carriers where name = 'Equitable Financial Life Insurance Company'),
    (select id from public.product_types where name = 'Registered Index-Linked Annuity (RILA)'),
    0.010, null, null),

  ('Retirement Cornerstone 19B',
    (select id from public.carriers where name = 'Equitable Financial Life Insurance Company'),
    (select id from public.product_types where name = 'Variable Annuity (VA)'),
    0.070, 0, 80),

  ('Retirement Cornerstone 19CP',
    (select id from public.carriers where name = 'Equitable Financial Life Insurance Company'),
    (select id from public.product_types where name = 'Variable Annuity (VA)'),
    0.070, 0, 70),

  ('Choice Plus Assurance B VA',
    (select id from public.carriers where name = 'Equitable Financial Life Insurance Company'),
    (select id from public.product_types where name = 'Variable Annuity (VA)'),
    0.070, 0, 80)

on conflict do nothing;


-- =============================================================================
-- NORTH AMERICAN (SAMMONS) ANNUITIES — OptiBlend FIA (age-banded)
-- =============================================================================
insert into public.products
  (name, carrier_id, product_type_id, gdc_multiplier, min_age, max_age) values

  ('OptiBlend 5 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.035, 0, 74),
  ('OptiBlend 5 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.0265, 75, 79),
  ('OptiBlend 5 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.0165, 80, 84),

  ('OptiBlend 7 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.055, 0, 74),
  ('OptiBlend 7 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.0375, 75, 79),
  ('OptiBlend 7 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.0275, 80, 84),
  ('OptiBlend 7 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.0113, 85, 99),

  ('OptiBlend 10 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.055, 0, 74),
  ('OptiBlend 10 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.033, 74, 79),
  ('OptiBlend 10 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.0105, 80, 99)

on conflict do nothing;


-- =============================================================================
-- NORTH AMERICAN (SAMMONS) ANNUITIES — LiveWell series (age-banded)
-- =============================================================================
insert into public.products
  (name, carrier_id, product_type_id, gdc_multiplier, min_age, max_age) values

  -- LiveWell MYGA Fixed
  ('LiveWell MYGA 3 Fixed',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Multi-Year Guaranteed Annuity (MYGA)'),
    0.0125, 0, 80),
  ('LiveWell MYGA 3 Fixed',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Multi-Year Guaranteed Annuity (MYGA)'),
    0.0063, 81, 90),

  ('LiveWell MYGA 5/7 Fixed',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Multi-Year Guaranteed Annuity (MYGA)'),
    0.0225, 0, 80),
  ('LiveWell MYGA 5/7 Fixed',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Multi-Year Guaranteed Annuity (MYGA)'),
    0.0113, 81, 90),

  -- LiveWell Preferred FIA
  ('LiveWell Preferred 5 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.0338, 0, 75),
  ('LiveWell Preferred 5 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.0275, 76, 80),
  ('LiveWell Preferred 5 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.017, 81, 85),

  ('LiveWell Preferred 7 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.0525, 0, 75),
  ('LiveWell Preferred 7 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.035, 76, 80),
  ('LiveWell Preferred 7 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.030, 81, 85),

  ('LiveWell Preferred 8 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.0575, 0, 75),
  ('LiveWell Preferred 8 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.035, 76, 80),
  ('LiveWell Preferred 8 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.0325, 81, 85),

  ('LiveWell Preferred 10 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.065, 0, 75),
  ('LiveWell Preferred 10 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.030, 76, 79),

  -- LiveWell Variable Annuity
  ('LiveWell VA 5',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Variable Annuity (VA)'),
    0.0625, 0, 80),

  ('LiveWell VA 7',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Variable Annuity (VA)'),
    0.065, 0, 80),

  -- LiveWell Dynamic Annuity
  ('LiveWell Dynamic Annuity',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Variable Annuity (VA)'),
    0.065, 0, 80),
  ('LiveWell Dynamic Annuity',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Variable Annuity (VA)'),
    0.0325, 81, 85)

on conflict do nothing;


-- =============================================================================
-- NORTH AMERICAN — Summit Navigate FIA (age-banded)
-- =============================================================================
insert into public.products
  (name, carrier_id, product_type_id, gdc_multiplier, min_age, max_age) values

  ('Summit Focus 3 FIA',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.030, 0, 80),

  ('Summit Navigate 5',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.040, 0, 75),
  ('Summit Navigate 5',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.030, 76, 79),
  ('Summit Navigate 5',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.020, 80, 85),

  ('Summit Navigate 7',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.055, 0, 75),
  ('Summit Navigate 7',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.0413, 76, 79),
  ('Summit Navigate 7',
    (select id from public.carriers where name = 'North American Company for Life and Health'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.0275, 80, 85)

on conflict do nothing;


-- =============================================================================
-- PRUDENTIAL ANNUITIES — PruSecure (age-banded)
-- =============================================================================
insert into public.products
  (name, carrier_id, product_type_id, gdc_multiplier, min_age, max_age) values

  ('PruSecure 5 Year',
    (select id from public.carriers where name = 'The Prudential Insurance Company of America'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.035, 0, 80),
  ('PruSecure 5 Year',
    (select id from public.carriers where name = 'The Prudential Insurance Company of America'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.020, 81, 85),

  ('PruSecure 7 Year',
    (select id from public.carriers where name = 'The Prudential Insurance Company of America'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.050, 0, 80),
  ('PruSecure 7 Year',
    (select id from public.carriers where name = 'The Prudential Insurance Company of America'),
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.025, 81, 85)

on conflict do nothing;


-- =============================================================================
-- ANNUITIES — carrier unknown (verify and update)
-- =============================================================================
insert into public.products
  (name, carrier_id, product_type_id, gdc_multiplier, min_age, max_age, notes) values

  -- Covered Choice — issuing carrier unclear; Protective has a similar product
  ('Covered Choice 5 FIA', null,
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.035, 0, 75, 'Verify carrier'),
  ('Covered Choice 5 FIA', null,
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.030, 76, 80, 'Verify carrier'),
  ('Covered Choice 5 FIA', null,
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.020, 81, 85, 'Verify carrier'),

  -- Level Advantage 2 RILA — likely North American but verify
  ('Level Advantage 2 RILA', null,
    (select id from public.product_types where name = 'Registered Index-Linked Annuity (RILA)'),
    0.060, 0, 80, 'Verify carrier — likely North American'),
  ('Level Advantage 2 RILA', null,
    (select id from public.product_types where name = 'Registered Index-Linked Annuity (RILA)'),
    0.030, 81, 85, 'Verify carrier'),

  ('Level Advantage 2 Income RILA', null,
    (select id from public.product_types where name = 'Registered Index-Linked Annuity (RILA)'),
    0.0225, 0, 80, 'Verify carrier'),
  ('Level Advantage 2 Income RILA', null,
    (select id from public.product_types where name = 'Registered Index-Linked Annuity (RILA)'),
    0.0113, 81, 85, 'Verify carrier'),

  -- Asset Builder II — likely North American
  ('Asset Builder II 5 Year', null,
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.034, 0, 75, 'Verify carrier'),
  ('Asset Builder II 5 Year', null,
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.030, 76, 80, 'Verify carrier'),
  ('Asset Builder II 5 Year', null,
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.017, 81, 85, 'Verify carrier'),

  ('Asset Builder II 7 Year', null,
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.050, 0, 75, 'Verify carrier'),
  ('Asset Builder II 7 Year', null,
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.035, 76, 80, 'Verify carrier'),
  ('Asset Builder II 7 Year', null,
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.025, 81, 85, 'Verify carrier'),

  -- Income Builder / Income Creator
  ('Income Builder 7 Year', null,
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.055, 50, 75, 'Verify carrier'),
  ('Income Builder 7 Year', null,
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.035, 76, 85, 'Verify carrier'),

  ('Income Creator 7 Year', null,
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.050, 50, 75, 'Verify carrier'),
  ('Income Creator 7 Year', null,
    (select id from public.product_types where name = 'Fixed Indexed Annuity (FIA)'),
    0.020, 76, 80, 'Verify carrier'),

  -- Secure Saver
  ('Secure Saver 5 Year', null,
    (select id from public.product_types where name = 'Multi-Year Guaranteed Annuity (MYGA)'),
    0.030, 0, 75, 'Verify carrier'),
  ('Secure Saver 5 Year', null,
    (select id from public.product_types where name = 'Multi-Year Guaranteed Annuity (MYGA)'),
    0.010, 76, 80, 'Verify carrier'),
  ('Secure Saver 5 Year', null,
    (select id from public.product_types where name = 'Multi-Year Guaranteed Annuity (MYGA)'),
    0.004, 81, 85, 'Verify carrier')

on conflict do nothing;


-- =============================================================================
-- SPIA
-- =============================================================================
insert into public.products
  (name, carrier_id, product_type_id, gdc_multiplier, min_age, max_age, notes) values
  ('ProPayer Income Annuity (SPIA)', null,
    (select id from public.product_types where name = 'Single Premium Immediate Annuity (SPIA)'),
    0.040, 0, 99, 'Verify carrier'),
  ('Aspirations', null,
    (select id from public.product_types where name = 'Variable Annuity (VA)'),
    0.070, 0, 80, 'Verify carrier')
on conflict do nothing;


-- =============================================================================
-- MUTUAL FUNDS / IRAs (trail or transaction GDC)
-- =============================================================================
insert into public.products
  (name, carrier_id, product_type_id, gdc_multiplier, notes) values
  ('Sammons LiveWell MF IRA', null,
    (select id from public.product_types where name = 'Mutual Fund / IRA'),
    0.010, 'Sammons platform MF IRA'),
  ('Voya Select Advantage IRA',
    (select id from public.carriers where name = 'Voya Financial'),
    (select id from public.product_types where name = 'Mutual Fund / IRA'),
    0.010, null),
  ('NFS Mutual Funds / UIT',
    (select id from public.carriers where name = 'National Financial Services'),
    (select id from public.product_types where name = 'Mutual Fund / IRA'),
    0.010, null),
  ('Direct Mutual Funds', null,
    (select id from public.product_types where name = 'Mutual Fund / IRA'),
    0.010, 'Direct purchase; carrier varies')
on conflict do nothing;


-- =============================================================================
-- VERIFICATION QUERY
-- Run after migration to spot products still missing carrier or product type.
-- Remove or comment out before committing to CI.
-- =============================================================================
-- select
--   p.name,
--   c.short_name as carrier,
--   pt.name as product_type,
--   p.gdc_multiplier,
--   p.min_age,
--   p.max_age,
--   p.notes
-- from public.products p
-- left join public.carriers c on c.id = p.carrier_id
-- left join public.product_types pt on pt.id = p.product_type_id
-- order by carrier, p.name, p.min_age;
