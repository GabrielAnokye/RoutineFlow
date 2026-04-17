# RoutineFlow Troubleshooting

Common issues and how to fix them. Run `pnpm diagnose` first — it catches 80% of problems automatically.

## Installation

### `corepack pnpm install` fails with `ERR_PNPM_UNSUPPORTED_ENGINE`

Your Node version is older than 22. Upgrade Node, then:

```sh
node --version        # must be >=22.0.0
corepack enable
corepack pnpm install
```

### `playwright install chromium` is slow or times out

Playwright downloads ~120 MB of Chromium from `playwright.azureedge.net` on first install. If you're on a slow connection or behind a corporate proxy:

```sh
export PLAYWRIGHT_DOWNLOAD_HOST=https://playwright.azureedge.net
corepack pnpm exec playwright install chromium --with-deps
```

### `better-sqlite3` or native-sqlite compile errors

RoutineFlow uses the built-in `node:sqlite` module (experimental, Node 22+) — **not** `better-sqlite3`. If you see native-compile errors, a stale dependency has been added to `package.json`. Remove it; we never need a native SQLite build.

## Extension

### "Service worker reachable" never turns green

```sh
pnpm diagnose
```

Check the "Native host manifest" row. If missing, the bridge was never registered:

```sh
pnpm install:bridge -- --extension-id <YOUR_EXTENSION_ID>
```

The extension ID is visible at `chrome://extensions` on the RoutineFlow card.

### "Native host unavailable" in the side panel

Chrome couldn't launch the bridge host. Causes:

1. **Manifest path is stale.** You moved the repo after registering the bridge. Re-run `pnpm install:bridge -- --extension-id <id>`.
2. **Launcher isn't executable.** On macOS/Linux: `chmod +x apps/bridge-host/install/launcher.sh`.
3. **Extension ID changed.** Removing and re-adding the unpacked extension generates a new ID — Chrome will refuse to connect with the old manifest. Re-register.
4. **Host built against old protocol version.** Check `cat ~/.routineflow/logs/bridge-host.log` — if you see `version_mismatch`, rebuild: `corepack pnpm --filter @routineflow/bridge-host build`.

### Recording captures nothing

- Confirm you clicked **Start recording** before navigating; new sessions inject the recorder into the *active* tab, not all tabs retroactively
- The recorder cannot run on `chrome://` pages, the Chrome Web Store, or other restricted URLs. The side panel will surface an error if you try
- Check `chrome://extensions` → RoutineFlow → Service worker → Console for errors
- Refresh the page and start a new recording

### Recording is missing events from a new tab

New tabs must be opened **while recording is active**. The recorder detects tab spawns via `chrome.tabs.onCreated` and injects itself. Tabs opened before recording started are not recorded.

### Passwords appear in the compiled workflow

They shouldn't. Check:

1. Did the field's `type` attribute include `password`? Only `<input type="password">` is automatically redacted.
2. Does the field's `name` or `id` match `/pass|secret|token|cvv|ssn/i`? If not, the heuristic misses it.

If your field is sensitive but uses an unusual attribute, either add `autocomplete="new-password"` on the page, or extend the sensitive-heuristic pattern in `apps/extension/src/recorder/redact.ts`.

### Side panel is blank

Rebuild and reload:

```sh
corepack pnpm build:extension
# Then in chrome://extensions, click the reload arrow on RoutineFlow
```

Check the side panel's DevTools console (right-click panel → Inspect) for bundle errors.

## Runner

### Runner won't start on port 3100

Another process holds the port:

```sh
lsof -i :3100                 # macOS/Linux
netstat -ano | findstr :3100  # Windows
```

Either kill the other process or set `RUNNER_PORT=3101` in `.env`.

### Runs stay in `running` forever

The runner process crashed. Check:

```sh
tail -f ~/.routineflow/artifacts/logs/*.log
```

If the runner was killed, you'll see the stale run row in the DB. Mark it failed manually:

```sh
sqlite3 ~/.routineflow/app.db \
  "UPDATE runs SET status='failed', finished_at=strftime('%s','now')*1000 WHERE status='running';"
```

Then restart the runner.

### Playwright launch fails: `Executable doesn't exist`

You ran `pnpm install` but Playwright's postinstall didn't download Chromium. Force it:

```sh
corepack pnpm --filter @routineflow/runner exec -- playwright install chromium
```

### Runs fail with "locator not found" on pages that worked during recording

A few common causes:

1. **Dynamic content.** The page renders the target after the compiled `click` step fires. Add a `waitFor` step before it, or re-record with a pause at the moment the target appears.
2. **Role/name drift.** The recorder captured a role locator like `role=button[name="Continue"]`, but the page now says "Next". Role+name locators are strict. Lower-confidence fallbacks (css, xpath) should kick in — check the run detail view for which locator strategy succeeded.
3. **Iframe context.** If the target moved into (or out of) an iframe, `framePath` no longer matches. Re-record.

### "Database is locked" errors

Another RoutineFlow process is holding a write. Check for zombie runners:

```sh
ps aux | grep routineflow
```

If nothing is running, the DB's WAL file is stuck. Fix:

```sh
sqlite3 ~/.routineflow/app.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

## Native Host / Bridge

### `cli.js --diagnose` fails

The diagnose output prints the failing check with a reason. Quick reference:

| Check | Typical fix |
|---|---|
| Host manifest location | `pnpm install:bridge -- --extension-id <id>` |
| Allowed origins | Extension ID in manifest doesn't match installed extension — re-register |
| Executable path | `chmod +x apps/bridge-host/install/launcher.sh` |
| JSON message framing | Rebuild the bridge: `corepack pnpm --filter @routineflow/bridge-host build` |
| Round-trip messaging | Runner not available; start it with `pnpm --filter @routineflow/runner start` |

### Bridge silently exits

Check `~/.routineflow/logs/bridge-host.log`. Common errors:

- `parse error` — a request didn't match the Zod schema. The sender (the extension) is out of date.
- `unknown command` — protocol mismatch. Upgrade the extension.
- `runner_unreachable` after auto-spawn — the runner's dependencies are broken. Run `pnpm diagnose`.

## Database

### `pnpm db:restore` failed; my data is gone

It isn't. Before overwriting, the restore script copies the current database to `app.db.pre-restore`. Restore it:

```sh
cp ~/.routineflow/app.db.pre-restore ~/.routineflow/app.db
```

### Database schema is out of date after upgrade

Migrations run automatically on runner startup. If you see schema errors:

1. Stop the runner
2. `pnpm db:backup` (always)
3. Restart the runner; check its startup log for migration progress
4. If a migration failed, the backup preserves your data — open an issue with the migration error

## Tests

### `pnpm test:e2e` fails with `browserType.launch: Host system is missing dependencies`

On Linux, Playwright needs system libraries:

```sh
corepack pnpm exec playwright install-deps chromium
```

### Vitest complains `Cannot find module 'better-sqlite3'`

As above — we don't use `better-sqlite3`. Remove the line from whatever `package.json` introduced it. The actual SQLite binding is Node's built-in `node:sqlite`.

## Still Stuck?

Collect diagnostics and open an issue:

```sh
pnpm diagnose > /tmp/routineflow-diag.txt
```

Include:

- Output of `pnpm diagnose`
- Contents of `~/.routineflow/logs/bridge-host.log` (redact URLs as needed)
- The last run's detail from `curl -s http://127.0.0.1:3100/runs/<runId>`
- Your OS and Chrome version
