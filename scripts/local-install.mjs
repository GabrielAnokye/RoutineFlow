#!/usr/bin/env node

/**
 * One-command local development install.
 *
 * Performs:
 * 1. pnpm install
 * 2. pnpm build
 * 3. Create runtime directories (~/.routineflow/)
 * 4. Print next steps (load extension, register native host)
 *
 * Usage: node scripts/local-install.mjs
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const BASE_DIR = join(HOME, '.routineflow');

function run(cmd, label) {
  console.log(`\n=> ${label}`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
  } catch {
    console.error(`\nFailed: ${label}`);
    process.exit(1);
  }
}

console.log('\n  RoutineFlow Local Install\n');

// Step 1: Install dependencies
run('corepack pnpm install', 'Installing dependencies');

// Step 2: Build all packages
run('corepack pnpm build', 'Building all packages');

// Step 3: Create runtime directories
console.log('\n=> Creating runtime directories');
const dirs = [
  BASE_DIR,
  join(BASE_DIR, 'artifacts'),
  join(BASE_DIR, 'artifacts', 'recordings'),
  join(BASE_DIR, 'artifacts', 'screenshots'),
  join(BASE_DIR, 'artifacts', 'traces'),
  join(BASE_DIR, 'artifacts', 'logs'),
  join(BASE_DIR, 'profiles'),
  join(BASE_DIR, 'backups')
];
for (const d of dirs) {
  mkdirSync(d, { recursive: true });
}

// Secure the profiles directory
if (process.platform !== 'win32') {
  chmodSync(join(BASE_DIR, 'profiles'), 0o700);
}
console.log(`  Created: ${BASE_DIR}`);

// Step 4: Make bridge launcher executable
if (process.platform !== 'win32') {
  const launcher = join(process.cwd(), 'apps/bridge-host/install/launcher.sh');
  if (existsSync(launcher)) {
    chmodSync(launcher, 0o755);
    console.log('  Bridge launcher marked executable');
  }
}

// Print next steps
console.log(`
  ==========================================
  RoutineFlow installed successfully!
  ==========================================

  Next steps:

  1. Load the extension in Chrome:
     - Open chrome://extensions
     - Enable "Developer mode"
     - Click "Load unpacked"
     - Select: ${join(process.cwd(), 'apps/extension/dist')}

  2. Note the Extension ID from chrome://extensions

  3. Register the native messaging host:
     pnpm install:bridge -- --extension-id <YOUR_EXTENSION_ID>

  4. Start the development server:
     pnpm dev

  5. Verify the installation:
     pnpm diagnose

  For detailed instructions, see INSTALL.md.
`);
