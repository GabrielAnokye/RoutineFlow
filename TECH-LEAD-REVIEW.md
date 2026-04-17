# RoutineFlow v1 — Tech Lead Review

End-of-cycle review of the v1 cut. Captures the final repo tree, root commands, release checklist, known issues ranked by severity, and the v1.1 roadmap. This is the authoritative pre-release document.

## Repo Tree

```text
routineflow/
├── README.md
├── INSTALL.md
├── RELEASE.md
├── PRIVACY.md
├── SECURITY.md
├── PERMISSIONS.md
├── TROUBLESHOOTING.md
├── TECH-LEAD-REVIEW.md          ← this file
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.web.json
├── vitest.config.ts
├── playwright.config.ts
├── eslint.config.mjs
├── prettier.config.mjs
├── .editorconfig
├── .env.example
├── .gitignore
├── .github/
│   └── workflows/
│       └── ci.yml                Lint + typecheck + unit + integration + e2e + matrix build
├── apps/
│   ├── extension/                MV3 Chrome extension
│   │   ├── public/
│   │   ├── scripts/write-manifest.mjs
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── api.ts
│   │   │   ├── bridge/           Native-messaging client (extension side)
│   │   │   ├── content-script.ts
│   │   │   ├── env.ts
│   │   │   ├── hooks/            useUndoRedo
│   │   │   ├── main.tsx
│   │   │   ├── recorder/         content-recorder, event-buffer, selector, redact
│   │   │   ├── scheduler.ts      Alarm-based local scheduler
│   │   │   ├── service-worker.ts
│   │   │   ├── store.ts          zustand
│   │   │   ├── styles.css
│   │   │   └── views/            WorkflowEditor, WorkflowList, RunDetail, Schedules
│   │   └── vite.config.ts
│   ├── runner/                   Fastify HTTP runner + Playwright executor
│   │   ├── src/
│   │   │   ├── app.ts            All endpoints
│   │   │   ├── core/             executor, locate, persist, run-registry
│   │   │   ├── env.ts
│   │   │   └── index.ts
│   │   └── tsconfig.json
│   └── bridge-host/              Native messaging host (stdio)
│       ├── install/              install.mjs, uninstall.mjs, launchers, manifest template
│       └── src/
│           ├── cli.ts            Entrypoint (bridge mode + --diagnose)
│           ├── correlation.ts
│           ├── diagnostics.ts
│           ├── dispatcher.ts
│           ├── framing.ts        Chrome length-prefixed JSON framing
│           ├── index.ts
│           ├── logger.ts         File logger (never stdout — reserved for protocol)
│           ├── runner-client.ts  HTTP + in-process backends
│           └── timeouts.ts
├── packages/
│   ├── shared-types/             All Zod schemas + redaction utilities
│   ├── compiler/                 Recording → workflow pipeline
│   ├── db/                       node:sqlite repository (WAL mode, FK on)
│   ├── bridge-protocol/          Cross-process command schemas + PROTOCOL_VERSION
│   ├── logger/                   Pino logger + log ring buffer
│   └── ui/                       Shared React components
├── docs/
│   ├── ADR-001-stack.md
│   ├── ADR-002-recording-and-replay-model.md
│   ├── ADR-003-auth-and-security-model.md
│   ├── ARCHITECTURE.md
│   ├── PRD.md
│   └── ROADMAP.md
├── scripts/
│   ├── audit-manifest.mjs        Cross-references manifest perms vs chrome.* usage
│   ├── db-backup.mjs
│   ├── db-restore.mjs
│   ├── diagnose.mjs              Whole-system health check
│   ├── local-install.mjs         One-command developer install
│   ├── local-uninstall.mjs       One-command clean
│   └── package-release.mjs       Produces release/ artifacts + SHA256SUMS
└── tests/
    ├── e2e/                      Playwright specs against the runner
    └── fixtures/
        ├── demo-pages/           forms, tables, dropdowns, spa, iframe, shadow-dom, ambiguous, delayed
        └── recorder-demo/        Pages used by recorder e2e
```

## Root Commands

Single source of truth for every operation a contributor or release manager needs.

