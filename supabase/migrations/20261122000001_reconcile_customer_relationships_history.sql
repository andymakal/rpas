-- Reconcile the migration-history record for customer_relationships.
--
-- The repository migration 20261024000002_customer_relationships.sql creates the
-- public.customer_relationships table (plus its unique constraint, both
-- customers FKs with ON DELETE CASCADE, the relationship_type CHECK, the
-- related_customer_id index), enables RLS, and creates the admin_all policy.
--
-- That complete schema effect is ALREADY present in production: it was folded
-- into the consolidated 20261111000001_prod_schema_upgrade_projects_workflow
-- migration when production's projects/workflow/stewardship schema was brought
-- up to the application. Production was never able to run the individual
-- historical file, so 20261024000002 was never recorded in the
-- supabase_migrations.schema_migrations ledger. That leaves it reported as an
-- outstanding migration even though its objects exist.
--
-- The historical file must NOT be replayed: its CREATE POLICY "admin_all" and
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY are not idempotent and would error
-- against the policy/RLS state that already exists. The correct, safe action is
-- to record 20261024000002 as applied, exactly as 20261111000001 did for the
-- rest of the superseded historical chain, so future `supabase db push` /
-- `migration list` no longer treats it as pending and never attempts a replay.
--
-- This changes only the history ledger. It does not create, alter, or drop any
-- table, index, constraint, policy, RLS setting, function, grant, or data.
-- Idempotent: re-running is a no-op.

insert into supabase_migrations.schema_migrations (version, name)
values ('20261024000002', 'customer_relationships')
on conflict (version) do nothing;
