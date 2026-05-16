-- =============================================================================
-- RPAS Settings Layer — Core Catalog Seed Data
-- Migration: 20260515000002_settings_seed_core.sql
--
-- Seeds all lookup tables EXCEPT products (see 20260515000003_settings_seed_products.sql).
-- All inserts use ON CONFLICT DO NOTHING — safe to re-run.
--
-- Seeding order (FK dependency):
--   1. sml_teams          (no FKs)
--   2. carriers           (no FKs)
--   3. product_types      (no FKs)
--   4. rate_classes       (no FKs)
--   5. premium_modes      (no FKs)
--   6. stage_translations (no FKs — most critical catalog in the system)
--   7. lost_reasons
--   8. snooze_reasons
--   9. service_request_types
--  10. request_statuses
--  11. pending_requirements
--  12. opportunity_types
--  13. review_statuses
--  14. health_change_types
-- =============================================================================


-- =============================================================================
-- 1. SML TEAMS
-- Source: "SML Team" column in the existing Sheets system.
-- Named codes are producers; geo codes (NJ, VA, etc.) are territory assignments.
-- display_name: update with full producer names once confirmed.
-- =============================================================================
insert into public.sml_teams (code, display_name, region, is_active) values
  ('SHOKALOOK',     'Shokalook',      'PA',   true),
  ('COLLINS',       'Collins',        'PA',   true),
  ('LANGDALE',      'Langdale',       'PA',   true),
  ('WISCHUM',       'Wischum',        'PA',   true),
  ('RONSVAILE',     'Ronsvaile',      'PA',   true),
  ('TEAM MAKAL EFS','Team Makal EFS', 'PA',   true),
  ('NJ',            'New Jersey',     'NJ',   true),
  ('VA',            'Virginia',       'VA',   true),
  ('RI',            'Rhode Island',   'RI',   true),
  ('AL',            'Alabama',        'AL',   true),
  ('CT',            'Connecticut',    'CT',   true),
  ('NH',            'New Hampshire',  'NH',   true)
on conflict (code) do nothing;


-- =============================================================================
-- 2. CARRIERS
-- Source: "Company" column in Settings sheet + confirmed product associations.
-- Nullable FK on products — only populates when carrier is confirmed.
-- NOTE: "Covr - X" entries are platforms/distribution channels, not direct carriers.
--       The underlying issuing carrier is noted in the carrier name for clarity.
-- =============================================================================
insert into public.carriers (name, short_name, is_active) values
  -- Life carriers
  ('Lincoln Life & Annuity Company of New York',  'Lincoln Life',         true),
  ('Lincoln Benefit Life Company',                 'Lincoln Benefit Life', true),
  ('Protective Life Insurance Company',            'Protective Life',      true),
  ('Foresters Financial Life Insurance',           'Foresters',            true),
  ('Corebridge Financial',                         'Corebridge',           true),
  ('John Hancock Life Insurance Company',          'John Hancock',         true),
  ('Everlake Life Insurance Company',              'Everlake Life',        true),
  ('Everlake Assurance Company',                   'Everlake Assurance',   true),
  ('Gerber Life Insurance Company',                'Gerber Life',          true),
  ('Equitable Financial Life Insurance Company',   'Equitable',            true),
  ('North American Company for Life and Health',   'North American',       true),
  ('The Prudential Insurance Company of America',  'Prudential',           true),
  ('Venerable Insurance and Annuity Company',      'Venerable',            true),
  ('Nationwide Life Insurance Company',            'Nationwide',           true),
  ('Jackson National Life Insurance Company',      'Jackson National',     true),
  ('Pacific Life Insurance Company',               'Pacific Life',         true),

  -- Investment / annuity platforms and fund families
  -- (used as "carrier" in GDC schedule context)
  ('National Financial Services',                  'NFS',                  true),
  ('Invesco',                                      'Invesco',              true),
  ('Voya Financial',                               'Voya',                 true),
  ('Sammons Financial Group',                      'Sammons',              true),
  ('Franklin Templeton',                           'Franklin Templeton',   true),
  ('First Trust',                                  'First Trust',          true),
  ('American Funds',                               'American Funds',       true),

  -- Covr platform — underlying carriers listed; "Covr - X" = placed via Covr channel
  ('Assurity Life Insurance (via Covr)',           'Covr – Assurity',      true),
  ('Massachusetts Mutual Life Insurance (via Covr)','Covr – Mass Mutual',  true),
  ('Principal Life Insurance (via Covr)',           'Covr – Principal',     true),
  ('Ameritas Life Partners (via Covr)',             'Covr – Ameritas',      true),
  ('Mutual of Omaha Insurance (via Covr)',          'Covr – Mutual of Omaha', true)
on conflict (name) do nothing;


