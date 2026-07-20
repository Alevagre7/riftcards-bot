// openDatabase: opens a SQLite database at the given path, applies
// the migrations in `migrations/` in lexicographic order, and
// returns a connected better-sqlite3 Database instance. See
// ADR-0006 for the storage decision.
//
// The path can be a real file (e.g. `/data/riftbot.db`) or the
// in-memory special path `':memory:'` (used by the test suite).
// better-sqlite3 supports both natively; no branching needed.

import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

function applyMigrations(db: Database.Database): void {
  // PRAGMA for sane defaults. WAL gives better concurrent read
  // behaviour; foreign_keys is opt-in in SQLite and the bot's
  // current schema doesn't need it but enabling it is cheap
  // insurance for future migrations.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run every .sql file in the migrations directory in order.
  // The runner is idempotent (every DDL uses IF NOT EXISTS), so
  // re-running on an already-migrated DB is a no-op.
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    db.exec(sql);
  }
}

export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  applyMigrations(db);
  return db;
}
