#!/usr/bin/env node

/**
 * Restore the RoutineFlow SQLite database from a backup.
 *
 * Usage: node scripts/db-restore.mjs <backup-path>
 *
 * The current database is saved as app.db.pre-restore before overwriting.
 */

import { copyFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const DB_FILE = join(HOME, '.routineflow', 'app.db');

const backupPath = process.argv[2];

if (!backupPath) {
  console.error('Usage: node scripts/db-restore.mjs <backup-path>');
  console.error('');
  console.error('Available backups:');
  const backupsDir = join(HOME, '.routineflow', 'backups');
  if (existsSync(backupsDir)) {
    const { readdirSync } = await import('node:fs');
    const files = readdirSync(backupsDir).filter(f => f.endsWith('.db')).sort().reverse();
    for (const f of files.slice(0, 10)) {
      console.error(`  ${join(backupsDir, f)}`);
    }
    if (files.length === 0) console.error('  (none)');
  } else {
    console.error('  No backups directory found.');
  }
  process.exit(1);
}

if (!existsSync(backupPath)) {
  console.error(`Backup file not found: ${backupPath}`);
  process.exit(1);
}

// Save current DB before overwriting
if (existsSync(DB_FILE)) {
  const preRestore = DB_FILE + '.pre-restore';
  copyFileSync(DB_FILE, preRestore);
  console.log(`Current database saved to: ${preRestore}`);
}

try {
  copyFileSync(backupPath, DB_FILE);
  console.log(`Database restored from: ${backupPath}`);
  console.log(`Active database: ${DB_FILE}`);
} catch (err) {
  console.error(`Restore failed: ${err.message}`);
  process.exit(1);
}
