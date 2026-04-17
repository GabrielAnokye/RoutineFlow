#!/usr/bin/env node

/**
 * Diagnose local RoutineFlow installation.
 * Checks: runtime paths, database, native host manifest, extension dist, permissions.
 *
 * Usage: node scripts/diagnose.mjs
 */

import { existsSync, accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const HOME = homedir();
const BASE_DIR = join(HOME, '.routineflow');
const DB_FILE = join(BASE_DIR, 'app.db');
const EXTENSION_DIST = resolve('apps/extension/dist');
const RUNNER_DIST = resolve('apps/runner/dist/index.js');
const BRIDGE_DIST = resolve('apps/bridge-host/dist/index.js');

const NATIVE_HOST_PATHS = {
  darwin: join(HOME, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.routineflow.bridge.json'),
  linux: join(HOME, '.config/google-chrome/NativeMessagingHosts/com.routineflow.bridge.json'),
  win32: join(process.env.LOCALAPPDATA ?? '', 'RoutineFlow/com.routineflow.bridge.json')
};

const checks = [];

function check(name, fn) {
  try {
    const result = fn();
    checks.push({ name, status: result ? 'pass' : 'fail', detail: result || 'Not found' });
  } catch (err) {
    checks.push({ name, status: 'fail', detail: err.message });
  }
}

// Runtime directories
check('Runtime base directory', () => existsSync(BASE_DIR) && BASE_DIR);
check('Database file', () => {
  if (!existsSync(DB_FILE)) return false;
  const stat = statSync(DB_FILE);
  return `${DB_FILE} (${(stat.size / 1024).toFixed(1)}KB)`;
});
check('Artifacts directory', () => existsSync(join(BASE_DIR, 'artifacts')) && join(BASE_DIR, 'artifacts'));
check('Profiles directory', () => existsSync(join(BASE_DIR, 'profiles')) && join(BASE_DIR, 'profiles'));

// Build artifacts
check('Extension dist', () => existsSync(join(EXTENSION_DIST, 'manifest.json')) && EXTENSION_DIST);
check('Runner dist', () => existsSync(RUNNER_DIST) && RUNNER_DIST);
check('Bridge host dist', () => existsSync(BRIDGE_DIST) && BRIDGE_DIST);

// Native messaging host
const hostPath = NATIVE_HOST_PATHS[process.platform];
check('Native host manifest', () => {
  if (!hostPath) return `Unsupported platform: ${process.platform}`;
  if (!existsSync(hostPath)) return false;
  return hostPath;
});

// Launcher permissions
check('Bridge launcher executable', () => {
  const ext = process.platform === 'win32' ? 'launcher.cmd' : 'launcher.sh';
  const launcher = resolve('apps/bridge-host/install', ext);
  if (!existsSync(launcher)) return false;
  if (process.platform !== 'win32') {
    try {
      accessSync(launcher, constants.X_OK);
    } catch {
      return `${launcher} (not executable)`;
    }
  }
  return launcher;
});

// Auth profiles — check for sensitive files
check('Auth profile security', () => {
  const profilesDir = join(BASE_DIR, 'profiles');
  if (!existsSync(profilesDir)) return 'No profiles directory';
  if (process.platform !== 'win32') {
    const stat = statSync(profilesDir);
    const mode = (stat.mode & 0o777).toString(8);
    if (mode !== '700') return `${profilesDir} has mode ${mode} (should be 700)`;
  }
  return 'OK';
});

// Print results
console.log('\n  RoutineFlow Local Diagnostics\n');
console.log('  ' + '-'.repeat(60));

let passCount = 0;
let failCount = 0;

for (const c of checks) {
  const icon = c.status === 'pass' ? '\x1b[32m PASS \x1b[0m' : '\x1b[31m FAIL \x1b[0m';
  console.log(`  ${icon} ${c.name}`);
  if (c.detail && c.detail !== true) {
    console.log(`         ${c.detail}`);
  }
  if (c.status === 'pass') passCount++;
  else failCount++;
}

console.log('\n  ' + '-'.repeat(60));
console.log(`  ${passCount} passed, ${failCount} failed\n`);

if (failCount > 0) {
  console.log('  Run "pnpm local:install" to set up missing components.');
  console.log('  See INSTALL.md for detailed instructions.\n');
}

process.exit(failCount > 0 ? 1 : 0);
