import { describe, it, expect, vi } from "vitest";

// deliverPush's inAppOncePerTag: whoever already has a bell row with this tag
// gets the push again, but no second row.

const sendPushToRecipients = vi.fn(async (_sb: unknown, ids: string[]) => ({ sent: ids.length, failed: 0 }));
vi.mock("@/lib/push", () => ({ sendPushToRecipients: (...args: unknown[]) => sendPushToRecipients(...(args as [unknown, string[]])) }));

import { deliverPush } from "@/lib/notifications/deliver";

function makeSupabase(haveTag: string[]) {
  const inserted: unknown[] = [];
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in"]) builder[method] = () => builder;
    builder.insert = (rows: unknown[]) => {
      inserted.push(...rows);
      return Promise.resolve({ data: null, error: null });
    };
    builder.then = (onF: (v: unknown) => unknown) =>
      Promise.resolve(
        table === "users"
          ? { data: [{ auth_user_id: "a", notification_prefs: null }, { auth_user_id: "b", notification_prefs: null }], error: null }
          : { data: haveTag.map((user_id) => ({ user_id })), error: null }
      ).then(onF);
    return builder;
  };
  return { supabase: { from } as never, inserted };
}

describe("deliverPush — one bell row per tag", () => {
  it("skips the bell row for whoever has this tag already, and still pushes to both", async () => {
    const { supabase, inserted } = makeSupabase(["a"]);
    const res = await deliverPush(supabase, ["a", "b"], { title: "t", body: "b", tag: "nightly-review-2026-10-09" }, "nightly", {
      alwaysPush: true,
      inAppOncePerTag: true,
    });
    expect(inserted.map((row) => (row as { user_id: string }).user_id)).toEqual(["b"]);
    expect(res.sent).toBe(2);
  });

  it("without the option: a row for everyone, as before", async () => {
    const { supabase, inserted } = makeSupabase(["a"]);
    await deliverPush(supabase, ["a", "b"], { title: "t", body: "b", tag: "x" }, "nightly", { alwaysPush: true });
    expect(inserted).toHaveLength(2);
  });
});
