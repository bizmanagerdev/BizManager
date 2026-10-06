import { describe, it, expect, vi, beforeEach } from "vitest";

// A save that fails halfway takes back the row it just made. With only a
// worker's session that delete silently matched nothing (workers have no
// delete rule), leaving a half-made row — so the server's own access finishes
// the job, for exactly that row and only if this person created it.

const { createSupabaseAdminClient } = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient }));

import { undoDocumentCreate, undoExpenseCreate } from "@/lib/documents/undoCreate";

function fakeClient(deletedRows: number) {
  const calls: Array<{ table: string; filters: Array<[string, unknown]>; selected: boolean }> = [];
  const client = {
    from(table: string) {
      const call = { table, filters: [] as Array<[string, unknown]>, selected: false };
      calls.push(call);
      const builder = {
        delete: () => builder,
        eq: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return builder;
        },
        select: () => {
          call.selected = true;
          return Promise.resolve({ data: Array.from({ length: deletedRows }, (_, i) => ({ id: `r${i}` })), error: null });
        },
        then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      };
      return builder;
    },
  };
  return { client, calls };
}

describe("undoing a half-made row", () => {
  beforeEach(() => createSupabaseAdminClient.mockReset());

  it("stops after the person's own delete when it worked", async () => {
    const session = fakeClient(1);
    const admin = fakeClient(0);
    createSupabaseAdminClient.mockReturnValue(admin.client);
    await undoDocumentCreate(session.client as never, "doc-1", "user-1");
    expect(session.calls).toEqual([{ table: "documents", filters: [["id", "doc-1"]], selected: true }]);
    expect(admin.calls).toHaveLength(0);
  });

  it("finishes with the server's access — only that id, only if this person made it", async () => {
    const session = fakeClient(0);
    const admin = fakeClient(0);
    createSupabaseAdminClient.mockReturnValue(admin.client);
    await undoDocumentCreate(session.client as never, "doc-1", "user-1");
    expect(admin.calls).toEqual([
      { table: "documents", filters: [["id", "doc-1"], ["uploaded_by", "user-1"]], selected: false },
    ]);

    await undoExpenseCreate(session.client as never, "exp-9", "user-1");
    expect(admin.calls[1]).toEqual({ table: "expenses", filters: [["id", "exp-9"], ["recorded_by", "user-1"]], selected: false });
  });

  it("does nothing more when the server's access isn't configured", async () => {
    const session = fakeClient(0);
    createSupabaseAdminClient.mockReturnValue(null);
    await expect(undoDocumentCreate(session.client as never, "doc-1", "user-1")).resolves.toBeUndefined();
  });
});
