#!/usr/bin/env node
// Guard: db/sql/ is FROZEN. All schema changes go through supabase/migrations/.
// This fails CI if any NEW .sql file appears in db/sql/ that isn't in the frozen
// manifest — so the legacy "paste into the Supabase editor" pattern can't grow
// and re-introduce repo-vs-prod drift. Removing legacy files is fine (encouraged).
//
// To intentionally (re)freeze after pruning: npm run db:refreeze
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "db", "sql");
const manifestPath = join(dir, ".frozen-manifest");

if (!existsSync(dir)) process.exit(0);

const manifest = new Set(
  existsSync(manifestPath)
    ? readFileSync(manifestPath, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
    : []
);

const current = readdirSync(dir).filter((f) => f.endsWith(".sql"));
const added = current.filter((f) => !manifest.has(f));

if (added.length > 0) {
  console.error(
    "\n✖ db/sql/ is frozen — new files are not allowed there.\n" +
      "  Put schema changes in supabase/migrations/ instead (npm run db:new <name>).\n\n" +
      "  Offending new file(s):\n" +
      added.map((f) => `    - db/sql/${f}`).join("\n") +
      "\n"
  );
  process.exit(1);
}

console.log(`✓ db/sql frozen (${current.length} legacy files, 0 new)`);
