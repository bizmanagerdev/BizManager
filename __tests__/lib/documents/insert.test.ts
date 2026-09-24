import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertDocumentRow, isMissingDocumentColumn } from "@/lib/documents/insert";

// The contract: a database that has not yet run the Phase 2 migration must
// still accept document uploads. Without this fallback, deploying the code
// before the migration breaks EVERY upload in the app with a 42703.

type Attempt = { rows: Record<string, unknown>[] };

/** Records what each insert attempt was given, and fails the first one with
 *  whatever error the test wants. */
function fakeClient(errors: Array<{ code?: string; message?: string } | null>) {
  const attempts: Attempt[] = [];
  let call = 0;
  const client = {
    from: () => ({
      insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => {
        attempts.push({ rows: Array.isArray(payload) ? payload : [payload] });
        const error = errors[call] ?? null;
        call += 1;
        return Promise.resolve({ error });
      },
    }),
  } as unknown as SupabaseClient;
  return { client, attempts };
}

const ROW = {
  id: "doc-1",
  document_type: "ביטוח",
  source: "manual_upload",
  valid_until: "2027-01-01",
  doc_date: "2026-01-01",
  amount: 120,
  title: "פוליסה",
};

describe("isMissingDocumentColumn", () => {
  it("recognizes Postgres 42703", () => {
    expect(isMissingDocumentColumn({ code: "42703" })).toBe(true);
  });

  it("recognizes the column named in the message when no code is given", () => {
    expect(
      isMissingDocumentColumn({ message: `column "source" of relation "documents" does not exist` })
    ).toBe(true);
  });

  it("does not treat an ordinary failure as a missing column", () => {
    expect(isMissingDocumentColumn({ code: "23502", message: "null value violates not-null" })).toBe(
      false
    );
    expect(isMissingDocumentColumn(null)).toBe(false);
    expect(isMissingDocumentColumn(undefined)).toBe(false);
  });
});

describe("insertDocumentRow", () => {
  it("sends the full row and stops when the database is up to date", async () => {
    const { client, attempts } = fakeClient([null]);
    const { error } = await insertDocumentRow(client, ROW);
    expect(error).toBeNull();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.rows[0]).toHaveProperty("source", "manual_upload");
  });

  it("retries without the Phase 2 columns when they do not exist yet", async () => {
    const { client, attempts } = fakeClient([{ code: "42703" }, null]);
    const { error } = await insertDocumentRow(client, ROW);

    expect(error).toBeNull();
    expect(attempts).toHaveLength(2);
    // The retry drops ONLY the new columns — the document itself still lands.
    const retried = attempts[1]?.rows[0] ?? {};
    expect(retried).not.toHaveProperty("source");
    expect(retried).not.toHaveProperty("valid_until");
    expect(retried).not.toHaveProperty("doc_date");
    expect(retried).not.toHaveProperty("amount");
    expect(retried).toMatchObject({ id: "doc-1", document_type: "ביטוח", title: "פוליסה" });
  });

  it("strips the columns from every row of a batch insert", async () => {
    const { client, attempts } = fakeClient([{ code: "42703" }, null]);
    await insertDocumentRow(client, [ROW, { ...ROW, id: "doc-2" }]);
    expect(attempts[1]?.rows).toHaveLength(2);
    for (const row of attempts[1]?.rows ?? []) {
      expect(row).not.toHaveProperty("source");
    }
  });

  it("surfaces a real failure instead of retrying it", async () => {
    const { client, attempts } = fakeClient([{ code: "23502", message: "not-null violation" }]);
    const { error } = await insertDocumentRow(client, ROW);
    expect(error).toMatchObject({ code: "23502" });
    expect(attempts).toHaveLength(1);
  });

  it("returns the retry's own error when the fallback also fails", async () => {
    const { client } = fakeClient([{ code: "42703" }, { code: "23502", message: "boom" }]);
    const { error } = await insertDocumentRow(client, ROW);
    expect(error).toMatchObject({ code: "23502" });
  });
});
