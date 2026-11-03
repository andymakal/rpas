---
inclusion: always
---

# The calendar is the spine; workflows hang off it

Right Path's durable center is the customer relationship, and people's TIME is
its own first-class spine. Workflows — stewardship outreach, reviews, new
policies, service work, investments, life, in any combination — hang off the
calendar, never the reverse. This is the permanent orientation for anything that
touches appointments, callbacks, availability, or scheduling.

The dependency arrow points one way:

- Time is the resource. A producer's day is blocks of their OWN time
  (`calendar_blocks`, keyed on `producer_id`), not a slot owned by a project or
  a queue. A person's free time can be pointed at whatever work is most useful,
  which a project-scoped model cannot express.
- Capability is the filter. Capability tiers (`producer_work_functions`) say
  what a person is ALLOWED to pick up; they do not own the time.
- Workflows are the demand. They REFERENCE a calendar block (via a non-owning
  `source_type`/`source_id`); they never own the calendar. A stewardship
  callback that needs an exact time creates a `calendar_blocks` appointment and
  points at it — it does not store the time on the outreach row.

Practical consequences:

- Do NOT hang appointment/time data off a single workflow's table (e.g.
  `stewardship_outreach`). An appointment or held block is a `calendar_blocks`
  row; the workflow is a reference on it.
- A held block may have no customer and no workflow at all (a producer blocking
  review hours, an assistant's open time). The spine must represent that.
- All appointment times are an absolute instant plus the IANA zone they were
  STATED in, resolved and rendered through `@/lib/time`. Never store a bare
  wall-clock time; never hard-code a UTC offset (DST makes that wrong twice a
  year). The customer's clock and the producer's clock are both derived from the
  one stored instant.

The authoritative design, the `calendar_blocks` shape, and the layered build
plan live in `CALENDAR_DESIGN.md`. This file is the orientation; that document
is the detail. When they disagree with the repository, the repository wins — fix
the document.