-- =============================================================================
-- 3. PRODUCT TYPES
-- High-level classification — used in the Won section PRODUCT column.
-- =============================================================================
insert into public.product_types (name, sort_order) values
  ('Term Life',                             10),
  ('Whole Life',                            20),
  ('Universal Life (UL)',                   30),
  ('Indexed Universal Life (IUL)',          40),
  ('Variable Universal Life (VUL)',         50),
  ('Guaranteed Universal Life (GUL)',       60),
  ('Guaranteed Issue Whole Life (GI WL)',   70),
  ('Long-Term Care Hybrid',                 80),
  ('Fixed Indexed Annuity (FIA)',           90),
  ('Multi-Year Guaranteed Annuity (MYGA)', 100),
  ('Variable Annuity (VA)',                110),
  ('Registered Index-Linked Annuity (RILA)', 120),
  ('Single Premium Immediate Annuity (SPIA)', 130),
  ('Mutual Fund / IRA',                    140)
on conflict (name) do nothing;


-- =============================================================================
-- 4. RATE CLASSES
-- Source: "Rate Class" column in Settings sheet.
-- =============================================================================
insert into public.rate_classes (name, sort_order) values
  ('Preferred Plus / Elite Non-Tobacco', 10),
  ('Preferred Non-Tobacco',              20),
  ('Standard Non-Tobacco',               30),
  ('Healthy American',                   40),
  ('Standard Select',                    50),
  ('Preferred Tobacco',                  60),
  ('Standard Tobacco',                   70)
on conflict (name) do nothing;


-- =============================================================================
-- 5. PREMIUM MODES
-- Source: "Premium Mode" column in Settings sheet.
-- =============================================================================
insert into public.premium_modes (name, sort_order) values
  ('Monthly',      10),
  ('Quarterly',    20),
  ('Semi-Annual',  30),
  ('Annual',       40)
on conflict (name) do nothing;


-- =============================================================================
-- 6. STAGE TRANSLATIONS
-- THE MOST CRITICAL SEED IN THE SYSTEM.
--
-- Rules (from IPF spec §4.2 and §2.2):
--   - Every agency_label MUST be active voice.
--   - "Awaiting" is NEVER used. Use "Working on".
--   - Tier 1: touches + last contact render normally.
--   - Tier 2+: those columns render as em-dash (—). Code enforces this.
--   - stale_threshold_days is Tier 1 only. Application checks this to render
--     the clock icon next to CURRENT ACTIVITY.
--   - stage_order drives descending sort on Active section (highest = most advanced = top).
--   - "Back to agency to re-warm" is the single exception to active voice —
--     it is positional, not directive, per spec §2.5.
--
-- Application code fallback chain:
--   exact internal_status match → stage-group default → log warning, show raw value
-- =============================================================================
insert into public.stage_translations
  (internal_status, agency_label, tier, stage_order, stale_threshold_days,
   is_active_case, is_won, is_lost, is_snoozed)
values

  -- ── TIER 1: POTENTIAL ────────────────────────────────────────────────────
  -- Touches and last-contact columns render. Stall clock active.
  -- Sorted low (stage_order) to high: furthest along = highest number = top of Active.

  ('lsp_contact_needed',
   'Working on first contact',
   1, 10, 3,
   true, false, false, false),

  ('appointment_set',
   'Working on appointment',
   -- Note: when appointment_date is set, application appends " for {date}":
   -- "Working on appointment for Apr 30" — date only, never time (spec §3.4 discrimination test)
   1, 20, 14,
   true, false, false, false),

  ('appointment_missed',
   'Back to agency to re-warm',
   -- Positional, not directive. Ball is here; LSP needs to re-engage client.
   1, 15, 7,
   true, false, false, false),

  ('appointment_kept',
   'Working on proposal',
   1, 30, 7,
   true, false, false, false),

  ('quoted',
   'Working on application',
   1, 40, 14,
   true, false, false, false),

  -- ── TIER 2: COMMITMENT ───────────────────────────────────────────────────
  -- Application submitted through signature. Em-dash on TOUCHES and LAST CONTACT.
  -- stale_threshold_days must be null here (constraint enforces it).

  ('app_submitted',
   'Working on application completion',
   2, 50, null,
   true, false, false, false),

  ('in_underwriting',
   'Working through underwriting',
   2, 60, null,
   true, false, false, false),

  ('approved',
   'Working on policy delivery',
   2, 70, null,
   true, false, false, false),

  ('awaiting_transfer',
   'Working on transfer completion',
   -- 1035 exchanges and fund transfers. Still Tier 2: chasing a deliverable.
   2, 75, null,
   true, false, false, false),

  -- ── TIER 3: EXECUTION ────────────────────────────────────────────────────
  -- In carrier hands. Em-dash on both columns. Stall flag meaningless here.

  ('issued',
   'Working on policy placement',
   3, 80, null,
   true, false, false, false),

  -- ── WON ──────────────────────────────────────────────────────────────────
  ('placed',
   'Policy placed',
   3, 90, null,
   false, true, false, false),

  -- ── LOST ─────────────────────────────────────────────────────────────────
  -- is_lost = true; lost_reason_id on the case record carries the detail.
  -- agency_label here is the fallback; lost_reasons table carries specific labels.
  ('carrier_declined',
   'Closed — carrier decision',
   1, 0, null,
   false, false, true, false),

  ('client_withdrew',
   'Closed — client elected not to proceed',
   1, 0, null,
   false, false, true, false),

  -- ── SNOOZED ──────────────────────────────────────────────────────────────
  -- is_snoozed = true; snooze_reason_id + snooze_until date on the case record.
  ('snoozed',
   'Temporarily paused',
   1, 0, null,
   false, false, false, true)

