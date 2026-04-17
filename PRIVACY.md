# RoutineFlow Privacy

RoutineFlow is a local-first product. This document describes what data the application handles, where it is stored, and what never leaves the user's machine.

## Data Boundary

**Nothing is transmitted to any external server by RoutineFlow.** There is no telemetry, no crash reporting, no analytics, and no cloud sync in v1.

The only network activity RoutineFlow initiates is:

1. **User-authored workflows.** When you run a recorded workflow, the runner navigates to the URLs you recorded and interacts with those pages on your behalf. The operator of those sites sees the traffic — that is inherent to automation and unavoidable.
2. **Playwright's Chromium download at install time** (from `playwright.azureedge.net`), triggered by `postinstall: playwright install chromium`. This is a one-time download controlled by Playwright, not by RoutineFlow.

No other outbound request is ever made.

## What Is Stored and Where

All RoutineFlow data lives under `~/.routineflow/` on the user's machine:

| Path | Contents | Sensitivity |
|---|---|---|
| `~/.routineflow/app.db` | SQLite database: workflows, recording sessions, runs, run steps, schedules, auth profile metadata, settings | Medium — recording sessions may contain URLs and non-redacted field labels |
| `~/.routineflow/artifacts/recordings/` | Raw recording JSON before compilation | Medium — same as above |
| `~/.routineflow/artifacts/screenshots/` | Per-step before/after screenshots when debug mode is on | High — screenshots capture whatever was on screen |
| `~/.routineflow/artifacts/traces/` | Playwright trace archives (DOM snapshots, network, screenshots) | High — same as above |
| `~/.routineflow/artifacts/logs/` | Structured run logs | Low — values are redacted; URLs and step metadata are not |
| `~/.routineflow/profiles/<id>/` | Browser state for authenticated workflows: cookies, localStorage, IndexedDB | **Very high — treat like a password vault** |
| `~/.routineflow/backups/` | SQLite backups created by `pnpm db:backup` | Same as `app.db` |

Permissions on `profiles/` are set to `0700` (owner-only) on install.

## What Is Redacted

The recorder drops field values for any input that looks sensitive. An input is considered sensitive if any of the following match:

- `type="password"`
- `autocomplete` attribute includes `current-password`, `new-password`, `cc-number`, or `one-time-code`
- `name` or `id` matches `/pass|secret|token|cvv|ssn/i`

When redacted, the recorder emits an event with `redacted: true` and omits the `value` field. The compiler then skips the `type` step entirely — **the compiled workflow will not contain the password or token**. This also means authenticated workflows cannot be replayed from a cold recording; they require an auth profile (see below).

Before logs are written to disk, `redactString` and `redactObject` in `packages/shared-types/src/index.ts` scrub values that look like credentials: bearer tokens, API keys, and anything tagged sensitive. The same functions run on run-detail exports.

## Auth Profiles

Authenticated workflows use **auth profiles**: isolated Playwright browser contexts with their own storage state. A profile is created by an interactive login flow and its state is saved under `~/.routineflow/profiles/<id>/`.

- Profiles are never included in diagnostic exports
- Profile directories are ignored by `pnpm db:backup` (backups cover `app.db` only)
- Profiles are not synced, uploaded, or shared between machines
- Deleting a profile via the runner API removes the directory

To inspect what a profile stores, open the `storageState.json` or `cookies` files inside the profile directory — it is plain JSON, not encrypted at rest. **Anyone with filesystem access to the user's home directory can read authenticated session cookies.** Full-disk encryption (FileVault on macOS, BitLocker on Windows, LUKS on Linux) is the recommended mitigation.

## Diagnostics Export

`pnpm diagnose` writes a report to `~/.routineflow/logs/diagnostics-<timestamp>.json`. Before you share a diagnostics report:

- Run-detail exports apply `redactObject` — credential-shaped values are replaced
- URLs and page titles are **not** redacted — inspect the report before sharing
- Screenshot paths are included in the report but the images themselves are not embedded — share at your discretion

## Chrome Permissions

See [PERMISSIONS.md](./PERMISSIONS.md) for each permission's purpose and justification.

## Deleting Data

```sh
node scripts/local-uninstall.mjs   # prompts before deleting ~/.routineflow/
```

Or manually: `rm -rf ~/.routineflow/` after removing the extension from Chrome.

## Questions

RoutineFlow has no data controller — your data is yours and never leaves your machine. For questions or security concerns, see [SECURITY.md](./SECURITY.md).
