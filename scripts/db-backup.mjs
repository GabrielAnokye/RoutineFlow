#!/usr/bin/env node

/**
 * Backup the RoutineFlow SQLite database.
 *
 * Usage: node scripts/db-backup.mjs [--output path]
 * Default output: ~/.routineflow/backups/app-<timestamp>.db
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const DB_FILE = join(HOME, '.routineflow', 'app.db');
const BACKUPS_DIR = join(HOME, '.routineflow', 'backups');

const args = process.argv.slice(2);
const outputIdx = args.indexOf('--output');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outputPath = outputIdx !== -1 && args[outputIdx + 1]
  ? args[outputIdx + 1]
  : join(BACKUPS_DIR, `app-${timestamp}.db`);

if (!existsSync(DB_FILE)) {
  console.error(`Database not found at ${DB_FILE}`);
  console.error('Run the runner at least once to create the database.');
  process.exit(1);
}

mkdirSync(BACKUPS_DIR, { recursive: true });

try {
  copyFileSync(DB_FILE, outputPath);
  console.log(`Database backed up to: ${outputPath}`);
} catch (err) {
  console.error(`Backup failed: ${err.message}`);
  process.exit(1);
}
