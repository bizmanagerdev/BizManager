import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

// Static RLS guardrail. This does NOT prove the live database enforces RLS
// correctly (that needs an integration run against a real Postgres — see
// rls-live.test.ts). What it DOES do, in CI with no infrastructure, is encode
// two lessons already learned the hard way and stop them from regressing:
//
//   1. A policy/function that gates on the users table must match it by
//      `auth_user_id = auth.uid()`. The bug class is `users ... id = auth.uid()`
//      — comparing the app PK to the auth uid, so the check NEVER matches and the
//      gate silently fails (see db/sql/audit_rls_and_grants.sql which documents it).
//   2. A migration that ENABLEs row level security on a table must also define at
//      least one policy for it in the same migration — otherwise the table is RLS-
//      enabled with no policy and locks everyone out.

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const LEGACY_DIR = join(ROOT, "db", "sql");

function sqlFiles(dir: string): { name: string; text: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}

// Collapse whitespace so multi-line statements match as one string.
function normalize(text: string) {
  return text.replace(/\s+/g, " ");
}

// `users ... where ... id = auth.uid()` — the PK-vs-auth-uid bug. `user_id` is
// excluded by the word boundary, so the correct `auth.uid() = user_id` pattern
// (tables that store the auth uid directly) does not trip this.
const USERS_PK_BUG = /\busers\b[^;]*?\bwhere\b[^;]*?\bid\s*=\s*auth\.uid\(\)/i;

// Diagnostic scripts that legitimately contain the bug pattern as a string to
// search for — not real DDL.
const DIAGNOSTIC_FILES = new Set(["audit_rls_and_grants.sql"]);

// Legacy db/sql files known to contain the bug pattern at the time this guard
// was written. db/sql is frozen; these must be verified against the live DB and
// fixed there if still present. The guard's job is to ensure the list never GROWS.
const LEGACY_BUG_BASELINE = new Set([
  "create_push_alert_config.sql",
  "audit_logging_toggle.sql",
]);

describe("RLS guardrail — users-table identity column", () => {
  it("no migration gates on the users PK instead of auth_user_id", () => {
    const offenders = sqlFiles(MIGRATIONS_DIR)
      .filter((f) => USERS_PK_BUG.test(normalize(f.text)))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it("no NEW legacy file introduces the users-PK bug beyond the known baseline", () => {
    const offenders = sqlFiles(LEGACY_DIR)
      .filter((f) => !DIAGNOSTIC_FILES.has(f.name))
      .filter((f) => USERS_PK_BUG.test(normalize(f.text)))
      .map((f) => f.name);
    const unexpected = offenders.filter((name) => !LEGACY_BUG_BASELINE.has(name));
    expect(unexpected).toEqual([]);
  });

  it("the known buggy legacy files still exist (baseline stays meaningful)", () => {
    // If one of these is deleted/renamed, prune the baseline so it can't hide a
    // fresh occurrence under a stale name.
    const present = sqlFiles(LEGACY_DIR).map((f) => f.name);
    for (const name of LEGACY_BUG_BASELINE) {
      expect(present).toContain(name);
    }
  });
});

describe("RLS guardrail — no RLS-enabled-without-policy in migrations", () => {
  const ENABLE_RLS = /alter\s+table\s+(?:only\s+)?([a-z0-9_."]+)\s+enable\s+row\s+level\s+security/gi;
  const POLICY_ON = /create\s+policy\s+[^;]*?\son\s+([a-z0-9_."]+)/gi;

  function tableName(raw: string) {
    // Normalise public.foo / "foo" / public."foo" → foo
    return raw.replace(/"/g, "").replace(/^public\./, "").toLowerCase();
  }

  it("every table that enables RLS in a migration has a policy in the same migration", () => {
    const violations: string[] = [];
    for (const f of sqlFiles(MIGRATIONS_DIR)) {
      const norm = normalize(f.text);
      const enabled = new Set<string>();
      const policied = new Set<string>();
      for (const m of norm.matchAll(ENABLE_RLS)) enabled.add(tableName(m[1]));
      for (const m of norm.matchAll(POLICY_ON)) policied.add(tableName(m[1]));
      for (const t of enabled) {
        if (!policied.has(t)) violations.push(`${f.name}: ${t}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("RLS guardrail — sanity", () => {
  it("finds policy SQL to guard (parser is actually matching files)", () => {
    const all = [...sqlFiles(MIGRATIONS_DIR), ...sqlFiles(LEGACY_DIR)];
    const withPolicies = all.filter((f) => /create\s+policy/i.test(f.text));
    expect(withPolicies.length).toBeGreaterThan(0);
  });
});
