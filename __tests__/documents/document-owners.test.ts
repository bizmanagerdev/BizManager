import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DOCUMENT_FK_OWNERS,
  KNOWN_DOCUMENT_REFERENCING_TABLES,
} from "@/lib/documents/owners";

// ────────────────────────────────────────────────────────────────────────────
// The guard that stops "why is this showing ללא שיוך?" from recurring.
//
// A document can be attached through document_links OR through a foreign key on
// some other table. The second kind kept being discovered one at a time, in
// production, as documents that looked unfiled: vehicle cover photos, card
// statements, bank statements, leases. Each time the fix was local, so the next
// table repeated the bug.
//
// This scans the migrations for every foreign key that references documents(id)
// and fails when one is not declared in lib/documents/owners.ts. A new table
// pointing at documents now breaks the build instead of silently orphaning
// files in the archive.
// ────────────────────────────────────────────────────────────────────────────

const MIGRATIONS_DIR = join(__dirname, "..", "..", "supabase", "migrations");

/** Table names that own a foreign key into documents(id), read from the SQL. */
function referencingTablesInMigrations(): Set<string> {
  const found = new Set<string>();
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql"))) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");

    // `alter table public.X add constraint ... FOREIGN KEY (c) REFERENCES documents(id)`
    for (const match of sql.matchAll(
      /alter\s+table\s+(?:public\.)?(\w+)[^;]*?references\s+(?:public\.)?documents\s*\(\s*id\s*\)/gi
    )) {
      if (match[1]) found.add(match[1]);
    }

    // `create table public.X ( ... col uuid references public.documents(id) ... )`
    for (const match of sql.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\s*\);/gi
    )) {
      const [, table, body] = match;
      if (table && body && /references\s+(?:public\.)?documents\s*\(\s*id\s*\)/i.test(body)) {
        found.add(table);
      }
    }
  }
  return found;
}

describe("every table that references documents(id) is declared", () => {
  const found = referencingTablesInMigrations();

  it("finds the references at all (the scanner still works)", () => {
    // If this trips, the regexes stopped matching and the guard below is
    // passing vacuously — fix the scanner, do not delete the test.
    expect(found.size).toBeGreaterThanOrEqual(4);
    expect(found).toContain("document_links");
  });

  it("declares every referencing table in lib/documents/owners.ts", () => {
    const undeclared = [...found].filter(
      (table) => !KNOWN_DOCUMENT_REFERENCING_TABLES.includes(table)
    );
    // A new table pointing at documents(id) must be added to DOCUMENT_FK_OWNERS
    // AND taught to app/(app)/documents/page.tsx, or its documents will show as
    // "ללא שיוך" in the archive while their owner is one join away.
    expect(undeclared).toEqual([]);
  });

  it("does not declare owners that no longer exist in the schema", () => {
    const stale = DOCUMENT_FK_OWNERS.map((owner) => owner.table).filter(
      (table) => !found.has(table)
    );
    expect(stale).toEqual([]);
  });
});

describe("the owner registry is coherent", () => {
  it("has a unique table+column per owner", () => {
    const keys = DOCUMENT_FK_OWNERS.map((owner) => `${owner.table}.${owner.column}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("explains every owner it deliberately leaves unresolved", () => {
    for (const owner of DOCUMENT_FK_OWNERS.filter((o) => !o.resolved)) {
      // An unresolved owner is a decision, so it has to carry its reasoning.
      expect(owner.note.length, `${owner.table}.${owner.column}`).toBeGreaterThan(40);
    }
  });
});
