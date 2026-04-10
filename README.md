# RoutineFlow

RoutineFlow is a local-first browser automation product scaffold for a Chrome MV3 extension, a Fastify-based local runner, and shared TypeScript packages.

## Workspace Layout

```text
apps/
  extension/
  runner/
packages/
  compiler/
  db/
  logger/
  shared-types/
  ui/
docs/
tests/
```

## Prerequisites

- Node.js 22 or newer
- Corepack
- Google Chrome for loading the extension during development

## Setup

1. Enable Corepack and activate the pinned `pnpm` version:

   ```sh
   corepack enable
   corepack prepare pnpm@9.0.0 --activate
   ```

2. Install dependencies:

   ```sh
   corepack pnpm install
   ```

3. Copy the example environment file if you want to customize defaults:

   ```sh
   cp .env.example .env
   ```

## Root Commands

- `pnpm dev`: builds shared packages, watches the extension scaffold into `apps/extension/dist`, and runs the local runner with `tsx`.
- `pnpm build`: builds all packages and apps.
- `pnpm test`: runs Vitest across apps and packages.
- `pnpm test:e2e`: starts the runner and verifies its health endpoint with Playwright Test.
- `pnpm lint`: runs ESLint across the workspace.
- `pnpm typecheck`: runs TypeScript project-reference builds for all referenced projects.
- `pnpm clean`: removes generated build and test output.

## Extension Development

`pnpm dev` keeps `apps/extension/dist` updated so the extension can be loaded unpacked from Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select `apps/extension/dist`.

Reload the extension after build output changes. The scaffold includes:

- a React side panel page
- an MV3 service worker
- programmatic content-script injection via `chrome.scripting`

## Runner Development

The local runner listens on `RUNNER_HOST:RUNNER_PORT` and exposes:

- `GET /health`
- `GET /config`

## Verification

Run the full scaffold verification from the repository root:

```sh
corepack pnpm install
corepack pnpm build
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm test:e2e
```