on conflict (internal_status) do nothing;


-- =============================================================================
-- 7. LOST REASONS
-- Source: "Reason for Case Loss" column in Settings sheet.
-- internal_code stored on case; agency_label shown in Lost section LOST REASON column.
-- =============================================================================
insert into public.lost_reasons (internal_code, agency_label, sort_order) values
  ('carrier_decline',        'Carrier decision — not approved',              10),
  ('price_objection',        'Client elected not to proceed — pricing',      20),
  ('rating_objection',       'Client elected not to proceed — health rating', 30),
  ('found_better_coverage',  'Client found alternative coverage',            40),
  ('client_ghosted',         'Lost contact with client',                     50)
on conflict (internal_code) do nothing;


-- =============================================================================
-- 8. SNOOZE REASONS
-- Reason a case is temporarily paused. agency_label shown in Snoozed section.
-- =============================================================================
insert into public.snooze_reasons (internal_code, agency_label, sort_order) values
  ('not_ready',         'Client not ready — follow-up scheduled',       10),
  ('health_change',     'Health change — monitoring situation',          20),
  ('back_to_agency',    'Returned to agency for re-engagement',          30),
  ('seasonal',          'Seasonal pause — follow-up scheduled',          40),
  ('waiting_on_event',  'Waiting on life event — follow-up scheduled',   50),
  ('postponed',         'Client requested delay — follow-up scheduled',  60)
on conflict (internal_code) do nothing;


-- =============================================================================
-- 9. SERVICE REQUEST TYPES
-- Source: "Request Type" column in Settings sheet.
-- =============================================================================
insert into public.service_request_types (name, sort_order) values
  ('Beneficiary Change',          10),
  ('Banking / EFT Change',        20),
  ('Face Amount Change',          30),
  ('Policy Loan / Withdrawal',    40),
  ('Policy Surrender',            50),
  ('Policy Document Request',     60),
  ('Payment / Reinstatement',     70),
  ('Coverage / Status Question',  80),
  ('Servicing Agent Form',        90)
on conflict (name) do nothing;


-- =============================================================================
-- 10. REQUEST STATUSES
-- Source: "Request Status" column in Settings sheet.
-- =============================================================================
insert into public.request_statuses (name, sort_order) values
  ('New',                      10),
  ('Form Sent to Client',      20),
  ('Form Sent to Carrier',     30),
  ('Pending Client Response',  40),
  ('Awaiting Carrier',         50),
  ('Resolved',                 60),
  ('Converted to Review',      70)
on conflict (name) do nothing;


-- =============================================================================
-- 11. PENDING REQUIREMENTS
-- Source: "Pending Requirements" column in Settings sheet.
-- Underwriting checklist items blocking a Tier 2 case.
-- =============================================================================
insert into public.pending_requirements (name, sort_order) values
  ('Needs to Sign App',           10),
  ('Needs e-Interview',           20),
  ('Needs Labs Scheduled',        30),
  ('APS Ordered',                 40),
  ('Needs Paperwork',             50),
  ('Needs Final Packet Signed',   60),
  ('Awaiting 1035 Funds',         70),
  ('Needs e-PHI',                 80),
  ('Product Switch',              90),
  ('Awaiting Transfer',           100),
  ('Underwriter Review',          110)
on conflict (name) do nothing;


-- =============================================================================
-- 12. OPPORTUNITY TYPES
-- Source: "Opportunity Type" column in Settings sheet.
-- Classification of opportunity identified during a review.
-- =============================================================================
insert into public.opportunity_types (name, sort_order) values
  ('Rate Improvement',               10),
  ('Tobacco Re-Rating',              20),
  ('Health Improvement',             30),
  ('Extend Term Coverage',           40),
  ('Conversion',                     50),
  ('Carrier Switch',                 60),
  ('1035 Exchange',                  70),
  ('Multiple Opportunities',         80),
  ('No Opportunity — Optimized',     90)
on conflict (name) do nothing;


-- =============================================================================
-- 13. REVIEW STATUSES
-- Source: "Review Status" column in Settings sheet.
-- =============================================================================
insert into public.review_statuses (name, sort_order) values
  ('Scheduled',                          10),
  ('In Progress',                        20),
  ('Complete — No Changes',              30),
  ('Complete — Service Request',         40),
  ('Quoted — Follow Up',                 50),
  ('New Policy — Additional',            60),
  ('New Policy — Replacement',           70),
  ('Follow-Up Needed',                   80),
  ('Completed — Opportunity Identified', 90),
  ('Client Declined',                    100)
on conflict (name) do nothing;


-- =============================================================================
-- 14. HEALTH CHANGE TYPES
-- Source: "Health Changes" column in Settings sheet.
-- =============================================================================
insert into public.health_change_types (name, sort_order) values
  ('No Change',         10),
  ('Improved',          20),
  ('Stopped Smoking',   30),
  ('Now Uninsurable',   40),
  ('Excellent',         50)
on conflict (name) do nothing;
