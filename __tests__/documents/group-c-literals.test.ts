import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ────────────────────────────────────────────────────────────────────────────
// GROUP C GUARD — the literals that must survive the source/category split.
//
// Phase 2 moved "where a file came from" out of documents.document_type into
// its own `source` column. Four values could NOT move, because something other
// than the archive reads them:
//
//   vehicle_photo        — an RLS PREDICATE. documents_worker_select_vehicle_photo
//                          and documents_worker_delete_vehicle_photo match this
//                          literal, so changing it silently revokes worker
//                          access to vehicle photos. This is a security bug,
//                          not a display bug, and nothing at runtime would fail
//                          loudly enough to catch it.
//   order_delivery_image — compared by literal on the order page and in the
//                          order edit-data route.
//   project_photo        — rendered as its own kind on the project page.
//   morning_<id>         — minted by the external Morning integration.
//
// These assertions are deliberately static: they pin the WRITE side, the READ
// side, and the backfill migration together. A runtime test could not cover the
// migration at all, and the migration is where a careless UPDATE would do the
// damage.
// ────────────────────────────────────────────────────────────────────────────

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const GROUP_C = ["vehicle_photo", "order_delivery_image", "project_photo"] as const;

describe("Group C literals are still WRITTEN", () => {
  it("the vehicle photo route still stores document_type 'vehicle_photo'", () => {
    // If this fails, worker access to vehicle photos is broken by RLS.
    expect(read("app/api/vehicles/[id]/photo/route.ts")).toContain(
      `document_type: "vehicle_photo"`
    );
  });

  it("both delivery-image writers still store 'order_delivery_image'", () => {
    expect(read("app/api/orders/[id]/delivery-images/route.ts")).toContain(
      `document_type: "order_delivery_image"`
    );
    expect(read("app/api/orders/update/route.ts")).toContain(
      `document_type: "order_delivery_image"`
    );
  });

  it("morning documents still store their morning_<id> code", () => {
    // service.ts builds it as `morning_${type}`; the insert passes it through.
    const src = read("lib/morning/service.ts");
    expect(src).toContain("`morning_${");
    expect(src).toContain("document_type: documentType,");
  });
});

describe("Group C literals are still READ", () => {
  it("the order page and edit-data route still match 'order_delivery_image'", () => {
    expect(read("app/(app)/sales/orders/[id]/page.tsx")).toContain(`"order_delivery_image"`);
    expect(read("app/api/orders/[id]/edit-data/route.ts")).toContain(`"order_delivery_image"`);
  });
});

describe("the backfill migration never rewrites a Group C value", () => {
  const sql = read("supabase/migrations/20260922183537_documents_backfill_source.sql");

  // Every statement that ASSIGNS document_type, with comments stripped so a
  // Group C name mentioned in the explanatory header does not trip the check.
  const assignments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .filter((stmt) => /set\s+document_type\s*=/i.test(stmt));

  it("has statements that assign document_type at all (the guard is live)", () => {
    expect(assignments.length).toBeGreaterThan(0);
  });

  for (const code of GROUP_C) {
    it(`no document_type assignment mentions '${code}'`, () => {
      for (const stmt of assignments) {
        expect(stmt).not.toContain(code);
      }
    });
  }

  it("no document_type assignment touches a morning_ code", () => {
    for (const stmt of assignments) {
      expect(stmt).not.toContain("morning_");
    }
  });

  it("still sets `source` for Group C — additive, not instead", () => {
    // Step 1 copies document_type into source for every system code, Group C
    // included. That is the whole point: they gain a source, keep a category.
    const sourceCopy = sql
      .split(";")
      .find((stmt) => /set\s+source\s*=\s*document_type/i.test(stmt));
    expect(sourceCopy).toBeDefined();
    for (const code of GROUP_C) {
      expect(sourceCopy).toContain(code);
    }
  });
});

describe("Group A codes are the ones that get cleared", () => {
  const sql = read("supabase/migrations/20260922183537_documents_backfill_source.sql");
  const blanking = sql
    .split(";")
    .find((stmt) => /set\s+document_type\s*=\s*''/i.test(stmt));

  it("clears exactly the six source-only codes", () => {
    expect(blanking).toBeDefined();
    for (const code of [
      "task_attachment",
      "payment_attachment",
      "session_attachment",
      "expense_attachment",
      "project_document",
      "loan_document",
    ]) {
      expect(blanking).toContain(code);
    }
  });
});
