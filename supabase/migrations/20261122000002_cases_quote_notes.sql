-- Add quote_notes to cases for freetext documentation of multiple options quoted.
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS quote_notes text;
