-- Add is_hot_lead flag to cases
-- Agents can flag a referral as a hot lead on intake.
-- The RP team can override (toggle on/off) from the internal case detail view.

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS is_hot_lead boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cases.is_hot_lead IS
  'Referral flagged as a hot lead — set by the referring agent on intake, toggleable by RP team on the backend.';
