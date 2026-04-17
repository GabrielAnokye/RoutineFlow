# RoutineFlow

RoutineFlow is a **local-first browser automation tool**: a Chrome MV3 extension records what you do in the browser, a local Fastify-based runner replays it via Playwright, and everything — workflows, runs, recordings, screenshots, traces — lives on your machine. No cloud, no account, no telemetry.

## Quick Start

```sh
node scripts/local-install.mjs
```

Then load `apps/extension/dist/` unpacked into Chrome and follow the printed steps. The full walkthrough is in [INSTALL.md](./INSTALL.md).

## Workspace Layout

```text
apps/
  extension/         MV3 Chrome extension (side panel + service worker + recorder)
  runner/            Local Fastify runner with Playwright execution engine
  bridge-host/       Native messaging host bridging the extension to the runner
packages/
  shared-types/      Zod schemas + types shared across all surfaces
  compiler/          Recording → workflow compiler (locator ranking, normalization)
  db/                node:sqlite repository (workflows, runs, artifacts, schedules)
  bridge-protocol/   Native messaging command/response schemas
  logger/            Pino logger + ring buffer for diagnostics
  ui/                Shared React components for the side panel
docs/                Architecture decision records, PRD, roadmap
scripts/             Install, uninstall, diagnose, backup, release-packaging
tests/
  e2e/               Playwright end-to-end specs
  fixtures/          Demo HTML pages used by recorder + e2e tests
```

## Documentation

| | |
|---|---|
| **[INSTALL.md](./INSTALL.md)** | Step-by-step install, including native messaging registration |
| **[RELEASE.md](./RELEASE.md)** | Building and packaging release artifacts |
| **[PRIVACY.md](./PRIVACY.md)** | What data is stored, where, and what never leaves your machine |
| **[SECURITY.md](./SECURITY.md)** | Threat model, controls, vulnerability reporting |
| **[PERMISSIONS.md](./PERMISSIONS.md)** | Every Chrome permission and its justification |
| **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** | Common issues and fixes |
| **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** | High-level architecture |
| **[docs/PRD.md](./docs/PRD.md)** | Product requirements document |
| **[docs/ROADMAP.md](./docs/ROADMAP.md)** | Milestones and v1.1+ scope |

## Prerequisites

- Node.js 22 or newer (uses the experimental `node:sqlite` module)
- Corepack-managed pnpm 9
- Google Chrome (any recent stable)

```sh
node --version    # >= 22.0.0
corepack enable
```

## Root Commands

| | |
|---|---|
| `pnpm dev` | Build packages + watch the extension + run the runner on `:3100` |
| `pnpm build` | Build all workspace packages and apps |
| `pnpm test` | Run the full vitest suite (149 tests) |
| `pnpm test:unit` | Same as `pnpm test` |
| `pnpm test:integration` | Run runner + DB + executor integration suites |
| `pnpm test:e2e` | Build, then run Playwright e2e specs |
| `pnpm test:all` | Unit + e2e in sequence |
| `pnpm lint` | ESLint across the workspace |
| `pnpm typecheck` | `tsc -b` across all referenced projects |
| `pnpm check` | lint + typecheck + unit tests (the CI gate) |
| `pnpm clean` | Remove build outputs and test artifacts |
| `pnpm diagnose` | Verify install state, paths, permissions |
| `pnpm db:backup` | Snapshot `~/.routineflow/app.db` to `~/.routineflow/backups/` |
| `pnpm db:restore -- <path>` | Restore the active database from a backup |
| `pnpm install:bridge -- --extension-id <id>` | Register the native messaging host |
| `pnpm uninstall:bridge` | Remove the native messaging host |
| `pnpm local:install` | One-command: install + build + create runtime dirs |
| `pnpm local:uninstall` | One-command: clean dist + (optionally) remove data |
| `pnpm release:build` | Clean + full build |
| `pnpm release:verify` | `check` + e2e (the release gate) |
| `pnpm release:package` | Produce zips/tarballs in `release/` |
| `pnpm audit:manifest` | Verify declared Chrome permissions match `chrome.*` usage |

## Status

- 17 test files / 149 tests passing
- TypeScript builds clean
- ESLint clean
- All 7 declared Chrome permissions justified by actual API usage
- WAL-mode SQLite with foreign-key enforcement and 5-second busy timeout

See [TECH-LEAD-REVIEW.md](./TECH-LEAD-REVIEW.md) for the v1 release checklist, known issues, and v1.1 roadmap.

## Contributing

Before opening a PR, run:

```sh
corepack pnpm check
```

This is the same gate CI runs. Security checklist for contributors is in [SECURITY.md](./SECURITY.md).
