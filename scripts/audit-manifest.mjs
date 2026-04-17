#!/usr/bin/env node

/**
 * Audit the extension manifest against actual chrome.* API usage.
 *
 * Reports:
 *   - Permissions declared but never called (candidates for removal)
 *   - chrome.* APIs called in source but not declared (missing permissions)
 *
 * Usage: node scripts/audit-manifest.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const EXT_SRC = resolve(REPO_ROOT, 'apps/extension/src');
const EXT_SCRIPTS = resolve(REPO_ROOT, 'apps/extension/scripts');

// Run the manifest generator in memory by reading the generator source.
// (We can't import it directly because it writes to disk as a side effect.)
const manifestScript = readFileSync(resolve(EXT_SCRIPTS, 'write-manifest.mjs'), 'utf-8');
const permissionsMatch = manifestScript.match(/permissions:\s*\[([^\]]+)\]/);
if (!permissionsMatch) {
  console.error('Could not parse permissions from write-manifest.mjs');
  process.exit(1);
}
const declared = permissionsMatch[1]
  .split(',')
  .map((s) => s.trim().replace(/['"]/g, ''))
  .filter(Boolean);

// Map permissions to the chrome.* APIs they gate.
const PERMISSION_APIS = {
  activeTab: ['chrome.tabs'],
  alarms: ['chrome.alarms'],
  nativeMessaging: ['chrome.runtime.connectNative', 'chrome.runtime.sendNativeMessage'],
  scripting: ['chrome.scripting'],
  sidePanel: ['chrome.sidePanel'],
  storage: ['chrome.storage'],
  tabs: ['chrome.tabs']
};

// Walk extension source for chrome.* usage.
const usage = new Set();
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) {
      const src = readFileSync(full, 'utf-8');
      const matches = src.match(/chrome\.[a-zA-Z0-9_.]+/g);
      if (matches) for (const m of matches) usage.add(m);
    }
  }
}
walk(EXT_SRC);

// Cross-reference.
console.log('\n  Manifest Permission Audit\n');

const problems = [];

for (const perm of declared) {
  const apis = PERMISSION_APIS[perm] ?? [];
  const used = apis.some((api) => Array.from(usage).some((u) => u.startsWith(api)));
  if (apis.length === 0) {
    console.log(`  ${perm}: declared (no known API mapping — manual review)`);
  } else if (used) {
    console.log(`  ${perm}: used ✓`);
  } else {
    console.log(`  ${perm}: declared but no matching chrome.* call found`);
    problems.push(`unused permission: ${perm}`);
  }
}

// Reverse check: APIs used but no matching permission declared
const apiToPerm = {};
for (const [perm, apis] of Object.entries(PERMISSION_APIS)) {
  for (const api of apis) apiToPerm[api] = perm;
}
for (const call of usage) {
  const match = Object.keys(apiToPerm).find((api) => call.startsWith(api));
  if (match && !declared.includes(apiToPerm[match])) {
    problems.push(`missing permission: ${apiToPerm[match]} (for ${call})`);
  }
}

console.log(`\n  chrome.* APIs found in source: ${usage.size}`);
for (const u of Array.from(usage).sort()) console.log(`    ${u}`);

if (problems.length > 0) {
  console.log('\n  Issues:');
  for (const p of problems) console.log(`    - ${p}`);
  process.exit(1);
}

console.log('\n  All permissions match actual API usage.\n');
