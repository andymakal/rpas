-- =============================================================================
-- Production catch-up: contact facts + Customer Interaction history wiring
-- Migration: 20261119000001_prod_catchup_contact_facts_and_interaction_history.sql
--
-- WHY THIS EXISTS
-- The development line and main diverged, and their schema changes were applied
-- to two different databases out of band. The production database (ref
-- erbvssfcglhnelfelbfi) is missing four additive, development-side schema
-- objects that the merged application code now depends on. The matching feature
-- migrations (20261113..20261118) were recorded in the development clone under
-- timestamped version strings, so they will NOT replay onto production by
-- version. This single migration carries exactly the genuinely-missing schema
-- forward into production under one new, sequential version, so migration
-- history becomes consistent again going forward.
--
-- It consolidates the production-relevant effect of:
--   20261113000001_my_work_realtime            (case_touches portion only)
--   20261114000001_customer_interaction_realtime
--   20261115000001_case_touches_workflow_type
--   20261116000001_customers_email_availability
--   20261117000001_email_availability_simplify (final folded form)
--   20261118000001_customers_contact_alert
--
-- Verified against live production before authoring: customers.email_availability
-- and customers.contact_alert do not exist; case_touches_touch_type_check lacks
-- 'workflow'; case_touches has replica identity 'default' and is not in the
-- supabase_realtime publication. The three other realtime tables from
-- 20261113000001 (stewardship_outreach, customer_prereviews, project_customers)
-- are ALREADY configured in production and are deliberately omitted here.
--
-- DATA SAFETY
-- Every statement is additive and guarded. No column is dropped, no row is
-- deleted, and no existing value is rewritten except folding a legacy 'refused'
-- email_availability into 'no_address' (a value that does not exist in
-- production, so a provable no-op there; included only so the tightened CHECK
-- can never reject pre-existing data). Fully idempotent: safe to replay on any
-- environment, including the development clone that already has these objects.
-- =============================================================================

-- --- case_touches: live refresh for My Work + Customer Interaction -----------
-- Realtime needs the full old row on UPDATE/DELETE to evaluate RLS and emit a
-- complete payload. Low-volume operator work table; WAL cost negligible.
alter table public.case_touches replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'case_touches'
  ) then
    alter publication supabase_realtime add table public.case_touches;
  end if;
end $$;

-- --- case_touches: honest 'workflow' touch_type ------------------------------
-- Customer Interaction records administrative milestones (follow-up scheduled /
-- completed, refusal) as a 'workflow' touch so Customer History reads them
-- honestly instead of mislabeling them as calls. Outreach-attempt and
-- communication readers ignore 'workflow', so counts are unaffected.
alter table public.case_touches
  drop constraint if exists case_touches_touch_type_check;

alter table public.case_touches
  add constraint case_touches_touch_type_check
  check (touch_type in ('call', 'voicemail', 'text', 'email', 'missed_appointment', 'postal', 'research', 'workflow'));

-- --- customers.email_availability (final folded form) ------------------------
-- Durable, informational customer fact. NULL = unknown/Missing (the default for
-- every existing customer, so no business data changes). Added directly in its
-- final three-value form (the 20261117 simplification is already folded in).
alter table public.customers
  add column if not exists email_availability text;

-- Fold any legacy 'refused' into 'no_address' before tightening the CHECK. No
-- such rows exist in production; written so the CHECK can never reject data.
update public.customers
  set email_availability = 'no_address'
  where email_availability = 'refused';

alter table public.customers
  drop constraint if exists customers_email_availability_check;

alter table public.customers
  add constraint customers_email_availability_check
  check (email_availability is null
    or email_availability in ('available', 'no_address', 'undeliverable'));

comment on column public.customers.email_availability is
  'Informational customer fact: current email availability. '
  'NULL = unknown/Missing (no email, reason unknown); '
  '''available'' = usable email on file; '
  '''no_address'' = No Usable Email (none, or customer will not provide one); '
  '''undeliverable'' = a known address permanently failed (address removed from '
  'customers.email and preserved in Customer History). Changes are recorded in '
  'case_touches (''workflow''). Informational only: it suppresses no research, '
  'routes no queue, and sets no terminal state.';

-- --- customers.contact_alert -------------------------------------------------
-- One short free-text alert per customer, shown atop the shared Customer Contact
-- card. Durable customer fact, not a workflow object: no categories, priorities,
-- expiration, or routing. NULL = no alert (the default; no business data changes).
alter table public.customers
  add column if not exists contact_alert text;

comment on column public.customers.contact_alert is
  'Durable single customer alert (free text), shown at the top of the shared '
  'Customer Contact card wherever it renders. NULL = no alert. One current alert '
  'per customer; no categories, priorities, expiration, or workflow rules. '
  'Add/Edit/Clear write this one column via the shared contact save route.';

-- Refresh PostgREST's schema cache so the two new columns are immediately visible.
notify pgrst, 'reload schema';
