-- =============================================================================
-- Household members on referral cases
-- Migration: 20260530000001_case_household_members.sql
--
-- A referral case represents a HOUSEHOLD, not just one person. When an LSP
-- refers a couple (or family), one case is created for the primary contact and
-- additional household members are stored here.
--
-- Key design decisions:
--   - Plain rows, not a separate customer record — at intake we have minimal
--     info and linking a full customer record is premature.
--   - Quote fields per member — carrier, product type, and face amount are
--     tracked individually since each person gets their own policy.
--   - linked_case_id — set when a member progresses to an application; points
--     to the Cases pipeline record so the referral card can show live status.
--   - Health/build fields — captured here for quoting; mirrors the customers
--     table so quote info is complete without needing a separate customer row.
-- =============================================================================

create table public.case_household_members (
  id                   uuid        primary key default gen_random_uuid(),
  case_id              uuid        not null references public.cases (id) on delete cascade,

  first_name           text        not null,
  last_name            text        not null,
  date_of_birth        date,

  -- Health / underwriting fields (mirrors customers table)
  gender               text        check (gender in ('male', 'female', 'other')),
  tobacco_use          text        check (tobacco_use in (
                                     'none', 'cigarettes', 'cigars', 'vaping',
                                     'chewing', 'nicotine_replacement'
                                   )),
  height_ft            integer,
  height_in            integer,
  weight_lbs           integer,
  health_notes         text,

  -- Quote tracking — filled in when "Quote Provided" is recorded for this member
  quoted_carrier       text,
  quoted_product_type  text,
  face_amount          numeric,

  -- Set when this member's application creates a separate Cases pipeline record
  linked_case_id       uuid        references public.cases (id) on delete set null,

  created_at           timestamptz not null default now()
);

comment on table public.case_household_members is
  'Additional people in a household referral. One case = one household; '
  'members are the people beyond the primary contact (customers.id on the case). '
  'Quote fields track per-person coverage needs. linked_case_id is set when '
  'they advance to a full application case in the pipeline.';

-- Fast lookup of members for a given case
create index case_household_members_case_id_idx
  on public.case_household_members (case_id);
