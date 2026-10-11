# RPAS — collaborator context (retired)

This handoff file is retired. It described the project as of May 2026 and now
conflicts with the current repository: it predates the production/development
Supabase split (it claimed local dev and production share one database), the
Projects, Stewardship, and Financial Review modules, the light/dark workflow
design system, and the IPF integration direction.

The single source of truth for repository-level instructions is **`AGENTS.md`**
at the repo root. Both Kiro and Claude Code load it (Claude Code via `CLAUDE.md`,
which imports `@AGENTS.md`).

For specifics, see:

- `AGENTS.md` — architecture, production/development boundary, shared
  development workflow, current architectural decisions, and IPF integration
  intent.
- `DEV_ENV_SETUP_HANDOFF.md` — development environment and Supabase branch setup.
- `PREVIEW_DEPLOYMENT.md` — the access-protected Vercel review preview.
- `.kiro/steering/` — Kiro-specific guidance (`ipf-integration.md`,
  `workflow-visual-rules.md`).

Always verify live system state (schema, data, identifiers, deploy status)
against the source at the moment of the claim rather than trusting any static
document, including this one.