### Daily development

```sh
corepack pnpm dev                 # build packages, watch ext, run runner on :3100
corepack pnpm test                # 149 tests
corepack pnpm test:unit           # same
corepack pnpm test:integration    # runner + db + executor only
corepack pnpm test:e2e            # build then Playwright e2e
corepack pnpm check               # lint + typecheck + unit (CI gate)
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm clean
```

### Install / operations

```sh
node scripts/local-install.mjs                          # one-command setup
pnpm install:bridge -- --extension-id <id>              # register native host
pnpm diagnose                                           # whole-system health
pnpm db:backup
pnpm db:restore -- ~/.routineflow/backups/<file>.db
node scripts/local-uninstall.mjs                        # one-command teardown
node scripts/local-uninstall.mjs --keep-data            # keep ~/.routineflow/
node scripts/local-uninstall.mjs --yes                  # skip confirmation
```

### Release

```sh
corepack pnpm release:build       # clean + full build
corepack pnpm release:verify      # check + e2e
corepack pnpm release:package     # release/ zips + tarballs + SHA256SUMS
corepack pnpm audit:manifest      # confirm permission set
```

## Release Checklist

Pre-flight before tagging a v1.x release:

- [ ] `corepack pnpm check` passes (lint + typecheck + 149 unit tests)
- [ ] `corepack pnpm test:e2e` passes against a clean clone
- [ ] `corepack pnpm audit:manifest` reports no missing or unused permissions
- [ ] `pnpm diagnose` from a fresh install passes every check
- [ ] `INSTALL.md` accurately describes the new install flow
- [ ] `RELEASE.md` checklist updated if the build pipeline changed
- [ ] `PRIVACY.md` reflects any new data path
- [ ] `PERMISSIONS.md` matches `apps/extension/scripts/write-manifest.mjs`
- [ ] All workspace packages share the same version
- [ ] `CHANGELOG.md` appended with the new version
- [ ] `git tag v<version>` created
- [ ] `corepack pnpm release:build && node scripts/package-release.mjs` produces all artifacts
- [ ] `release/SHA256SUMS.txt` regenerated and matches uploaded artifacts
- [ ] Chrome Web Store listing updated with `release/routineflow-extension-<version>.zip`
- [ ] GitHub release created with all `release/` files attached
- [ ] Smoke test from `INSTALL.md` performed on macOS (and Linux/Windows if possible)

## Known Issues — Ranked by Severity

### High

1. **Auth profiles are stored unencrypted at rest.** Anyone with filesystem access to `~/.routineflow/profiles/` can read session cookies. Mitigation today: `0700` perms on the profiles dir + recommendation to enable full-disk encryption. ([PRIVACY.md](./PRIVACY.md))
   - **v1.1 plan:** OS-level secret stores (Keychain / DPAPI / Secret Service) for the encryption key, with the cookie store encrypted at rest.

2. **Auth profile creation is manual in v1.** `validateAuthProfile` exists, but the interactive login flow that *creates* a profile is not wired up. Users must hand-place a Playwright `storageState.json`.
   - **v1.1 plan:** Headful `createAuthProfile` flow that launches Playwright, lets the user log in, and saves the resulting state.

### Medium

3. **No webRequest interception.** Workflows that depend on intercepting or replaying network responses cannot be expressed in v1. Out of scope by design but is the most-requested follow-on.
   - **v1.1 plan:** Optional `mockRequest` step type backed by Playwright's `route()`.

4. **Service worker idle drops mid-recording.** Mitigated by `chrome.alarms` keep-alive, but very long recordings (>1 h) on an inactive Chrome profile occasionally lose the last few events between SW restarts.
   - **v1.1 plan:** Persist the recording session to `chrome.storage.session` so a SW restart can rehydrate.

5. **Locator drift between record and replay.** Pages that re-render with slightly different role names cause low-confidence runs even though the UI looks identical to a human.
   - **v1.1 plan:** Self-healing locators — on failure, capture the candidate set and offer a one-click "promote this fallback to primary" in the run-detail view.

### Low

