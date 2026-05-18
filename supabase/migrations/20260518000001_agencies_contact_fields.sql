-- Add contact info fields to agencies table.
-- Populated by 20260518000002_agencies_contact_seed.sql.

alter table public.agencies
  add column if not exists agent_number   text,
  add column if not exists contact_phone  text,
  add column if not exists contact_email  text,
  add column if not exists contact_street text,
  add column if not exists contact_city   text,
  add column if not exists contact_state  text,
  add column if not exists contact_zip    text;
