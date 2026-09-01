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
//   3. The same identity rule in TypeScript: code that resolves the CURRENT caller
//      out of the users table must filter on auth_user_id, not the app PK.

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

// Migrations are an append-only history: once applied they are not rewritten, so
// a file that introduced the bug keeps the pattern forever. These two are already
// SUPERSEDED — 20260809010000_session_fns_auth_user_id_identity.sql re-creates both
// functions matching on auth_user_id only. Listed here so the guard still fails on
// any NEW occurrence. Anything added below needs a superseding migration first.
const MIGRATION_BUG_SUPERSEDED = new Set([
  "20260724100000_session_heartbeat_identity_fix.sql",
  "20260726110000_session_end.sql",
]);

/** The migration that must exist for the entries above to count as fixed. */
const SUPERSEDING_MIGRATION = "20260809010000_session_fns_auth_user_id_identity.sql";

describe("RLS guardrail — users-table identity column", () => {
  it("no migration gates on the users PK instead of auth_user_id", () => {
    const offenders = sqlFiles(MIGRATIONS_DIR)
      .filter((f) => USERS_PK_BUG.test(normalize(f.text)))
      .map((f) => f.name)
      .filter((name) => !MIGRATION_BUG_SUPERSEDED.has(name));
    expect(offenders).toEqual([]);
  });

  it("the migration that supersedes the known-buggy ones is still present", () => {
    // Without it, the exemptions above would be hiding a live bug.
    const present = sqlFiles(MIGRATIONS_DIR).map((f) => f.name);
    expect(present).toContain(SUPERSEDING_MIGRATION);
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

describe("identity guardrail — app code resolving the current caller", () => {
  // A file that asks Supabase who is signed in AND reads public.users is resolving
  // "who am I". That lookup must filter on auth_user_id: users.id is an independent
  // app PK, so matching it against the auth uid only works for accounts that
  // self-provisioned with id = auth_user_id, and silently bounces anyone created
  // via admin_upsert_user_profile. Looking OTHER users up by `id` is correct and is
  // not what this checks — the pairing with an auth call is what makes it a
  // self-lookup.
  const SOURCE_DIRS = ["app", "components", "lib", "hooks"];

  function sourceFiles(dir: string): string[] {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) return [];
    const out: string[] = [];
    const walk = (d: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const p = join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(entry.name)) out.push(p);
      }
    };
    walk(abs);
    return out;
  }

  it("every self-lookup on public.users filters by auth_user_id", () => {
    const offenders: string[] = [];
    for (const dir of SOURCE_DIRS) {
      for (const file of sourceFiles(dir)) {
        const text = readFileSync(file, "utf8");
        const readsUsers = text.includes('from("users")');
        const knowsCaller = /auth\.getUser\(\)|auth\.getSession\(\)/.test(text);
        if (!readsUsers || !knowsCaller) continue;
        if (!text.includes('.eq("auth_user_id"')) {
          offenders.push(file.slice(ROOT.length + 1).replace(/\\/g, "/"));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("finds the self-lookups it is meant to guard (the scan actually matches)", () => {
    // Without this, a refactor that renamed the Supabase calls would make the
    // check above pass by finding nothing at all.
    let found = 0;
    for (const dir of SOURCE_DIRS) {
      for (const file of sourceFiles(dir)) {
        const text = readFileSync(file, "utf8");
        if (text.includes('from("users")') && /auth\.getUser\(\)|auth\.getSession\(\)/.test(text)) found++;
      }
    }
    expect(found).toBeGreaterThanOrEqual(5);
  });
});

describe("RLS guardrail — view security_invoker regression", () => {
  // Live audit (2026-09-01) found 10 financial/payroll views readable by the
  // PUBLIC anon key — no login required — because they lacked security_invoker
  // and ran as the view owner, bypassing RLS for every caller. Root cause,
  // confirmed by reading migration history: 5 of them had ALREADY been fixed
  // once (db/sql/fix_rls_views_security_invoker.sql, June 2026), but a later
  // `create or replace view` in a routine feature migration recreated the view
  // and silently dropped the security_invoker reloption — Postgres does not
  // carry it over unless the replacing statement re-specifies it. This
  // happened 7 times across 7 different migrations in about two months
  // (see 20260630000002, 20260707000000, 20260724010000, 20260826134530,
  // 20260827000000). Fixed again in 20260901000000_fix_financial_views_
  // security_invoker_leak.sql. This guard exists so the NEXT `create or
  // replace view` on one of these regresses loudly in CI instead of quietly
  // reopening a data leak for another few months.
  //
  // Scope: every view currently granted SELECT to anon (42, per the same
  // live audit). This guard can only verify views whose lifecycle is visible
  // in supabase/migrations — some of these 42 were created only via the
  // frozen, untracked db/sql/ legacy files (the migration baseline never
  // captured views — see [[db-schema-drift]] / foundation-hardening memory),
  // so this test SKIPS a view it never sees touched rather than asserting
  // anything about it. That's a real, separate gap (no versioned record of
  // those views' current state) — not something a static text scan can close.
  const PROTECTED_VIEWS = [
    "cash_flow_entries_view",
    "cash_flow_monthly_view",
    "cash_flow_view",
    "collections_view",
    "current_salary_agreements_view",
    "customer_activity_view",
    "customer_open_balance_view",
    "customer_orders_view",
    "customer_overview_view",
    "customer_projects_view",
    "customer_sales_summary_view",
    "delivery_overview_view",
    "document_overview_view",
    "financial_expenses_view",
    "financial_payments_view",
    "financial_project_view",
    "monthly_worker_balance_view",
    "operations_dashboard_view",
    "order_financials_view",
    "order_items_detailed_view",
    "order_overview_view",
    "payroll_period_summary_view",
    "products_with_last_used",
    "profit_and_loss_view",
    "project_dashboard_view",
    "project_documents_view",
    "project_expenses_summary_view",
    "project_financials_view",
    "project_overview_view",
    "project_task_progress_view",
    "project_worker_balance_view",
    "salary_center_worker_overview_view",
    "sales_financials_view",
    "session_effective_payment_view",
    "task_bottleneck_view",
    "task_overview_view",
    "task_time_summary_view",
    "user_workload_view",
    "worker_attendance_monthly_view",
    "worker_balance_summary_view",
    "worker_debt_items_view",
    "worker_project_hours_view",
  ];

  const CREATE_VIEW = /create\s+(?:or\s+replace\s+)?view\s+public\.([a-z0-9_]+)\s*([^;]*);/gi;
  const ALTER_VIEW_INVOKER =
    /alter\s+view\s+public\.([a-z0-9_]+)\s+set\s*\(\s*security_invoker\s*=\s*(on|true|off|false)\s*\)/gi;

  function reconstructInvokerState() {
    // Chronological order matters: migrations are an append-only history, and
    // whichever statement touched a view LAST determines its current state.
    const files = sqlFiles(MIGRATIONS_DIR).sort((a, b) => a.name.localeCompare(b.name));
    const state = new Map<string, boolean>();
    for (const f of files) {
      const norm = normalize(f.text);
      for (const m of norm.matchAll(CREATE_VIEW)) {
        const [, name, body] = m;
        state.set(name.toLowerCase(), /security_invoker\s*=\s*(on|true)/i.test(body));
      }
      for (const m of norm.matchAll(ALTER_VIEW_INVOKER)) {
        const [, name, value] = m;
        state.set(name.toLowerCase(), /on|true/i.test(value));
      }
    }
    return state;
  }

  it("every anon-exposed view touched by a migration ends up security_invoker=on", () => {
    const state = reconstructInvokerState();
    const violations = PROTECTED_VIEWS.filter((name) => state.has(name) && state.get(name) === false);
    expect(violations).toEqual([]);
  });

  it("the regression-fix migration is still present", () => {
    // Without it, several of the views above would be failing the check above
    // right now instead of passing — this pins the fix so it can't be reverted
    // by accident.
    const present = sqlFiles(MIGRATIONS_DIR).map((f) => f.name);
    expect(present).toContain("20260901000000_fix_financial_views_security_invoker_leak.sql");
  });

  it("finds view definitions to guard (parser is actually matching migrations)", () => {
    const state = reconstructInvokerState();
    expect(state.size).toBeGreaterThanOrEqual(8);
  });
});

describe("RLS guardrail — sanity", () => {
  it("finds policy SQL to guard (parser is actually matching files)", () => {
    const all = [...sqlFiles(MIGRATIONS_DIR), ...sqlFiles(LEGACY_DIR)];
    const withPolicies = all.filter((f) => /create\s+policy/i.test(f.text));
    expect(withPolicies.length).toBeGreaterThan(0);
  });
});
