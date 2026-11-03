# UI composition vocabulary (Lego → Panel → Workbench → Workflow)

Right Path's operator UI is built in four named tiers. Use these words
consistently in code, comments, component names, and conversation. This is the
permanent vocabulary; it supersedes any looser or interchangeable usage
elsewhere.

## The four tiers

- Lego: a single self-contained component that owns its own logic (editing,
  validation, formatting, display) for one field or one control. The smallest
  reusable unit. A host supplies data and a save/intent handler; the Lego owns
  everything else. Examples: the contact-field components (`ContactName`,
  `ContactEmail`, `ContactPhone`, `ContactDob`, `ContactAddress`,
  `ContactAlert`), and small action controls such as the Call button and Skip
  for now. The established Lego shape is a pure rules module + a headless Fields
  component + a draft hook + a thin standalone Editor (the contact-card Legos in
  `src/components/workflow/` are the reference pattern).

- Panel: one composed unit that sits on a workbench and performs one piece of
  the operator's task, built from Legos. Example: the call-action panel inside
  the Guided Call Workbench (customer name, dial, reach/skip, notes).

- Workbench (= Screen): everything on the screen for one step of the work.
  "Workbench" and "screen" are interchangeable. A workbench holds one or more
  panels. Example: Make the Calls That Are Due is the Guided Call Workbench.

- Workflow: the ordered path an operator moves through, one workbench/screen per
  step. Example: the My Work outreach path.

Composition goes one way only: Legos compose into panels, panels into a
workbench/screen, workbenches into a workflow.

## File organization

Each Lego and each named reusable component gets its OWN file in
`src/components/workflow/`, exported through the barrel
`src/components/workflow/index.ts` so callers always import from
`@/components/workflow` and never care how the files are split. A named
component someone will search for by name (e.g. `CallButton`,
`SkipForNowButton`, `OperationalTag`) must be addressable as its own file. This
is the standard design-system layout (one component per file + a barrel) and the
direction for all new work.

`primitives.tsx` is the existing grouped file of generic shared controls and
helpers. It is frozen: do NOT add new Legos there. True shared design helpers
and tokens (not named components callers reach for individually) may stay
grouped. Breaking the current `primitives.tsx` into per-component files is an
agreed future refactor to be done deliberately as its own reviewed change, not
piecemeal mid-task.

## Build it as a Lego first (component-first is the default)

New operator-facing UI is built FROM components, not as bespoke markup that is
later extracted. When you write a piece of interaction, the default is to make
it a Lego (or compose existing Legos) from the start, not to hand-write the
markup inline and leave extraction for "later". Extraction-later is how the same
ten lines end up copied across a hundred screens.

Concretely:

- A recurring interaction pattern is a Lego, defined once and called in one
  line everywhere it appears. The reference example is the Done / Skip action
  pair (`DoneSkipActions`): Done COMMITS the captured input (grayed until the
  host says it is ready), Skip ABANDONS the pending input and advances to the
  next item — identical behavior everywhere — so a surface wires it with a
  single component, never by re-writing the two buttons and their gating. Build
  such patterns as a shared Lego the first time a second use appears (and
  proactively when you can already see the pattern will recur), rather than
  pasting the markup again.
- Prefer composing existing Legos over writing new markup. Before hand-writing a
  control, check the barrel (`@/components/workflow`) for one that already does
  it, and extend it (a new prop, a new tone) rather than duplicating it.
- Do not drive component granularity to the molecular level for its own sake. A
  Lego must earn its existence by being reused OR by cleanly owning one unit of
  logic/display; a one-off arrangement with no reuse and no self-contained logic
  can stay inline. When a genuinely shared pattern would be overkill to extract,
  say so rather than extracting reflexively. The test is reuse and cohesion, not
  "smallest possible piece".
- A new reusable Lego follows the File organization rule above: its own file in
  `src/components/workflow/`, exported through the barrel.

## Call workbenches are situation-specific

The Guided Call Workbench is specifically the outbound outreach (marketing)
call: dial, then the single question "did we reach them or not," because an
outbound call has exactly two outcomes — they pick up or they don't. An inbound
call is a different situation and may have its own workbench.

What happens after "Reached" is NOT universal. The reach-outcome choices depend
on which panel and workbench the operator is on. Treat the post-reach branch as
workbench-specific, never as one global set of outcomes.
