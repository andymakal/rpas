-- customer_relationships
-- Bidirectional links between customer records: spouse, joint account owner, UTMA custodian.
-- The fact_finder JSON stores per-account related_customer_id for display;
-- this table enables household-level queries from either side.

CREATE TABLE IF NOT EXISTS customer_relationships (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  related_customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  relationship_type   text NOT NULL CHECK (relationship_type IN ('spouse', 'joint_owner', 'custodian')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_relationships_unique UNIQUE (customer_id, related_customer_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS customer_relationships_related_idx
  ON customer_relationships (related_customer_id);

-- RLS: internal admin only (same pattern as other admin tables)
ALTER TABLE customer_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all" ON customer_relationships
  USING (true) WITH CHECK (true);
