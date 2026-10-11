# RPAS — collaborator context (retired)

This handoff file is retired. It described the project as of May 2026 and no
longer matches the repository: it predated the production/development split, the
financial-review work, and the IPF integration direction, and some of what it
asserted (for example that local dev and production share one database) is no
longer how the project is set up.

The single source of truth for repository-level instructions is **`AGENTS.md`**
at the repo root. Kiro reads it directly; Claude Code reads it via `CLAUDE.md`,
which imports `@AGENTS.md`. `AGENTS.md` covers the architecture, the branch and
deployment model, the shared development workflow, the current architectural
decisions, sensitive-data handling, and the established IPF integration
decisions.

Some operational docs and Kiro steering (development environment setup, the
Vercel review preview, and the Kiro steering files under `.kiro/steering/`) live
on the `development` branch alongside the in-progress work they describe, and may
not be present on `main`. Look for them on `development`.

Always verify live system state (schema, data, identifiers, deploy status, which
branch you are on) against the source at the moment of the claim rather than
trusting any static document, including this one.
