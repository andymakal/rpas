-- Add address fields to customers table
alter table public.customers
  add column if not exists street text,
  add column if not exists city   text,
  add column if not exists state  text,
  add column if not exists zip    text;
