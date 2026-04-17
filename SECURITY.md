# RoutineFlow Security Model

This document describes RoutineFlow's security posture, threat model, and hardening practices.

## Threat Model

RoutineFlow is a local-first tool that automates browser interactions. Its attack surface is bounded by the user's machine: no network endpoints are exposed to the public internet, no shared cloud state exists, and no multi-tenant boundaries need defending.

The threats we care about, roughly ordered:

1. **Credential leakage in workflow artifacts** — a recording captures a password, token, or session cookie that then gets stored on disk, shared in a diagnostics bundle, or embedded in a compiled workflow
2. **Auth profile exfiltration** — another local process reads the profile directory and impersonates the user against an authenticated site
3. **Malicious or compromised websites** interacting with the recorder or a running workflow
4. **Tampering with the native messaging channel** — another local process pretending to be Chrome and driving the runner
5. **Stale secrets in logs** shared for debugging

Threats explicitly **out of scope** for v1:

- Remote network attackers (the runner binds to `127.0.0.1` only and exposes nothing externally)
- Attackers with root / administrator access on the user's machine (they can read anything anyway)
- Multi-user shared machines (v1 assumes one user per OS account)

## Controls

### Credential redaction at recording time

The recorder drops values for any field that matches sensitive heuristics before the event is ever persisted. See [PRIVACY.md](./PRIVACY.md) for the full rule set. The compiler then **omits** the `type` step, so the compiled workflow cannot contain the redacted secret even if someone later inspects `app.db`.

Code: `apps/extension/src/recorder/redact.ts`, `packages/compiler/src/index.ts`.

### Log redaction before persistence

Structured logs are scrubbed via `redactString` and `redactObject` from `@routineflow/shared-types` before being written. Patterns matched:

- Bearer tokens (`Authorization: Bearer <value>`)
- Generic API keys (`api[-_]?key`, `x-api-key`, `token`)
- Credentials flagged in request bodies
- Values of keys matching `/pass|secret|token|cvv|ssn/i`

Diagnostics exports run through the same redaction pipeline.

### Auth profile isolation

- Profiles live under `~/.routineflow/profiles/` with mode `0700` (owner-only on POSIX)
- Each profile is a Playwright persistent context — **never** the user's default Chrome profile (explicitly forbidden by the auth model)
- Profiles are never included in diagnostics exports
- Profiles do not sync or upload anywhere

Full-disk encryption remains the only mitigation against filesystem-level credential theft. This is documented in [PRIVACY.md](./PRIVACY.md) so users can make an informed decision.

### Native messaging bridge

The extension and runner communicate over Chrome's native messaging channel, not HTTP. Properties:

- Chrome spawns the host process with its own stdio — no TCP port is exposed
- The host manifest's `allowed_origins` field lists the exact extension ID; Chrome will refuse connections from any other extension
- Messages are Zod-validated on both sides; malformed frames are rejected with a `bad_request` error
- Each command carries a correlation `id`; responses and streamed events echo the id so mismatched or injected frames are trivially detectable
- Request size is capped at 1 MB (Chrome's limit); oversized frames are rejected

### Content-script isolation

The recorder's page-side script runs in Chrome's isolated world. It does not expose any global, does not eval page strings, and never reads page JavaScript state via `postMessage`. All DOM reads go through standard APIs.

### No eval, no remote code

The extension and runner contain no `eval`, no `new Function`, and no dynamic code loading from the network. All JavaScript is bundled at build time.

### Restricted pages

Chrome prevents extensions from attaching to `chrome://`, `chrome-extension://`, and the Web Store. The recorder detects these cases and surfaces a clear error in the side panel instead of failing silently.

### Database durability

- SQLite is opened in WAL mode; writes survive crashes
- `pnpm db:backup` produces consistent snapshots
- Before `pnpm db:restore` overwrites the active database, the current file is saved as `app.db.pre-restore`

## Supply Chain

- All dependencies are pinned in `pnpm-lock.yaml`
- Dependency tree is kept minimal; see `pnpm why <pkg>` to justify any runtime dep
- Playwright is a runtime dependency only for the runner; the extension bundle contains no server-side code
- No CDN-hosted scripts; the extension bundle is fully offline-capable
- `pnpm audit` is part of CI — see `.github/workflows/ci.yml`

## Reporting a Vulnerability

RoutineFlow is a local-first single-user tool, so the blast radius of any individual vulnerability is bounded to the reporter's own machine. Nonetheless:

- If you find a vulnerability that could exfiltrate credentials, allow another local process to impersonate the user against a site, or break out of the extension sandbox, file an issue titled `SECURITY: <short description>` at https://github.com/anthropics/claude-code/issues
- Please include a reproduction, the affected version, and the expected fix if you have one
- We do not currently offer a bug bounty

## Security Checklist for Contributors

Before submitting a PR, confirm:

- [ ] No new `<script src="...">` tags pointing to remote origins
- [ ] No new runtime dependencies without a justification in the PR description
- [ ] No `eval`, `Function`, `setTimeout(string, ...)`, or dynamic `import()` of remote paths
- [ ] New log statements route through the redacted logger (`createLogger` / `childLogger`)
- [ ] New user-input boundaries validate with Zod
- [ ] New file writes respect `~/.routineflow/` scope — no writes outside the user's data directory
- [ ] New permissions in `manifest.json` are justified in [PERMISSIONS.md](./PERMISSIONS.md)
