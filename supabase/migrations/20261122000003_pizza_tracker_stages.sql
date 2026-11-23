-- Add app_received_carrier stage to the Cases underwriting pipeline.
-- This sits between app_submitted (order 50) and in_underwriting (order 60)
-- and is where Nikki records the carrier-assigned policy number.
INSERT INTO public.stage_translations
  (internal_status, agency_label, tier, stage_order, stale_threshold_days, is_active_case, is_won, is_lost, is_snoozed)
VALUES
  ('app_received_carrier', 'Application received at carrier', 2, 55, NULL, true, false, false, false)
ON CONFLICT (internal_status) DO NOTHING;

-- Enable date-field tracking (ordered / scheduled / completed) for the
-- underwriting requirements Nikki tracks over time for timeliness.
UPDATE public.pending_requirements
SET has_date_fields = true
WHERE name IN (
  'Needs e-Interview',
  'Needs Labs Scheduled',
  'APS Ordered',
  'Needs e-PHI'
);
