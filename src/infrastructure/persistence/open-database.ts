// openDatabase: opens a SQLite database at the given path, applies
// the migrations in `migrations/` in lexicographic order, and
// returns a connected better-sqlite3 Database instance. See
// ADR-0006 for the storage decision.
//
// The path can be a real file (e.g. `/data/riftbot.db`) or the
// in-memory special path `':memory:'` (used by the test suite).
// better-sqlite3 supports both natively; no branching needed.

import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
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

  // Track applied filenames so migrations are truly one-shot. Most of
  // the current DDL is idempotent, but a migration that drops or rewrites
  // legacy data must never be re-run on every process start.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as Array<{ name: string }>)
      .map((row) => row.name),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare(
        'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
      ).run(file, new Date().toISOString());
    })();
  }
}

export function openDatabase(path: string): Database.Database {
  if (path !== ':memory:' && !path.startsWith('file:')) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  applyMigrations(db);
  return db;
}
