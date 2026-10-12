import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Nothing in the app listens LIVE (Supabase Realtime postgres_changes) to
// audit_logs. Every save writes an audit_logs row, and a live listener makes the
// database match each one against every open screen: with hours of data entry
// that froze the database on 2026-10-12 (13:26–13:50). Screens that show recent
// activity fetch it on an interval while they're visible instead — the activity
// feed and the dashboard's "while you were away" card do.

const ROOTS = ["app", "components", "lib", "hooks"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe("no live listener on audit_logs", () => {
  it("no file subscribes to postgres_changes on audit_logs", () => {
    const offenders = ROOTS.flatMap((root) => sourceFiles(root)).filter((file) => {
      const text = readFileSync(file, "utf8");
      return /postgres_changes/.test(text) && /table:\s*["']audit_logs["']/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
