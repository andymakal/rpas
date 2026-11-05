-- Add modal_factor to premium_modes.
-- modal_factor is the number of payments per year (e.g. Monthly = 12).
-- Used in the case edit UI to convert a modal (periodic) premium to an annualized premium.

ALTER TABLE public.premium_modes
  ADD COLUMN IF NOT EXISTS modal_factor int;

UPDATE public.premium_modes SET modal_factor = 12 WHERE name = 'Monthly';
UPDATE public.premium_modes SET modal_factor =  4 WHERE name = 'Quarterly';
UPDATE public.premium_modes SET modal_factor =  2 WHERE name = 'Semi-Annual';
UPDATE public.premium_modes SET modal_factor =  1 WHERE name = 'Annual';

COMMENT ON COLUMN public.premium_modes.modal_factor IS
  'Number of premium payments per year. Multiply modal premium × modal_factor to get annual premium.';
