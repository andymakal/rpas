-- Add display_name column to agencies.
-- This is the friendly agent name shown in dropdowns, dashboards, and portals.
-- The existing name column holds the Allstate P&C business name and stays for
-- reference / matching purposes.
--
-- Initial value: initcap(name) converts "MATT BARCZYK AGENCY INC" to
-- "Matt Barczyk Agency Inc" which is already far more readable.
-- Edit each row via the Agencies admin page to set the proper agent name.

alter table public.agencies
  add column if not exists display_name text;

update public.agencies
   set display_name = initcap(name)
 where display_name is null;
