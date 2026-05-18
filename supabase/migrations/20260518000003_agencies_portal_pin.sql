-- Optional PIN for agency portal login.
-- If null, the portal remains publicly accessible by slug.
-- If set, the portal requires PIN entry before showing data.

alter table public.agencies
  add column if not exists portal_pin text;
