-- =============================================================================
-- RPAS: Relax customer_notes.customer_id NOT NULL constraint
-- Migration: 20260723000001_customer_notes_nullable_customer.sql
--
-- Legacy service_policies imported before the referral pipeline have no
-- customer_id. Staff hitting those policies in policy reviews were blocked
-- from saving notes. Making customer_id nullable allows notes to be stored
-- against the review (via policy_review_id) even when no customer exists yet.
--
-- On delete: changed from CASCADE to SET NULL so notes survive customer deletion.
-- =============================================================================

alter table public.customer_notes
  alter column customer_id drop not null;

alter table public.customer_notes
  drop constraint customer_notes_customer_id_fkey,
  add  constraint customer_notes_customer_id_fkey
       foreign key (customer_id)
       references public.customers(id)
       on delete set null;
