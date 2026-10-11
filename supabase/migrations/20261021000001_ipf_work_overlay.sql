-- =============================================================================
-- IPF work overlay — employee capabilities, shared-queue claiming, project
-- participation / escalation, and Today's Focus
-- Migration: 20261021000001_ipf_work_overlay.sql
--
-- This lands the operational + assistant overlay from IPF
-- (bobpfromm/ipf-stewardship) onto Right Path's EXISTING tables, single-tenant
-- and with Right Path's own auth. It is the smallest complete vertical slice
-- that makes the shared Stewardship board and the 1035 project workable by
-- capability instead of by routine individual assignment.
--
-- What is lifted from IPF (the functional blueprint), and how it is re-homed:
--
--   1. CAPABILITIES. IPF's qualification flags + work-function catalog +
--      per-member assignment model is reused verbatim in SHAPE, but re-homed on
--      Right Path's `producers` table (NOT practice_team_members, no
--      practice_id). Qualification flags are nullable eligibility FACTS
--      (NULL = unknown, true/false = asserted), never titles or a role
--      hierarchy. A capability a member is not assigned to is simply the
--      ABSENCE of a row. The DB rejects a routable/overqualified assignment for
--      a capability whose required license the member does not hold, so an
--      incompatible assignment can never be persisted even if the UI is
--      bypassed.
--
--   2. SHARED-QUEUE CLAIMING. IPF's queue-owned-until-claimed model is reused on
--      `stewardship_outreach` (Right Path's shared board). Work is SHARED by
--      default: no claim at creation. A claim is a lightweight, optional soft
--      lease recorded ON THE WORK ROW (claimed_by_producer_id + claimed_at),
--      deliberately distinct from any episode/case assignee. The board is NEVER
--      filtered by claim; claiming only marks a commitment. action_context jsonb
--      is added for IPF parity (claim/callback metadata) without new tables.
--
--   3. PROJECT PARTICIPATION + ESCALATION. Participation (who works in a
--      project, even when nothing needs them now) and escalation (who an
--      exception goes to, in order) are kept SEPARATE from each other and from
--      project ownership — exactly the Right Path operating decision. For the
--      1035 project, operational problems escalate through Angie before Bob;
--      Andy is never a default escalation destination.
--
--   4. TODAY'S FOCUS. Management direction that ELEVATES a project or a single
--      activity. It is temporary by construction: expires_at is NOT NULL, so a
--      focus always has an end and can never silently become a permanent
--      priority. It feeds the GoRules Daily Direction decision as a signal; it
--      never disables other work and never overrides a customer commitment or
--      capability eligibility (those constraints stay in the engine/UI).
--
-- Deliberately NOT imported from IPF: practice_id multi-tenancy, the
-- ipf_command_owner SECURITY DEFINER command chain, audit_events, and the
-- ipf_require_practice_membership / ipf_check_permission gates. Right Path is
-- single-tenant; writes flow through service-role /api routes guarded by
-- requireInternalAdmin, and RLS mirrors every existing internal module
-- (admin SELECT via jwt_is_admin(), all writes via service_role).
--
-- Depends on: producers (20260522000002), projects (20261008230000),
--             stewardship_outreach (20260927000003), set_updated_at() and
--             jwt_is_admin() (earlier in the chain), auth.users (Supabase Auth).
--             Internal-only; no agency portal access. Idempotent / re-runnable.
-- =============================================================================


-- =============================================================================
-- 1. QUALIFICATION FLAGS ON PRODUCERS (IPF eligibility facts, re-homed)
-- Nullable with NO default: NULL = the fact is not established (unknown), true =
-- affirmatively held, false = affirmatively not held. We never default a fact
-- from a title/stereotype and never invent completeness: an unpopulated flag
-- stays unknown rather than silently reading as "not licensed".
-- =============================================================================
alter table public.producers
  add column if not exists is_life_licensed            boolean,
  add column if not exists is_securities_licensed      boolean,
  add column if not exists is_registered_support_staff boolean;

comment on column public.producers.is_life_licensed is
  'Eligibility fact for licensing gating: whether this team member holds a life '
  'license. NULL = unknown (not established), true = held, false = affirmatively '
  'not held. Not a title and not a routing assignment. Gates capabilities whose '
  'work_functions.required_qualification = ''life_licensed''.';

comment on column public.producers.is_securities_licensed is
  'Eligibility fact for registration/licensing gating: whether this team member '
  'holds a securities license. NULL = unknown, true = held, false = not held. '
  'Captured for later workflows; no securities capability rule is defined yet.';

comment on column public.producers.is_registered_support_staff is
  'Eligibility fact: whether this team member is registered support staff. '
  'NULL = unknown, true = held, false = not held. Captured for later workflows.';


-- =============================================================================
-- 2. WORK FUNCTIONS — the capability catalog (what work exists)
-- A durable catalog of the business ACTIVITIES a team member can be qualified to
-- perform. canonical_key is the stable machine key the engine and the shared
-- queues reference. required_qualification names the single qualification flag a
-- member must hold to be routably assigned (NULL = no license gate). This is the
-- authoritative requirement source of truth (IPF ADR: the requirement lives in
-- exactly one declared-data place).
-- =============================================================================
create table if not exists public.work_functions (
  id                     uuid primary key default gen_random_uuid(),
  canonical_key          text not null,
  label                  text not null,
  description            text,
  -- the qualification flag required to be ROUTABLY assigned to this capability,
  -- or NULL when the capability has no licensing gate. Checked by the trigger
  -- in section 3. Values match the producers qualification flag keys.
  required_qualification text
    check (required_qualification in
      ('life_licensed', 'securities_licensed', 'registered_support_staff')),
  sort_order             integer not null default 0,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.work_functions is
  'Capability catalog: the business activities a team member can be qualified to '
  'perform (e.g. outreach, operations_prep, determination). canonical_key is the '
  'stable key the shared queues and the GoRules Daily Direction engine reference. '
  'required_qualification is the single authoritative license gate for the '
  'capability (NULL = no gate).';

create unique index if not exists work_functions_canonical_key_key
  on public.work_functions (lower(canonical_key));

create index if not exists work_functions_active_idx
  on public.work_functions (is_active) where is_active;

drop trigger if exists work_functions_set_updated_at on public.work_functions;
create trigger work_functions_set_updated_at
  before update on public.work_functions
  for each row execute function public.set_updated_at();


-- First-slice capabilities. These are the ACTUAL activities present today: the
-- shared Stewardship board (outreach + the research exception) and the 1035
-- project's own derived stages (operations preparation, and Bob's senior-producer
-- determination). No activity is invented for work that does not yet exist
-- (no scheduling / appointment capability is seeded). determination requires a
-- life license; the rest are operations work with no license gate.
insert into public.work_functions (canonical_key, label, description, required_qualification, sort_order)
values
  ('outreach',        'Outreach',                 'Contact customers to establish servicing access (calls, emails, due promised callbacks) on the shared Stewardship board.', null, 10),
  ('research',        'Contact Research',         'Exception path: find usable contact information when a customer has none or it has failed.', null, 20),
  ('operations_prep', 'Operations Preparation',   'Collect and prepare the per-policy documents a project step requires (e.g. 1035 Step 3 carrier statement + reprojection) and hand the customer forward.', null, 30),
  ('determination',   'Determination',            'Make the customer-level candidacy / recommendation decision for a project (e.g. the 1035 Candidate / Not a Candidate determination). Senior producer work.', 'life_licensed', 40),
  ('office_support',  'General Office Support',   'Ordinary office business that is not tied to a specific project workflow.', null, 50)
on conflict (lower(canonical_key)) do update
  set label = excluded.label,
      description = excluded.description,
      required_qualification = excluded.required_qualification,
      sort_order = excluded.sort_order;


-- =============================================================================
-- 3. PRODUCER WORK FUNCTIONS — per-member capability assignment (eligibility)
-- Who is qualified+authorized for which capability. assignment_type:
--   'primary'       routable, the default workers for the capability
--   'support'       routable, backs up primary
--   'overqualified' capable but NOT normally routed (e.g. a senior producer who
--                   CAN do operations prep but should not be routed it)
-- "Not qualified" is never stored; it is simply the ABSENCE of a row.
-- project_id scopes an assignment to a single project (project-specific
-- participation / exception); NULL means it applies agency-wide. The unique
-- index treats agency-wide (NULL) and each project as distinct scopes.
-- =============================================================================
create table if not exists public.producer_work_functions (
  id               uuid primary key default gen_random_uuid(),
  producer_id      uuid not null references public.producers (id)     on delete cascade,
  work_function_id uuid not null references public.work_functions (id) on delete cascade,
  assignment_type  text not null
    check (assignment_type in ('primary', 'support', 'overqualified')),
  -- NULL = agency-wide eligibility; a project id = eligibility scoped to that
  -- project only (participation exception). on delete cascade so removing a
  -- project cleans up its scoped assignments.
  project_id       uuid references public.projects (id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.producer_work_functions is
  'Per-member capability assignment (eligibility). A member is eligible for a '
  'capability only if a routable (primary/support) row exists; absence of a row '
  'means not qualified. assignment_type overqualified = capable but not routed. '
  'project_id NULL = agency-wide; a project id scopes the assignment to that '
  'project (project-specific participation / exception).';

-- Agency-wide uniqueness (project_id IS NULL) and per-project uniqueness are two
-- partial unique indexes, because NULL project_id would never collide otherwise.
create unique index if not exists producer_work_functions_agencywide_key
  on public.producer_work_functions (producer_id, work_function_id)
  where project_id is null;

create unique index if not exists producer_work_functions_project_key
  on public.producer_work_functions (producer_id, work_function_id, project_id)
  where project_id is not null;

create index if not exists producer_work_functions_wf_idx
  on public.producer_work_functions (work_function_id);
create index if not exists producer_work_functions_project_idx
  on public.producer_work_functions (project_id) where project_id is not null;

drop trigger if exists producer_work_functions_set_updated_at on public.producer_work_functions;
create trigger producer_work_functions_set_updated_at
  before update on public.producer_work_functions
  for each row execute function public.set_updated_at();


-- Requirement gate (IPF parity, re-homed as a trigger instead of a governed
-- command): the DB rejects a routable or overqualified assignment for a
-- capability whose required license the member does not AFFIRMATIVELY hold. The
-- qualification flag must be exactly true; NULL (unknown) or false both fail,
-- so an unestablished license can never silently satisfy a gate.
create or replace function public.enforce_work_function_qualification()
  returns trigger
  language plpgsql
as $$
declare
  v_required text;
  v_has      boolean;
begin
  select required_qualification into v_required
    from public.work_functions where id = new.work_function_id;

  if v_required is null then
    return new; -- no license gate on this capability
  end if;

  select case v_required
           when 'life_licensed'            then is_life_licensed
           when 'securities_licensed'      then is_securities_licensed
           when 'registered_support_staff' then is_registered_support_staff
         end
    into v_has
    from public.producers where id = new.producer_id;

  if v_has is distinct from true then
    raise exception
      'Producer % lacks the qualification (%) required for this capability',
      new.producer_id, v_required
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_work_function_qualification() is
  'Rejects a producer_work_functions assignment for a capability whose required '
  'license the producer does not affirmatively hold (flag must be exactly true; '
  'NULL/unknown and false both fail). Mirrors the IPF requirement gate.';

drop trigger if exists producer_work_functions_qualification on public.producer_work_functions;
create trigger producer_work_functions_qualification
  before insert or update on public.producer_work_functions
  for each row execute function public.enforce_work_function_qualification();


-- =============================================================================
-- 4. SHARED-QUEUE CLAIMING ON stewardship_outreach (optional soft lease)
-- Work on the shared board is SHARED by default: these columns are NULL at
-- creation (no backfill sets them), so every existing and future row starts
-- unclaimed and visible to every eligible worker. A claim is an OPTIONAL,
-- lightweight commitment recorded on the work row itself — distinct from any
-- case/episode assignee. The board is never filtered by the claim.
-- action_context mirrors IPF's per-action metadata bag (claim/callback context)
-- so the claim path and later callback metadata have a home without a new table.
-- =============================================================================
alter table public.stewardship_outreach
  add column if not exists action_context       jsonb not null default '{}'::jsonb,
  add column if not exists claimed_by_producer_id uuid references public.producers (id) on delete set null,
  add column if not exists claimed_at           timestamptz;

comment on column public.stewardship_outreach.claimed_by_producer_id is
  'OPTIONAL soft-lease claim: the producer who has committed to this shared '
  'board item. NULL = unclaimed (shared, visible to every eligible worker). A '
  'claim never filters the board and is distinct from any case/episode assignee.';

comment on column public.stewardship_outreach.action_context is
  'Per-item metadata bag (IPF parity). Carries claim/callback context without a '
  'new table. Never a business-state column; the queue + transition columns '
  'remain authoritative for workflow state.';

create index if not exists stewardship_outreach_claimed_by_idx
  on public.stewardship_outreach (claimed_by_producer_id)
  where claimed_by_producer_id is not null;


-- =============================================================================
-- 5. PROJECT PARTICIPATION — who works in a project (My Projects)
-- Participation makes a project show up for a team member even when nothing
-- currently requires their attention. It is DELIBERATELY separate from project
-- ownership and from escalation (section 6): participating is not owning, and
-- not every participant performs every activity.
-- =============================================================================
create table if not exists public.project_participants (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id)  on delete cascade,
  producer_id uuid not null references public.producers (id) on delete cascade,
  -- optional free-text note on how they participate (e.g. "operations prep").
  -- NOT a role hierarchy and NOT an ownership claim.
  note        text,
  added_at    timestamptz not null default now(),
  constraint project_participants_unique unique (project_id, producer_id)
);

comment on table public.project_participants is
  'Who participates in a project (drives My Projects visibility). Separate from '
  'project ownership and from escalation. Participation does not imply '
  'performing every activity.';


-- =============================================================================
-- 6. PROJECT ESCALATION CONTACTS — who an exception goes to, in order
-- Escalation is project-specific and ordered by tier (1 = first destination).
-- It addresses EXCEPTIONS; it is not an approval step inserted into routine
-- work. Kept separate from participation and ownership.
-- =============================================================================
create table if not exists public.project_escalation_contacts (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id)  on delete cascade,
  producer_id uuid not null references public.producers (id) on delete cascade,
  -- 1 = first escalation destination for an operational exception, 2 = next, ...
  tier        integer not null check (tier >= 1),
  note        text,
  created_at  timestamptz not null default now(),
  constraint project_escalation_tier_unique unique (project_id, tier)
);

comment on table public.project_escalation_contacts is
  'Ordered, project-specific escalation for operational EXCEPTIONS (tier 1 = '
  'first destination). Not an approval step on routine work; separate from '
  'participation and ownership.';


-- =============================================================================
-- 7. TODAY'S FOCUS — temporary management direction fed to GoRules
-- Elevates a project (scope='project') or a single activity (scope='activity')
-- for a bounded period. expires_at is NOT NULL by construction, so a focus
-- always ends and can never silently become a permanent priority. The engine
-- reads only CURRENTLY-active focus (now < expires_at). Focus is a signal that
-- influences ordering; it never disables other work and never overrides a
-- customer commitment or capability eligibility.
-- =============================================================================
create table if not exists public.todays_focus (
  id               uuid primary key default gen_random_uuid(),
  -- what is being elevated:
  --   'project'  -> project_id is required, work_function_id is null
  --   'activity' -> work_function_id is required, project_id is optional
  --                 (optionally scope the activity to one project)
  scope            text not null check (scope in ('project', 'activity')),
  project_id       uuid references public.projects (id)       on delete cascade,
  work_function_id uuid references public.work_functions (id) on delete cascade,
  note             text,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  -- temporary by construction: a focus always has an end.
  expires_at       timestamptz not null,
  constraint todays_focus_scope_shape check (
    (scope = 'project'  and project_id is not null and work_function_id is null)
    or
    (scope = 'activity' and work_function_id is not null)
  ),
  constraint todays_focus_expiry_after_creation check (expires_at > created_at)
);

comment on table public.todays_focus is
  'Temporary management direction that elevates a project or a single activity '
  'for a bounded period (expires_at is required, so focus is never permanent). '
  'Fed to the GoRules Daily Direction engine as a priority signal; it never '
  'disables other work and never overrides a customer commitment or capability '
  'eligibility.';

create index if not exists todays_focus_active_idx
  on public.todays_focus (expires_at);


-- =============================================================================
-- 8. SEED — capabilities, 1035 participation, and 1035 escalation (real roster)
-- Grounded in the actual roster and the real "1035 Reviews" project. These seed
-- the FIRST workable slice; they are declared data, not a permanent hierarchy,
-- and the Team settings UI can change them. on conflict keeps replays idempotent.
-- =============================================================================
do $$
declare
  wf_outreach   uuid;
  wf_research   uuid;
  wf_ops_prep   uuid;
  wf_determine  uuid;
  wf_office     uuid;
  -- producers (resolved by stable id; verified against the live dev roster)
  p_ashley  uuid := '067ca02d-7618-4aea-84ad-9abaa5d166e0'; -- Director of Operations
  p_angie   uuid := '6fbce54f-5c02-4589-90b3-f4eb19248256'; -- Case Manager (ops)
  p_nikki   uuid := 'dcb3c1f9-a260-44ae-b02a-70fd000ea117'; -- Case Manager (ops)
  p_gabe    uuid := '7a8ffc03-a89a-4dfc-96d9-2cb552ca6036'; -- Client Relations (outreach)
  p_dulce   uuid := 'afc210a6-9974-4459-95bf-87dee6274f30'; -- Client Relations (outreach)
  p_bob     uuid := '55c0e564-35d1-4bcc-888d-8edaa4e2fdf7'; -- IAR / PFR (senior producer)
  p_tyler   uuid := '280f5f81-939c-4b29-b73c-97cf05f4411d'; -- Life Insurance Specialist
  proj_1035 uuid := '60d8ca7d-56fa-44e2-9cae-29a542d4eb48'; -- the "1035 Reviews" project
  has_proj  boolean;
begin
  select id into wf_outreach  from public.work_functions where canonical_key = 'outreach';
  select id into wf_research  from public.work_functions where canonical_key = 'research';
  select id into wf_ops_prep  from public.work_functions where canonical_key = 'operations_prep';
  select id into wf_determine from public.work_functions where canonical_key = 'determination';
  select id into wf_office    from public.work_functions where canonical_key = 'office_support';

  -- Bob is the senior producer who makes 1035 determinations -> affirmatively
  -- life licensed so the determination capability (life_licensed gate) can be
  -- assigned to him. No other licensing fact is asserted here; unestablished
  -- flags stay NULL (unknown), per the eligibility-fact design.
  update public.producers set is_life_licensed = true where id = p_bob;

  -- Agency-wide capability assignments (project_id NULL). Routable primary/support
  -- only; nobody is seeded 'overqualified' here (that exception is set per case
  -- via the UI). "Not qualified" is simply the absence of a row.
  insert into public.producer_work_functions (producer_id, work_function_id, assignment_type, project_id)
  values
    -- Outreach (shared Stewardship board): client-relations + case managers.
    (p_gabe,  wf_outreach, 'primary', null),
    (p_dulce, wf_outreach, 'primary', null),
    (p_nikki, wf_outreach, 'support', null),
    (p_angie, wf_outreach, 'support', null),
    -- Research (exception path): operations.
    (p_angie, wf_research, 'primary', null),
    (p_nikki, wf_research, 'primary', null),
    -- Operations preparation (1035 Step 3 prep and the like): operations.
    (p_angie,  wf_ops_prep, 'primary', null),
    (p_nikki,  wf_ops_prep, 'primary', null),
    (p_ashley, wf_ops_prep, 'support', null),
    -- Determination (senior producer; life-licensed gate): Bob.
    (p_bob, wf_determine, 'primary', null),
    -- General office support: broadly available.
    (p_gabe,   wf_office, 'primary', null),
    (p_dulce,  wf_office, 'primary', null),
    (p_tyler,  wf_office, 'primary', null),
    (p_ashley, wf_office, 'support', null)
  on conflict do nothing;

  -- The rest below is scoped to the real 1035 project. Guard on its existence so
  -- a replay against an environment without that project is a clean no-op.
  select exists(select 1 from public.projects where id = proj_1035) into has_proj;
  if has_proj then
    -- 1035 participation: the people who work this project (My Projects). This
    -- is participation, not ownership — ownership/escalation are separate.
    insert into public.project_participants (project_id, producer_id, note)
    values
      (proj_1035, p_angie,  'Operations: servicing access, Step 3 preparation'),
      (proj_1035, p_nikki,  'Operations: outreach and preparation'),
      (proj_1035, p_gabe,   'Outreach'),
      (proj_1035, p_dulce,  'Outreach'),
      (proj_1035, p_ashley, 'Operations manager'),
      (proj_1035, p_bob,    'Senior producer: candidacy determination')
    on conflict (project_id, producer_id) do nothing;

    -- 1035 escalation order: an operational exception goes to Angie FIRST
    -- (tier 1), then to Bob (tier 2). Andy is deliberately NOT an escalation
    -- destination for routine operational exceptions.
    insert into public.project_escalation_contacts (project_id, producer_id, tier, note)
    values
      (proj_1035, p_angie, 1, 'Operational exceptions escalate here first'),
      (proj_1035, p_bob,   2, 'Senior producer: reached only when the first tier cannot resolve it')
    on conflict (project_id, tier) do nothing;
  end if;
end
$$;


-- =============================================================================
-- 9. TABLE PRIVILEGES
-- Match every existing public table: default privileges do not auto-grant DML to
-- the API roles on this branch, so grant explicitly or PostgREST returns 403.
-- RLS below is what actually gates row access.
-- =============================================================================
grant all on public.work_functions              to anon, authenticated, service_role;
grant all on public.producer_work_functions      to anon, authenticated, service_role;
grant all on public.project_participants          to anon, authenticated, service_role;
grant all on public.project_escalation_contacts   to anon, authenticated, service_role;
grant all on public.todays_focus                  to anon, authenticated, service_role;


-- =============================================================================
-- 10. ROW LEVEL SECURITY
-- Internal staff (admin) read; all writes via service_role. Matches the
-- projects / stewardship module pattern exactly. Internal-only; no portal.
-- =============================================================================
alter table public.work_functions             enable row level security;
alter table public.producer_work_functions    enable row level security;
alter table public.project_participants        enable row level security;
alter table public.project_escalation_contacts enable row level security;
alter table public.todays_focus                enable row level security;

drop policy if exists work_functions_admin_select on public.work_functions;
create policy work_functions_admin_select
  on public.work_functions for select to authenticated using (public.jwt_is_admin());
drop policy if exists work_functions_all on public.work_functions;
create policy work_functions_all
  on public.work_functions for all to service_role using (true) with check (true);

drop policy if exists producer_work_functions_admin_select on public.producer_work_functions;
create policy producer_work_functions_admin_select
  on public.producer_work_functions for select to authenticated using (public.jwt_is_admin());
drop policy if exists producer_work_functions_all on public.producer_work_functions;
create policy producer_work_functions_all
  on public.producer_work_functions for all to service_role using (true) with check (true);

drop policy if exists project_participants_admin_select on public.project_participants;
create policy project_participants_admin_select
  on public.project_participants for select to authenticated using (public.jwt_is_admin());
drop policy if exists project_participants_all on public.project_participants;
create policy project_participants_all
  on public.project_participants for all to service_role using (true) with check (true);

drop policy if exists project_escalation_contacts_admin_select on public.project_escalation_contacts;
create policy project_escalation_contacts_admin_select
  on public.project_escalation_contacts for select to authenticated using (public.jwt_is_admin());
drop policy if exists project_escalation_contacts_all on public.project_escalation_contacts;
create policy project_escalation_contacts_all
  on public.project_escalation_contacts for all to service_role using (true) with check (true);

drop policy if exists todays_focus_admin_select on public.todays_focus;
create policy todays_focus_admin_select
  on public.todays_focus for select to authenticated using (public.jwt_is_admin());
drop policy if exists todays_focus_all on public.todays_focus;
create policy todays_focus_all
  on public.todays_focus for all to service_role using (true) with check (true);


-- Refresh PostgREST's schema cache so the new tables / columns are visible via
-- the API immediately.
notify pgrst, 'reload schema';
