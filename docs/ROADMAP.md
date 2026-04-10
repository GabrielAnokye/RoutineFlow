# RoutineFlow Roadmap

## Delivery Strategy

Build RoutineFlow in vertical slices that establish contracts early:

1. Shared schema and contracts first.
2. Recording shell second.
3. Compiler and runner execution third.
4. Debug and repair flows before broad feature expansion.
5. Scheduling and release hardening last.

This sequence reduces rework and keeps the core product centered on reliability.

## Milestone 0: Repo Foundation

### Goal

Create the monorepo scaffold and baseline engineering standards without building full product behavior.

### Deliverables

- `pnpm` workspace root
- TypeScript project references or equivalent workspace configuration
- root lint, build, and test commands
- app/package folder skeleton matching the architecture docs, including `apps/native-host`
- baseline CI configuration
- `.gitignore` covering runtime data and auth state

### Acceptance Criteria

- `pnpm install` succeeds on a clean machine.
- `pnpm build` succeeds for the scaffolded workspace.
- `pnpm lint` and `pnpm test` succeed.
- No runtime data paths point inside the repo.

## Milestone 1: Shared Contracts and Persistence Core

### Goal

Define the canonical workflow schema, bridge envelopes, logging contract, and SQLite persistence primitives.

### Deliverables

- `workflow-schema` package with Zod schemas and JSON fixtures
- `bridge-contract` package for extension/runner messages
- `logging` package with Pino configuration
- runner persistence layer with SQLite schema migrations

### Acceptance Criteria

- Exported workflow JSON validates with Zod.
- Schema version `1` is documented and tested.
- SQLite migrations create the required baseline tables.
- Import of malformed workflow JSON fails with structured errors and no partial writes.
- Every non-trivial module in this milestone has Vitest coverage.

## Milestone 2: Extension Shell and Recording

### Goal

Build the Chrome extension shell and a usable recording pipeline.

### Deliverables

- MV3 manifest
- side panel React app
- service worker orchestration
- active-tab recording flow
- content-script event capture and redaction
- native messaging bridge handshake

### Acceptance Criteria

- User can start and stop a recording from the side panel.
- Recorder captures navigation, click, input, and tab events on supported pages.
- Password input values are redacted before persistence.
- Extension permissions are limited to the documented minimum set.
- Native bridge health check succeeds reliably after Chrome restart.

## Milestone 3: Compiler and Manual Replay

### Goal

Transform recordings into durable workflows and execute them on demand.

### Deliverables

- compiler package
- selector engine package
- runner playback engine with Playwright
- named profile creation and selection
- run history persistence

### Acceptance Criteria

- A recorded morning browser setup can be compiled into a workflow revision.
- Manual replay succeeds on at least the primary user story flow.
- Runner stores step-level results, logs, screenshots, and traces for each run.
- Locator selection prefers semantic targets and records fallback usage.
- Authenticated replay works without storing plaintext passwords.

## Milestone 4: Debug and Repair

### Goal

Make failures actionable and repairable without full re-recording.

### Deliverables

- run detail UI
- failure taxonomy implementation
- step editor and selector repair UI
- workflow revision history

### Acceptance Criteria

- Failed runs show normalized failure code, failing step, URL, logs, screenshot, and trace.
- User can edit a broken selector or step parameter and save a new revision.
- Prior revisions remain accessible after repair.
- At least one intentional selector-break scenario is recoverable through the repair flow.

## Milestone 5: Scheduling and Operational Hardening

### Goal

Support dependable daily runs and improve product resilience.

### Deliverables

- daily schedule UI and runner-side scheduler
- schedule restoration on runner startup
- artifact retention controls
- stronger bridge retry and health behavior

### Acceptance Criteria

- User can schedule the primary workflow to run daily in local time.
- Schedules resume correctly after Chrome restart and runner restart.
- Missed or failed scheduled runs are visible in history.
- Artifact retention deletes expired local artifacts without corrupting run history.

## Milestone 6: v1.0 Release Candidate

### Goal

Ship a local-first single-user product with reliable record, replay, debug, and repair loops.

### Deliverables

- release packaging for extension and local runner
- installation documentation
- import/export workflow support
- end-to-end test coverage for the primary user story
- release checklist and manual QA checklist

### Acceptance Criteria

- A user can record a morning browser setup once and replay it daily on the same machine.
- Workflow import/export preserves behavior and schema compatibility at `schemaVersion: 1`.
- No plaintext passwords appear in workflow JSON, logs, or persisted recordings.
- The extension contains no remote-hosted executable code.
- `pnpm build`, `pnpm lint`, `pnpm test`, and `pnpm test:e2e` pass in the release candidate environment.

## Release Criteria for v1.0

RoutineFlow v1.0 is ready only when all of the following are true:

- Local-first single-user workflows work without any cloud service dependency.
- Extension, runner, and bridge contracts are versioned and validated.
- The primary user story is stable under manual and scheduled execution.
- Failure diagnostics include logs, screenshots, traces, and categorized errors.
- Repair UI allows recovery from common locator drift without re-recording the full workflow.
- Auth reuse is implemented through stored session state, not stored passwords.
- Runtime data, profiles, and artifacts live outside the repo and are excluded from export by default.
- Core modules have automated tests and end-to-end coverage for the happy path and at least one failure-repair path.

## Definition of Done for Future Implementation Tasks

Every implementation task after scaffolding should meet this bar:

- code compiles
- task-specific tests pass
- no obvious dead code remains
- public types are documented
- run, build, lint, and test commands are included in the task handoff
