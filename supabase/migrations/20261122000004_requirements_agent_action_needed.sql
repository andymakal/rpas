-- Add flag for Nikki to signal that an outstanding requirement needs
-- the referring LSP/agent to follow up with the client directly.
ALTER TABLE case_pending_requirements
  ADD COLUMN IF NOT EXISTS agent_action_needed boolean NOT NULL DEFAULT false;
