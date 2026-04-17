#!/usr/bin/env node

/**
 * Package the release artifacts.
 *
 * Produces under release/:
 *   - routineflow-extension-<version>.zip  (Chrome Web Store submission)
 *   - routineflow-runner-<version>.tgz     (Fastify runner bundle)
 *   - routineflow-bridge-<version>.tgz     (native host + installer)
 *   - SHA256SUMS.txt
 *
 * Requires `corepack pnpm release:build` to have run first.
 *
 * Usage: node scripts/package-release.mjs
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const RELEASE_DIR = resolve(REPO_ROOT, 'release');

const extensionPackage = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'apps/extension/package.json'), 'utf-8')
);
const version = extensionPackage.version;

if (!version) {
  console.error('Could not determine version from apps/extension/package.json');
  process.exit(1);
}

console.log(`\n  RoutineFlow Release Packaging — v${version}\n`);

// Ensure dist/ exists for each app
const required = [
  'apps/extension/dist',
  'apps/runner/dist',
  'apps/bridge-host/dist'
];
for (const dir of required) {
  if (!existsSync(resolve(REPO_ROOT, dir))) {
    console.error(`  Missing: ${dir}. Run \`corepack pnpm release:build\` first.`);
    process.exit(1);
  }
}

// Recreate release directory
if (existsSync(RELEASE_DIR)) {
  rmSync(RELEASE_DIR, { recursive: true });
}
mkdirSync(RELEASE_DIR, { recursive: true });

const artifacts = [];

// 1. Extension zip (for Chrome Web Store)
const extensionZip = resolve(RELEASE_DIR, `routineflow-extension-${version}.zip`);
console.log(`  Packaging extension → ${relative(REPO_ROOT, extensionZip)}`);
if (process.platform === 'win32') {
  execFileSync(
    'powershell',
    [
      '-Command',
      `Compress-Archive -Path 'apps/extension/dist/*' -DestinationPath '${extensionZip}' -Force`
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' }
  );
} else {
  execFileSync(
    'zip',
    ['-qr', extensionZip, '.'],
    { cwd: resolve(REPO_ROOT, 'apps/extension/dist'), stdio: 'inherit' }
  );
}
artifacts.push(extensionZip);

// 2. Runner tarball
const runnerTgz = resolve(RELEASE_DIR, `routineflow-runner-${version}.tgz`);
console.log(`  Packaging runner   → ${relative(REPO_ROOT, runnerTgz)}`);
execFileSync(
  'tar',
  [
    '-czf', runnerTgz,
    '-C', REPO_ROOT,
    'apps/runner/dist',
    'apps/runner/package.json'
  ],
  { stdio: 'inherit' }
);
artifacts.push(runnerTgz);

// 3. Bridge host tarball
const bridgeTgz = resolve(RELEASE_DIR, `routineflow-bridge-${version}.tgz`);
console.log(`  Packaging bridge   → ${relative(REPO_ROOT, bridgeTgz)}`);
execFileSync(
  'tar',
  [
    '-czf', bridgeTgz,
    '-C', REPO_ROOT,
    'apps/bridge-host/dist',
    'apps/bridge-host/package.json',
    'apps/bridge-host/install'
  ],
  { stdio: 'inherit' }
);
artifacts.push(bridgeTgz);

// 4. SHA-256 checksums
console.log('\n  Computing SHA-256 checksums...');
const checksumLines = [];
for (const artifact of artifacts) {
  const hash = await sha256(artifact);
  const size = statSync(artifact).size;
  const rel = relative(RELEASE_DIR, artifact);
  checksumLines.push(`${hash}  ${rel}`);
  console.log(`  ${hash.slice(0, 16)}…  ${rel}  (${formatBytes(size)})`);
}

writeFileSync(resolve(RELEASE_DIR, 'SHA256SUMS.txt'), checksumLines.join('\n') + '\n');

// 5. Release manifest JSON
const manifest = {
  version,
  builtAt: new Date().toISOString(),
  node: process.version,
  artifacts: artifacts.map((p) => ({
    name: relative(RELEASE_DIR, p),
    size: statSync(p).size
  }))
};
writeFileSync(resolve(RELEASE_DIR, 'release.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`
  Release artifacts written to: ${relative(REPO_ROOT, RELEASE_DIR)}/

  Next steps:
  1. Upload release/routineflow-extension-${version}.zip to the Chrome Web Store.
  2. Tag the commit: git tag v${version} && git push origin v${version}
  3. Attach release/* to the GitHub release.

  See RELEASE.md for the full checklist.
`);

async function sha256(path) {
  const hash = createHash('sha256');
  await new Promise((res, rej) => {
    createReadStream(path).on('data', (c) => hash.update(c)).on('end', res).on('error', rej);
  });
  return hash.digest('hex');
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
