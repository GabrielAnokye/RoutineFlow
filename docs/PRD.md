# RoutineFlow PRD

## Summary

RoutineFlow is a local-first browser automation product for a single user who wants to record a repeatable browser routine once, save it as a durable workflow, and replay it on demand or on a schedule. Version 1 is Chrome-first and runs entirely on the user's machine using a Chrome extension, a local runner, and local storage.

## Problem Statement

People repeat the same browser setup work every morning: opening tabs, navigating to dashboards, dismissing popups, clicking through menus, applying filters, and restoring a working context. This work is repetitive, error-prone, and fragile when done manually. Existing browser automation tools are either too developer-centric, too cloud-dependent, too brittle, or too broad for a local-first single-user workflow product.

RoutineFlow solves this by capturing browser activity, compiling it into resilient intent-based steps, replaying it reliably with stored authenticated browser state, and providing enough logs, traces, screenshots, and repair tools to keep workflows usable when websites change.

## Target Users

- Individual operators, analysts, recruiters, founders, support staff, and knowledge workers with repeatable browser routines.
- Technical and semi-technical users who can install a Chrome extension and a local helper service but do not want to author Playwright code.
- Users who care about privacy and want automation to stay on-device without cloud execution.

## Primary User Story

As a user, I want to record a morning browser setup once and replay it daily so that my dashboards, tools, and browser tabs are ready without manual setup work.

## Product Principles

- Local-first by default.
- Reliable replay is more important than high-fidelity raw event playback.
- Debuggability beats invisible magic.
- Semantic locators come before coordinates.
- Minimal extension permissions.
- No plaintext password storage.
- No paid services or cloud dependency in v1.
- Backward compatibility for saved workflow JSON whenever possible.

## MVP Scope

### In Scope

- Record browser routines in Chrome.
- Capture raw browser and DOM interaction data for debugging.
- Compile recordings into durable workflow steps.
- Save workflows locally in SQLite and export/import them as JSON.
- Replay workflows on demand through a local Playwright runner.
- Reuse saved authenticated browser profiles without storing passwords.
- Schedule daily runs locally.
- Show run history, step-level results, logs, screenshots, and traces.
- Provide a repair flow for broken selectors and step edits.

### Explicit Non-Goals

- Multi-user support.
- Cloud sync, cloud execution, or hosted APIs.
- Shared/team workflows and permissions.
- Desktop automation outside the browser.
- Visual-only automation, OCR-first targeting, or computer-use agents.
- Automatic credential capture or password vault functionality.
- Marketplace, templates marketplace, or public workflow sharing.
- Cross-browser parity beyond Chrome in v1.
- Remote-hosted executable code inside the extension.

## User Experience Scope

### Core Workflow Lifecycle

1. Record: the extension starts a recording session on the active tab and captures browser events, DOM context, URLs, timing, and element snapshots.
2. Compile: the local compiler converts raw events into durable steps such as `newTab`, `goto`, `click`, `type`, `select`, `waitFor`, `assert`, and `closeTab`.
3. Save: the compiled workflow, metadata, raw recording summary, and locator strategies are persisted locally.
4. Replay: the user runs the workflow manually or via a schedule; the local runner executes it with Playwright using a selected auth profile.
5. Debug: if a run fails, the user sees the failing step, run logs, Playwright trace, screenshots, and normalized error classification.
6. Repair: the user edits the broken step or updates the selector/profile, saves a new workflow revision, and reruns.

## Functional Requirements

### Recording

- Start and stop recording from the Chrome side panel.
- Capture tab lifecycle, navigation events, clicks, form input, key actions that affect intent, frame context, and timestamps.
- Detect sensitive fields and redact passwords and other secret-like values from stored recordings.
- Associate captured actions with DOM-derived semantic locator candidates and coordinate fallbacks.

### Compilation

- Normalize noisy raw events into a compact workflow DSL.
- Prefer direct navigation over replaying indirect steps when the destination is known and behaviorally equivalent.
- Merge redundant waits and navigation noise.
- Preserve enough raw context to explain why a compiled step exists.

### Replay

- Execute workflows through Playwright in a dedicated controlled browser context.
- Use semantic locators first and coordinate fallbacks last.
- Auto-wait for actionable elements and page readiness.
- Attach traces, screenshots, and structured logs to each run.

### Profiles and Auth

- Allow the user to create a reusable authenticated profile by signing in through a dedicated Playwright-managed profile.
- Never store plaintext passwords.
- Keep auth state local and outside the repo.
- Permit multiple named saved profiles in v1, but keep the product single-user.

### Scheduling

- Support daily scheduled runs in local time.
- Rehydrate schedules when Chrome or the local runner restarts.
- Show next scheduled run and last run status.

### Debug and Repair

- Display run history with status, duration, failing step, and artifact links.
- Support editing selectors, waits, and step parameters without re-recording the entire workflow.
- Keep workflow revision history.

## Non-Functional Requirements

- Single-user, local-only operation.
- No hard dependency on internet services other than the websites the user automates.
- Structured logging with Pino across extension bridge and runner.
- Test coverage for all non-trivial modules.
- Deterministic schema validation with Zod at system boundaries.
- Startup and replay behavior optimized for reliability, not raw speed.
- Failures classified into actionable categories for debug and repair.

## High-Level Data Model

### Core Entities

- `Workflow`: stable logical workflow identity, display name, enabled flag, default profile, current revision pointer.
- `WorkflowRevision`: immutable saved version containing compiled steps, schema version, source recording summary, and metadata.
- `RecordingSession`: one capture session with raw event summaries and compilation diagnostics.
- `WorkflowStep`: typed compiled step with primary locator, fallback locators, optional assertions, and timeout policy.
- `Profile`: named authenticated browser state and metadata for reuse during replay.
- `Schedule`: local schedule configuration attached to a workflow.
- `Run`: one execution attempt with start/end times, status, error code, and artifact pointers.
- `StepResult`: per-step outcome with timing, selected locator, retry count, and failure details.
- `Artifact`: screenshot, trace, log segment, DOM snapshot, or raw recording blob stored on disk and indexed in SQLite.

## Workflow JSON Versioning

- Every exported workflow JSON includes `schemaVersion`, `workflowVersion`, `createdAt`, and `updatedAt`.
- `schemaVersion` is an integer owned by the workflow-schema package and starts at `1`.
- `workflowVersion` increments on every save of a workflow revision.
- Backward-compatible additions must be additive and optional.
- Breaking changes require an explicit migration path from prior schema versions.
- Imports must validate, migrate to the latest schema, and preserve the original imported payload for diagnostics.

## Success Criteria for v1.0

- A user can record a morning browser setup once and replay it daily on the same machine without editing code.
- The extension records enough information to compile a durable workflow and explain failures.
- The runner reuses saved authenticated state without capturing plaintext passwords.
- Scheduled runs survive browser restarts through runner-side schedule restoration.
- Failures expose a normalized error type, step context, logs, screenshots, and a trace.
- Users can repair a broken workflow by editing steps/selectors and saving a new revision.
- The product works without cloud infrastructure and without remote executable code in the extension.

## Planned Workspace Commands

These commands are part of the implementation contract for the upcoming scaffold phase:

- `pnpm install`
- `pnpm dev`
- `pnpm build`
- `pnpm lint`
- `pnpm test`
- `pnpm test:e2e`
