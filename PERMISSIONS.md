# RoutineFlow Chrome Permissions

This document lists every permission declared in `manifest.json`, why it is needed, and what would break without it.

The manifest lives at `apps/extension/scripts/write-manifest.mjs` and is regenerated on every build.

## Runtime Permissions

### `activeTab`

**Purpose:** Grant temporary access to the current tab when the user interacts with the side panel.
**Needed for:** Fallback path when `tabs` permission is narrower than needed — specifically the "Inject here" diagnostic in the side panel.
**Without it:** The side panel would have no access to the current tab's content even when the user clicks a button there.

### `alarms`

**Purpose:** Schedule the service worker to wake periodically.
**Needed for:** Keeping the recorder's long-lived session alive across service worker idle cycles, and polling the runner's status.
**Without it:** Long recordings would silently drop after the service worker's 30-second idle timeout.

### `nativeMessaging`

**Purpose:** Communicate with the RoutineFlow bridge host process over stdio.
**Needed for:** Every call from the extension to the runner: saving recordings, starting runs, listing runs, polling status. This is the primary transport.
**Without it:** The extension cannot talk to the runner at all. There is no HTTP fallback in the extension (the runner's HTTP port exists only for Playwright e2e tests and curl-based diagnostics).

**Justification for store review:** The extension connects *only* to the `com.routineflow.bridge` host that the user installed locally. No remote messaging endpoint is contacted. The host manifest's `allowed_origins` is restricted to this extension's ID.

### `scripting`

**Purpose:** Programmatically inject the content-script recorder into tabs.
**Needed for:** Starting a recording session injects the recorder bundle via `chrome.scripting.executeScript` into the active tab (and any tabs the user opens during recording). Static content scripts can't be used because the recorder should only run during an active recording session.
**Without it:** Recording would be impossible.

### `sidePanel`

**Purpose:** Display the RoutineFlow UI in Chrome's side panel.
**Needed for:** The entire user-facing UI is a side panel.
**Without it:** The extension would have nowhere to render.

### `tabs`

**Purpose:** Enumerate and track tab lifecycle events during recording.
**Needed for:** When a recorded action opens a new tab (e.g., `<a target="_blank">` or `window.open`), the recorder must follow the spawn, inject itself into the new tab, and record the `tabOpened` event.
**Without it:** Multi-tab workflows could not be recorded.

## Host Permissions

### `<all_urls>`

**Purpose:** Allow the content-script recorder to attach to any page the user records on.
**Needed for:** The recorder has no way to know in advance which pages the user will automate. A restricted host pattern would require the user to list every site they automate, which defeats the point of a recorder.
**Without it:** The recorder would only work on an explicitly allowlisted set of sites.

**Justification for store review:** The extension does not read page content unless the user explicitly starts a recording. When a recording is active, page interactions are captured *locally* and sent to the user's local runner via native messaging — no remote server is contacted.

## Why no `webNavigation`?

Tab navigation during a recording is tracked through `tabs.onUpdated` events (covered by `tabs` permission) and in-page `history.pushState` / `popstate` listeners (no permission needed). `webNavigation` would duplicate this and its broad access is not necessary.

## Why no `webRequest` or `declarativeNetRequest`?

RoutineFlow never intercepts, blocks, or rewrites network traffic. Recordings capture DOM-level interactions; replays execute DOM-level actions. Network-level control is outside the product's scope.

## Why no `cookies`?

Authenticated workflows use Playwright's `storageState` (owned by the runner, not the extension) to carry cookies. The extension itself never reads or writes cookies via `chrome.cookies`.

## Permission Audit Procedure

Before each release, run:

```sh
node scripts/audit-manifest.mjs
```

This script enumerates declared permissions, cross-references them against code usage, and reports:

- Permissions declared but never called — candidates for removal
- `chrome.*` APIs called in source but not declared — missing permissions
- Host patterns declared but never matched — candidates for narrowing

See `scripts/audit-manifest.mjs` for the implementation.
