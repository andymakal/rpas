-- Add pay_period to service_policies
-- Tracks whether a policy is full pay, limited pay (10/20-pay), or single premium.
-- premium_mode already exists on this table for billing frequency.

ALTER TABLE service_policies
  ADD COLUMN IF NOT EXISTS pay_period text
  CHECK (pay_period IN ('Full Pay', '10-Pay', '20-Pay', 'Single Premium'));
