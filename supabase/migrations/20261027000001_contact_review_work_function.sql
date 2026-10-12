-- =============================================================================
-- Contact Review capability — catalog row + eligibility mirrored from Research
-- Migration: 20261027000001_contact_review_work_function.sql
--
-- Contact Review is the project-scoped pass that completes customer contact
-- information missing from the Cassidy import (reuses the existing shared
-- research interface and writes only to the customer record). It already exists
-- as a surface at /projects/[id]/contact-review. This migration makes it a
-- first-class entry in My Work -> Quiet Work by giving it a capability catalog
-- row, so eligibility is resolved by the SAME producer_work_functions machinery
-- every other activity uses — no hardcoded person, no new workflow.
--
-- Eligibility model (settled): Contact Review is contact-completion work, the
-- same capability family as Contact Research ('research'). So the people
-- eligible to perform Contact Review are exactly those already eligible for
-- Contact Research. Rather than name anyone, this migration DERIVES the grants
-- from the live 'research' assignments: for every producer_work_functions row
-- on 'research', it creates the matching 'contact_review' row (same producer,
-- assignment_type, project scope, source). Whoever can do Contact Research can
-- do Contact Review — including future grantees, because the Team editor writes
-- both through the same table.
--
-- SAFE REPLAY + PORTABILITY: the catalog upsert is idempotent; the eligibility
-- insert is guarded by `on conflict do nothing` against the existing partial
-- unique indexes, so a re-run adds nothing. An environment with no 'research'
-- rows simply grants nothing. No existing assignment is modified or removed.
--
-- Depends on 20261021000001_ipf_work_overlay (work_functions +
-- producer_work_functions, their unique indexes, and the qualification trigger).
-- Contact Review has NO license gate (required_qualification is null), matching
-- Contact Research, so the qualification trigger never blocks these inserts.
-- =============================================================================

-- 1. Catalog row. sort_order 25 places Contact Review immediately after Contact
--    Research (20) and before Operations Preparation (30), so the Quiet Work
--    listing reads research -> contact review -> operations in a natural order.
insert into public.work_functions (canonical_key, label, description, required_qualification, sort_order)
values
  ('contact_review', 'Contact Review',
   'Project-scoped pass to complete customer contact information missing from the import: look the customer up in eAgent and fill in a missing email or phone. Writes only to the customer record.',
   null, 25)
on conflict (lower(canonical_key)) do update
  set label = excluded.label,
      description = excluded.description,
      required_qualification = excluded.required_qualification,
      sort_order = excluded.sort_order;

-- 2. Eligibility, mirrored from Research. One row per existing 'research'
--    assignment, pointed at 'contact_review'. The source is carried through so
--    provenance stays truthful (a mirrored manual grant reads as 'manual'); a
--    distinct marker is not used because these ARE the research grants, re-
--    expressed for the sibling capability. on conflict do nothing makes replay
--    a no-op against both the agency-wide and the per-project unique indexes.
insert into public.producer_work_functions (producer_id, work_function_id, assignment_type, project_id, source)
select
  pwf.producer_id,
  cr.id,
  pwf.assignment_type,
  pwf.project_id,
  pwf.source
from public.producer_work_functions pwf
join public.work_functions rs on rs.id = pwf.work_function_id and rs.canonical_key = 'research'
cross join lateral (
  select id from public.work_functions where canonical_key = 'contact_review'
) cr
on conflict do nothing;

-- Refresh PostgREST's schema cache so the new catalog row is immediately
-- resolvable by the API layer.
notify pgrst, 'reload schema';
