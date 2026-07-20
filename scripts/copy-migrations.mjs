// Copies the SQL migration files from the source tree into the
// compiled `dist/` tree. `tsc` only handles `.ts` → `.js`, so a
// plain `tsc` build leaves `dist/infrastructure/persistence/
// migrations/` empty and the runtime's migration runner (which
// reads from `__dirname/migrations`) fails on first start.
//
// This runs as a post-tsc step in the `build` npm script. It is
// a no-op if the destination already exists (Node's cpSync
// overwrites leaf files but not the directory itself, so a
// re-run is safe).
import { cpSync, existsSync } from 'node:fs';

const src = 'src/infrastructure/persistence/migrations';
const dest = 'dist/infrastructure/persistence/migrations';

if (!existsSync(src)) {
  // No migrations in source yet (v0 of the project). Nothing to
  // copy; the runtime's openDatabase would also fail, so this
  // script is purely future-proof.
  process.exit(0);
}

cpSync(src, dest, { recursive: true });
console.log(`copied migrations → ${dest}`);
