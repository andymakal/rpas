-- Add product_category, linked_case_id, and linked_customer_id to gdc_records
-- for pipeline reconciliation (life→case, annuity→service_policy→customer, securities→customer manual)

ALTER TABLE gdc_records
  ADD COLUMN IF NOT EXISTS product_category text
    CHECK (product_category IN ('life', 'annuity', 'securities')),
  ADD COLUMN IF NOT EXISTS linked_case_id uuid
    REFERENCES cases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_customer_id uuid
    REFERENCES customers(id) ON DELETE SET NULL;

-- Back-fill product_category for all existing rows
UPDATE gdc_records
SET product_category = CASE
  WHEN lower(product) = 'mutual fund'      THEN 'securities'
  WHEN lower(product) LIKE '%annuity%'     THEN 'annuity'
  ELSE 'life'
END
WHERE product_category IS NULL;
