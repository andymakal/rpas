-- Add dedicated lsp_name and lsp_email columns to cases.
-- These store the raw intake values from the portal referral form so the
-- submitting LSP is always captured regardless of whether the name matched
-- an existing agents record. The agent_id FK remains for cases where the
-- match succeeded; these columns are the reliable fallback.

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS lsp_name  text,
  ADD COLUMN IF NOT EXISTS lsp_email text;

-- Back-fill from the linked agents record where agent_id is already set
-- and the new columns are still null.
UPDATE cases c
SET
  lsp_name  = a.first_name || ' ' || a.last_name,
  lsp_email = a.email
FROM agents a
WHERE c.agent_id = a.id
  AND c.lsp_name IS NULL;
