-- =============================================================================
-- Migration: Fix Product Carrier Assignments
-- Migration: 20260517000001_fix_product_carriers.sql
--
-- Source: 2026 GDC Grid PDF (verified with Andy)
--
-- Corrections:
--   1. Add "Lincoln Financial" as the canonical carrier for all Lincoln products.
--      Nothing on the current product shelf is "Lincoln Benefit Life" —
--      all Lincoln products route through Lincoln Financial.
--   2. Reassign Lincoln-branded products from wrong carriers to Lincoln Financial.
--   3. Add missing Lincoln WealthAccelerate IUL (GDC 136%).
--   4. Fix Classic Choice → Protective Life (was split across Venerable/Nationwide/Jackson).
--   5. Fix Indexed Choice UL → Protective Life (was Pacific Life).
--   6. Fix Select-A-Term → Corebridge Financial (was Protective Life).
--   7. Fix Secure Lifetime GUL 3 → Corebridge Financial (was Protective Life).
-- =============================================================================


-- =============================================================================
-- 1. ADD LINCOLN FINANCIAL AS CANONICAL CARRIER
-- =============================================================================

insert into public.carriers (name, short_name, is_active)
values ('Lincoln Financial', 'Lincoln Financial', true)
on conflict (name) do nothing;


-- =============================================================================
-- 2. REASSIGN EXISTING LINCOLN PRODUCTS
-- =============================================================================

-- Products currently under 'Lincoln Life & Annuity Company of New York':
--   Asset Edge VUL, Lincoln Wealth Accumulate IUL, Lincoln VULOne,
--   Money Guard Fixed, Money Guard Market
update public.products
set carrier_id = (select id from public.carriers where name = 'Lincoln Financial')
where carrier_id = (select id from public.carriers where name = 'Lincoln Life & Annuity Company of New York');

-- WealthBuilder IUL was wrongly assigned to Equitable
update public.products
set carrier_id = (select id from public.carriers where name = 'Lincoln Financial')
where name = 'WealthBuilder IUL';

-- WealthPreserve 2 IUL/SIUL were wrongly assigned to North American
update public.products
set carrier_id = (select id from public.carriers where name = 'Lincoln Financial')
where name in ('WealthPreserve 2 IUL', 'WealthPreserve 2 SIUL');

-- Wealth Protector IUL had null carrier
update public.products
set carrier_id = (select id from public.carriers where name = 'Lincoln Financial'),
    notes      = null
where name = 'Wealth Protector IUL';

-- Term Accel series (Lincoln TermAccel) was wrongly assigned to Protective Life
update public.products
set carrier_id = (select id from public.carriers where name = 'Lincoln Financial')
where name in ('Term Accel 10', 'Term Accel 15', 'Term Accel 20', 'Term Accel 30');

-- Life Elements series (Lincoln LifeElements) was wrongly assigned to Everlake
update public.products
set carrier_id = (select id from public.carriers where name = 'Lincoln Financial')
where name in ('Life Elements 10', 'Life Elements 15', 'Life Elements 20', 'Life Elements 30');


-- =============================================================================
-- 3. ADD MISSING LINCOLN PRODUCTS
-- =============================================================================

-- Lincoln WealthAccelerate IUL — highest GDC permanent product (136%)
-- Was omitted from the original seed entirely
insert into public.products (name, carrier_id, product_type_id, gdc_multiplier)
values (
  'Lincoln WealthAccelerate IUL',
  (select id from public.carriers where name = 'Lincoln Financial'),
  (select id from public.product_types where name = 'Indexed Universal Life (IUL)'),
  1.36
)
on conflict do nothing;


-- =============================================================================
-- 4. FIX CLASSIC CHOICE — Protective Life (was split across 3 wrong carriers)
-- =============================================================================

update public.products
set carrier_id = (select id from public.carriers where name = 'Protective Life Insurance Company'),
    notes      = null
where name in ('Classic Choice 10', 'Classic Choice 15', 'Classic Choice 20+');


-- =============================================================================
-- 5. FIX INDEXED CHOICE UL — Protective Life (was Pacific Life)
-- =============================================================================

update public.products
set carrier_id = (select id from public.carriers where name = 'Protective Life Insurance Company')
where name = 'Indexed Choice UL';


-- =============================================================================
-- 6. FIX SELECT-A-TERM — Corebridge Financial (was Protective Life)
-- =============================================================================

update public.products
set carrier_id = (select id from public.carriers where name = 'Corebridge Financial')
where name in (
  'Select-A-Term 10',
  'Select-A-Term 15',
  'Select-A-Term 16-19',
  'Select-A-Term 20+'
);


-- =============================================================================
-- 7. FIX SECURE LIFETIME GUL 3 — Corebridge Financial (was Protective Life)
-- =============================================================================

update public.products
set carrier_id = (select id from public.carriers where name = 'Corebridge Financial')
where name = 'Secure Lifetime GUL 3';
