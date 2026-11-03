-- Verify Servicing Agent — step 1 of servicing-agent capture, as a MY WORK
-- activity.
--
-- Adds a new work-function catalog entry 'verify_servicing_agent' that surfaces
-- the policies whose servicing-agent status has not been established yet
-- (Everlake-eligible policies at service_policies.sa_status = 'unknown'). It is
-- the first step before any downstream capture/outreach work: an operator checks
-- each policy in the Everlake Agent Portal and records whether we are the
-- servicing agent (sa_status -> 'confirmed') or not (sa_status -> 'not_on_file').
--
-- No license gate (required_qualification null): verifying is ordinary operations
-- work, the same operators who do Contact Research. sort_order 5 places it FIRST
-- within its priority band (ahead of outreach at 10), so it reads as the
-- preliminary step at the top of Available work.
--
-- Forward-only and idempotent (on conflict upsert), per the migration-deployment
-- routine.

insert into public.work_functions (canonical_key, label, description, required_qualification, sort_order)
values
  ('verify_servicing_agent',
   'Verify servicing agent',
   'Confirm, per policy, whether we are the servicing agent on Everlake-eligible policies (Allstate, Lincoln Benefit Life, Everlake) by looking them up in the Everlake Agent Portal. The preliminary step before any capture outreach.',
   null,
   5)
on conflict (lower(canonical_key)) do update
  set label = excluded.label,
      description = excluded.description,
      required_qualification = excluded.required_qualification,
      sort_order = excluded.sort_order;

-- Eligibility: assign the SAME operators who already hold the Contact Research
-- activity, as AGENCY-WIDE primary, so the verify activity is routable for them
-- across every project (verification is not project-bound work). Mirrors the
-- research holders without inventing a new routing concept. Idempotent against
-- the agency-wide partial unique index (producer_id, work_function_id where
-- project_id is null). marked source 'manual' so it is never swept by a
-- migration_seed cleanup.
insert into public.producer_work_functions (producer_id, work_function_id, assignment_type, project_id, source)
select distinct pwf.producer_id, vf.id, 'primary', null::uuid, 'manual'
from public.producer_work_functions pwf
join public.work_functions rf on rf.id = pwf.work_function_id and rf.canonical_key = 'research'
cross join public.work_functions vf
where vf.canonical_key = 'verify_servicing_agent'
on conflict (producer_id, work_function_id) where (project_id is null) do nothing;
