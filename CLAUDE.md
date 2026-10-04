<!-- autobots:managed:start -->

# CLAUDE.md

Configuration and instructions for Claude Code.

## Rules

## MCP Servers

Configured MCP servers provide access to external tools and data sources.
See settings.json for server configuration.

<!-- autobots:managed:end -->

See @AGENTS.md for project context, commands, architecture, constraints, and testing.

## Nested AGENTS.md

Domain instruction files, imported so they apply when working in their area:

- @src/actions/AGENTS.md — server action patterns (auth order, Zod, cache)
- @src/lib/AGENTS.md — infrastructure layer conventions

## Codemaps and docs

- `docs/CODEMAPS/INDEX.md` — architecture, backend, data, frontend, dependency maps
- `docs/RUNBOOK.md` — deploy checklist, cron jobs, incident steps
- `docs/ENV.md` — environment variable reference (source of truth: `src/lib/env.ts`)

## Serena memories (`.serena/memories/`)

Read on demand when relevant: `zod-validation-patterns`, `prisma-enum-type-safety`,
`react-ref-forwarding`, `test-mock-update-patterns`, `coding-patterns-guide`.
Activate the project (`/home/clovr/projects/grizzly`) before using Serena tools.

## Library docs

Verify version-specific APIs (Prisma, Stripe, Resend, Auth.js, Zod, date-fns) via
Context7 before guessing. Fetch only what the task needs.

## Notes

- No project-level `.claude/` directory — agents, rules, and skills come from global
  `~/.claude/`.
- This file is advisory and reloads every session — keep it short.
