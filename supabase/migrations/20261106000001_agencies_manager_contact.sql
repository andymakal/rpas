-- Agency Manager contact fields for LSP re-warm email routing.
-- When use_manager_for_lsp_email is true, re-warm emails are sent to
-- manager_email instead of contact_email (the owner).

ALTER TABLE public.agencies
  ADD COLUMN IF NOT EXISTS manager_name             text,
  ADD COLUMN IF NOT EXISTS manager_email            text,
  ADD COLUMN IF NOT EXISTS use_manager_for_lsp_email boolean not null default false;

COMMENT ON COLUMN public.agencies.manager_name IS
  'Agency Manager name — used as the re-warm email recipient when use_manager_for_lsp_email is true.';
COMMENT ON COLUMN public.agencies.manager_email IS
  'Agency Manager email — replaces contact_email for LSP re-warm emails when use_manager_for_lsp_email is true.';
COMMENT ON COLUMN public.agencies.use_manager_for_lsp_email IS
  'When true, LSP re-warm emails go to manager_email instead of the owner contact_email.';
