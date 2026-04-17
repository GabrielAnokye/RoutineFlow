# RoutineFlow Installation Guide

## Prerequisites

- **Node.js** >= 22.0.0 (with Corepack enabled)
- **pnpm** >= 9.0.0
- **Google Chrome** (latest stable)
- **Git**

Enable Corepack if not already active:

```sh
corepack enable
```

## Quick Start (One Command)

```sh
node scripts/local-install.mjs
```

This installs dependencies, builds all packages, and creates runtime directories.

## Manual Setup

### 1. Clone and Install

```sh
git clone <repo-url> routineflow
cd routineflow
corepack pnpm install
```

### 2. Build

```sh
corepack pnpm build
```

### 3. Load the Extension

1. Open **chrome://extensions** in Google Chrome
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `apps/extension/dist/` directory
5. Note the **Extension ID** displayed on the card (e.g., `abcdefghijklmnopqrstuvwxyz`)
6. Pin the RoutineFlow icon in the Chrome toolbar

### 4. Register the Native Messaging Host

The native messaging host allows the extension to communicate with the local runner without HTTP.

```sh
pnpm install:bridge -- --extension-id <YOUR_EXTENSION_ID>
```

This places a manifest file in the OS-specific Chrome directory:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.routineflow.bridge.json` |
| Linux | `~/.config/google-chrome/NativeMessagingHosts/com.routineflow.bridge.json` |
| Windows | `%LOCALAPPDATA%\RoutineFlow\com.routineflow.bridge.json` |

### 5. Start the Runner

For development:

```sh
corepack pnpm dev
```

This starts the extension in watch mode and the runner on `http://127.0.0.1:3100`.

For production:

```sh
corepack pnpm --filter @routineflow/runner start
```

### 6. Verify

```sh
pnpm diagnose
```

This checks runtime paths, database, native host, and extension artifacts.

## Runtime Data

All data is stored under `~/.routineflow/`:

```
~/.routineflow/
  app.db              # SQLite database (workflows, runs, artifacts metadata)
  artifacts/
    recordings/       # Raw recording sessions
    screenshots/      # Step screenshots
    traces/           # Playwright trace archives
    logs/             # Structured log files
  profiles/           # Auth profile browser data (contains cookies — sensitive)
  backups/            # Database backups
```

## Creating an Auth Profile

Auth profiles store browser state (cookies, localStorage) for authenticated workflows.

1. Create a profile via the runner API:
   ```sh
   curl -X POST http://127.0.0.1:3100/auth-profiles \
     -H 'Content-Type: application/json' \
     -d '{"name": "Work account", "browserEngine": "chromium"}'
   ```

2. The profile directory is created at `~/.routineflow/profiles/<profile_id>/`

3. To populate it, manually copy a `storage-state.json` from a Playwright context, or use the interactive login flow (planned for v1.1).

## Recording a Workflow

1. Open the RoutineFlow side panel in Chrome
2. Click **New recording**
3. Navigate to your target page and perform actions
4. Click **Stop recording**
5. The workflow appears in the list

## Running a Workflow

1. In the side panel, click **Run** on any workflow
2. Click the run link to view step-by-step progress
3. View resolved locators, timing, and failure classification

## Scheduling a Workflow

1. Switch to the **Schedules** tab
2. Create a schedule for a workflow with:
   - Pattern: daily, weekdays, or specific days
   - Time: hour and minute (in your timezone)
3. The runner evaluates schedules on a polling interval

## Viewing Run Diagnostics

1. Open a run detail view
2. Click **Export diagnostics**
3. The JSON bundle includes:
   - Workflow definition
   - Run summary and step results
   - Error classification
   - Environment metadata
   - Artifact paths

Sensitive values are automatically redacted from the export.

## Database Backup and Restore

```sh
# Create a backup
pnpm db:backup

# Create a backup to a specific path
pnpm db:backup -- --output /path/to/backup.db

# Restore from a backup
pnpm db:restore -- /path/to/backup.db
```

The current database is saved as `app.db.pre-restore` before any restore.

## Uninstall

```sh
# Remove everything (prompts for data deletion)
node scripts/local-uninstall.mjs

# Remove build artifacts but keep data
node scripts/local-uninstall.mjs --keep-data

# Skip confirmation
node scripts/local-uninstall.mjs --yes
```

Also remove the extension from Chrome via **chrome://extensions**.
