#!/usr/bin/env node

/**
 * One-command local clean/uninstall flow.
 *
 * Removes:
 * 1. Native messaging host manifest
 * 2. Runtime directories (~/.routineflow/) — with confirmation
 * 3. Build artifacts (dist/)
 *
 * Usage: node scripts/local-uninstall.mjs [--keep-data] [--yes]
 */

import { existsSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const HOME = homedir();
const BASE_DIR = join(HOME, '.routineflow');
const args = process.argv.slice(2);
const keepData = args.includes('--keep-data');
const autoConfirm = args.includes('--yes');

const NATIVE_HOST_PATHS = {
  darwin: join(HOME, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.routineflow.bridge.json'),
  linux: join(HOME, '.config/google-chrome/NativeMessagingHosts/com.routineflow.bridge.json'),
  win32: join(process.env.LOCALAPPDATA ?? '', 'RoutineFlow/com.routineflow.bridge.json')
};

async function confirm(message) {
  if (autoConfirm) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

console.log('\n  RoutineFlow Uninstall\n');

// Step 1: Remove native host manifest
const hostPath = NATIVE_HOST_PATHS[process.platform];
if (hostPath && existsSync(hostPath)) {
  rmSync(hostPath);
  console.log(`  Removed native host manifest: ${hostPath}`);
} else {
  console.log('  Native host manifest: not found (already removed)');
}

// Step 2: Remove runtime data
if (!keepData && existsSync(BASE_DIR)) {
  const proceed = await confirm(`  Remove all data at ${BASE_DIR}?`);
  if (proceed) {
    rmSync(BASE_DIR, { recursive: true });
    console.log(`  Removed: ${BASE_DIR}`);
  } else {
    console.log('  Skipped data removal.');
  }
} else if (keepData) {
  console.log(`  Keeping data at: ${BASE_DIR}`);
} else {
  console.log('  No runtime data found.');
}

// Step 3: Clean build artifacts
const distDirs = [
  'apps/extension/dist',
  'apps/runner/dist',
  'apps/bridge-host/dist',
  'packages/shared-types/dist',
  'packages/compiler/dist',
  'packages/db/dist',
  'packages/logger/dist',
  'packages/ui/dist',
  'packages/bridge-protocol/dist'
];

let cleaned = 0;
for (const d of distDirs) {
  const full = resolve(d);
  if (existsSync(full)) {
    rmSync(full, { recursive: true });
    cleaned++;
  }
}
console.log(`  Cleaned ${cleaned} build artifact directories.`);

console.log(`
  Uninstall complete.

  To reinstall: pnpm local:install
  To remove from Chrome: open chrome://extensions and remove RoutineFlow.
`);
