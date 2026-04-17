# RoutineFlow Release Guide

This document covers cutting a new version of RoutineFlow, packaging artifacts, and distributing them.

## Release Artifacts

A full release produces:

| Artifact | Purpose | Location |
|---|---|---|
| `routineflow-extension-<version>.zip` | Chrome Web Store submission (packed) | `release/` |
| `apps/extension/dist/` | Developer-loadable unpacked extension | workspace |
| `apps/runner/dist/` | Compiled runner (`node dist/index.js`) | workspace |
| `apps/bridge-host/dist/` | Compiled native host + CLI | workspace |
| `release/SHA256SUMS.txt` | Artifact checksums | `release/` |

## Versioning

RoutineFlow follows semantic versioning. Bump versions in all workspace packages simultaneously — the monorepo is released as a unit.

```sh
corepack pnpm -r exec -- npm version <patch|minor|major> --no-git-tag-version
git add -A && git commit -m "chore: release v<version>"
git tag v<version>
```

## Release Build

```sh
corepack pnpm release:build
```

This runs `clean` followed by `build` across the workspace. To also run the full test matrix including e2e:

```sh
corepack pnpm release:verify
```

## Packaging

```sh
node scripts/package-release.mjs
```

This produces:

- `release/routineflow-extension-<version>.zip` — packed extension
- `release/routineflow-runner-<version>.tgz` — runner bundle + package.json
- `release/routineflow-bridge-<version>.tgz` — bridge host bundle + installer
- `release/SHA256SUMS.txt` — SHA-256 checksums for all artifacts

The script fails if any `dist/` directory is missing — run `release:build` first.

## Chrome Web Store Submission

1. Sign into the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole).
2. Click **New item**, upload `release/routineflow-extension-<version>.zip`.
3. Fill in listing metadata (described below).
4. Submit for review.

### Required listing fields

- **Title:** `RoutineFlow — Local Browser Automation`
- **Summary (≤132 chars):** `Record, replay, and schedule browser routines on your machine. No cloud, no account — your data stays local.`
- **Category:** Productivity
- **Icons:** 128×128 PNG (see `apps/extension/public/icons/` — not yet provided; ship without icons for initial developer release)
- **Screenshots:** 1280×800 of the side panel in recording, run-detail, and schedules views
- **Privacy policy URL:** link to `PRIVACY.md` hosted on a public page
- **Permissions justification:** see [PERMISSIONS.md](./PERMISSIONS.md) — copy the "Justification" column into each permission's justification field

### Known review considerations

- `<all_urls>` host permission: required so the content-script recorder can attach to any page the user opens while recording. Justification must cite this use case.
- `nativeMessaging` permission: required for the local runner bridge. Justification must cite that no remote server is ever contacted.
- `tabs` permission: required to follow tab spawns during a recording session.

## Runner and Bridge Distribution

The runner and bridge host are **not** published to npm. They ship as tarballs that the installer extracts into the user's workspace.

Developer-only distribution for v1:

```sh
# On the developer's machine
corepack pnpm release:build
node scripts/package-release.mjs
# Share release/ with the target user, who runs:
tar xzf routineflow-runner-<version>.tgz
tar xzf routineflow-bridge-<version>.tgz
# then follows INSTALL.md from step 4 (native host registration)
```

## Post-Release Checklist

After a release is tagged and uploaded:

- [ ] `git push origin main --tags`
- [ ] Attach `release/*` artifacts to the GitHub release
- [ ] Update [CHANGELOG.md](./CHANGELOG.md) with the shipped version
- [ ] Confirm Chrome Web Store listing matches the tagged version
- [ ] Run `pnpm diagnose` on a fresh clone to verify the install flow still works
- [ ] Close any GitHub issues resolved in the release

## Rollback

Because the runner and database run on the user's machine, rollback is per-user:

1. Downgrade the runner: `tar xzf routineflow-runner-<previous>.tgz` over the install
2. Restore the database: `pnpm db:restore -- ~/.routineflow/backups/app-<timestamp>.db`
3. Re-register the bridge if its protocol version changed: `pnpm install:bridge -- --extension-id <id>`
4. Reload the extension

See [INSTALL.md](./INSTALL.md) for the database backup format.

## Protocol Compatibility

The native messaging protocol has a `PROTOCOL_VERSION` constant in `packages/bridge-protocol/src/index.ts`. Any breaking change requires bumping the major version and emitting a `version_mismatch` error for older clients.

Compatibility matrix:

| Extension | Bridge host | Runner | Status |
|---|---|---|---|
| v1.x | v1.x | v1.x | ✓ |
| v1.x | v1.y (y>x) | v1.y | ✓ (host is backwards-compat) |
| v1.x | v2.x | v2.x | ✗ `version_mismatch` — extension must upgrade |