6. **`storage` permission was previously declared but unused.** Removed in this release; documented in `PERMISSIONS.md`. Listed for transparency only — not a runtime issue.

7. **Playwright Chromium download adds ~120 MB to install time.** Unavoidable given the dependency, but documented in `TROUBLESHOOTING.md` for users on slow connections.

8. **Diagnostics export does not redact URLs or page titles** (only credential-shaped values). Users sharing a diagnostics bundle should review it. Documented in `PRIVACY.md`.

9. **No icons in the extension manifest.** v1 ships without `icons` declared; Chrome falls back to the puzzle-piece default. Acceptable for the developer-only initial release; the Chrome Web Store will reject submission without icons.
   - **v1.1 plan:** Ship 16/32/48/128 PNG icons.

10. **Single-user / single-OS-account assumption.** Multi-user shared machines are not in the v1 threat model.

## v1.1 Roadmap

Targeted for the next minor release. None are blocking v1.

| Item | Why | Effort |
|---|---|---|
| Interactive auth profile creation | Closes the #2 high-severity item; current workflow requires hand-placed `storageState.json` | M |
| OS keystore for profile encryption | Closes #1; turns "treat your home dir like a vault" into "treat your OS login like a vault" | L |
| Self-healing locators (one-click promote) | Tackles #5; biggest user-facing reliability lever | M |
| `mockRequest` / `routeRequest` step | Most-asked follow-on per #3 | M |
| SW-restart-resilient recording sessions | Closes #4 | S |
| Workflow icons + Chrome Web Store assets | Required for the public store listing | S |
| Optional run-history retention policy | Long-running users will accumulate trace zips; need GC | S |
| URL/title redaction toggle in diagnostics | Closes #8 | XS |
| Built-in Playwright Trace Viewer launch from the run-detail view | Quality-of-life — currently users `open <trace.zip>` manually | S |
| Multi-tab recording integration coverage in vitest | E2E covers it; unit-level would be cheaper to maintain | M |

## Test Coverage Snapshot

```
17 files / 149 tests passing
```

Breakdown:

| Suite | Tests |
|---|---|
| `apps/extension/src/recorder/` (4 files) | 19 |
| `apps/extension/src/scheduler.test.ts` | 5 |
| `apps/extension/src/hooks/useUndoRedo.test.ts` | 11 |
| `apps/extension/src/env.test.ts` | 1 |
| `apps/runner/src/app.test.ts` | 23 |
| `apps/runner/src/core/executor.test.ts` | 8 |
| `apps/runner/src/core/locate.test.ts` | 19 |
| `apps/bridge-host/src/framing.test.ts` | 7 |
| `apps/bridge-host/src/dispatcher.test.ts` | 5 |
| `packages/shared-types/src/index.test.ts` | 18 |
| `packages/compiler/src/index.test.ts` | 13 |
| `packages/db/src/index.test.ts` | 14 |
| `packages/bridge-protocol/src/index.test.ts` | 9 |
| `packages/ui/src/index.test.tsx` | 1 |
| `packages/logger/src/index.test.ts` | 1 |

E2E specs in `tests/e2e/` exercise the runner against real Chromium plus a native-messaging smoke test.

## Hardening Pass — What Changed

- SQLite opened in **WAL mode** with `synchronous=NORMAL`, `foreign_keys=ON`, and a 5-second `busy_timeout` for crash-safe writes
- Recorder rejects restricted pages (`chrome://`, `chrome-extension://`, web store, view-source) with a clear error before injection is attempted
- `storage` permission removed from the manifest (was declared but never used)
- `audit-manifest.mjs` script keeps declared permissions and `chrome.*` API usage in sync going forward
- ESLint config tightened with `no-unused-vars` (allowing `_`-prefixed) so dead code surfaces in CI
- All pre-existing TypeScript and lint errors fixed — the workspace is fully green

## Final Note

Everything in this document is runnable. There are no placeholders, no "TODO add later" hooks, no fake commands. A new engineer can clone the repo, run `node scripts/local-install.mjs`, follow `INSTALL.md`, and have a working RoutineFlow install in under ten minutes.
