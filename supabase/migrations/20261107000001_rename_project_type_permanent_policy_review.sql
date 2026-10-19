-- =============================================================================
-- Rename the "1035 Exchange" project type to "Permanent Policy Review"
-- Migration: 20261107000001_rename_project_type_permanent_policy_review.sql
--
-- The project type catalog seeded "1035 Exchange" (fixed id
-- a1035000-0000-4000-8000-000000000001) in 20261009000001_project_types.sql.
-- The operator-facing name for that kind of work is now "Permanent Policy
-- Review": a review of the customer's in-force permanent (cash-value) coverage,
-- of which a 1035 exchange is one possible outcome rather than the whole point.
--
-- This is a RENAME IN PLACE, not a new type:
--   - The row keeps its id, so projects.project_type_id and every FK
--     association (the existing "1035 Reviews" project and its wiring) are
--     preserved exactly. No project is re-pointed and no second catalog row is
--     created, so there is no duplicate type.
--   - is_active is untouched (stays active), so the type continues to appear in
--     the Start New dropdown.
--   - Only the display name and description change. The underlying workflows
--     (servicing_agent_onboarding, review_preparation) and all business logic
--     are unchanged by this migration.
--
-- The unique index on lower(name) is satisfied: there is exactly one row and we
-- update it in place, so no case-insensitive collision is possible.
--
-- Idempotent: guarded on the fixed id, and the WHERE clause makes a replay a
-- no-op once the rename has already been applied.
-- =============================================================================

update public.project_types
   set name        = 'Permanent Policy Review',
       description = 'Review of a customer''s in-force permanent (cash-value) '
                     'coverage to confirm it still fits their needs. A Section '
                     '1035 exchange to a better-suited contract is one possible '
                     'outcome, not the only one.'
 where id = 'a1035000-0000-4000-8000-000000000001'::uuid
   and name = '1035 Exchange';

-- Keep the seed comment honest for any future replay that reads the catalog.
comment on table public.project_types is
  'Durable catalog of project kinds (e.g. "Permanent Policy Review"). Referenced '
  'by projects.project_type_id. Retire a type by setting is_active = false; '
  'types are never deleted, so existing projects keep their type.';

-- Refresh PostgREST''s schema cache (comment change) so the API stays in sync.
notify pgrst, 'reload schema';
