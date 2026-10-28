-- Link a withdrawn case to its replacement at a new carrier, and vice versa.
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS replaced_by_case_id uuid REFERENCES cases(id),
  ADD COLUMN IF NOT EXISTS replaces_case_id uuid REFERENCES cases(id);
