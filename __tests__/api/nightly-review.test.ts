import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The nightly review alert: one per night (a run after midnight belongs to
// the evening before), earlier nights closed when a new one starts, and one
// bell row per night however many times it pings (owner, 2026-10-09: they
// piled up — 9 open alerts and 333 unread bell rows).

type Call = { table: string; method: string; args: unknown[] };
const calls: Call[] = [];
let existing: { id: string; status: string } | null = null;

function makeSupabase() {
  const from = (table: string) => {
    const mine: Call[] = [];
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "insert", "update", "eq", "neq", "is", "in", "lte", "or", "order", "limit", "range"]) {
      builder[method] = (...args: unknown[]) => {
        const call = { table, method, args };
        mine.push(call);
        calls.push(call);
        return builder;
      };
    }
    const answer = () =>
      table === "projects"
        ? { data: [{ id: "p1", name: "הובלה" }, { id: "p2", name: "שיפוץ" }], error: null }
        : { data: table === "reminders" && !mine.some((c) => c.method === "update") ? existing : null, error: null };
    builder.maybeSingle = () => Promise.resolve(answer());
    builder.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(answer()).then(onF, onR);
    return builder;
  };
  return { from };
}

const deliverPush = vi.fn(async () => ({ sent: 1, failed: 0 }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => makeSupabase() }));
vi.mock("@/lib/notifications/deliver", () => ({ deliverPush: (...args: unknown[]) => deliverPush(...(args as [])) }));
vi.mock("@/lib/notifications/alert-config", () => ({
  getNightlyConfig: async () => ({ enabled: true, startHour: 23, endHour: 1, audienceRole: "office" }),
  recipientsForAudience: async () => ["auth-1"],
}));

import { GET } from "@/app/api/cron/nightly-review/route";

const run = () => GET(new Request("http://test/api/cron/nightly-review"));
const insertedKey = () => (calls.find((c) => c.table === "reminders" && c.method === "insert")?.args[0] as { dedupe_key?: string })?.dedupe_key;

beforeEach(() => {
  calls.length = 0;
  existing = null;
  deliverPush.mockClear();
  delete process.env.CRON_SECRET;
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => vi.useRealTimers());

describe("GET /api/cron/nightly-review", () => {
  it("23:20 and 00:20 are the same night — the evening's date", async () => {
    vi.setSystemTime(new Date("2026-10-09T20:20:00Z")); // 23:20 in Israel
    await run();
    expect(insertedKey()).toBe("nightly_review:2026-10-09");

    calls.length = 0;
    vi.setSystemTime(new Date("2026-10-09T21:20:00Z")); // 00:20 on the 10th in Israel
    await run();
    expect(insertedKey()).toBe("nightly_review:2026-10-09");
  });

  it("closes every earlier night's open alert, and marks their bell rows read", async () => {
    vi.setSystemTime(new Date("2026-10-09T20:20:00Z"));
    await run();
    const close = calls.filter((c) => c.table === "reminders");
    expect(close.find((c) => c.method === "update")?.args[0]).toMatchObject({ status: "auto_resolved" });
    expect(close).toContainEqual({ table: "reminders", method: "eq", args: ["status", "pending"] });
    expect(close).toContainEqual({ table: "reminders", method: "neq", args: ["dedupe_key", "nightly_review:2026-10-09"] });
    const bell = calls.filter((c) => c.table === "notifications");
    expect(bell.find((c) => c.method === "update")?.args[0]).toHaveProperty("read_at");
    expect(bell).toContainEqual({ table: "notifications", method: "neq", args: ["tag", "nightly-review-2026-10-09"] });
  });

  it("pings the phone each run but keeps one bell row for the night", async () => {
    vi.setSystemTime(new Date("2026-10-09T20:20:00Z"));
    await run();
    expect(deliverPush).toHaveBeenCalledWith(
      expect.anything(),
      ["auth-1"],
      expect.objectContaining({ tag: "nightly-review-2026-10-09" }),
      "nightly",
      { alwaysPush: true, inAppOncePerTag: true }
    );
  });

  it("tonight's alert already marked done: nothing more tonight", async () => {
    vi.setSystemTime(new Date("2026-10-09T21:20:00Z"));
    existing = { id: "r1", status: "auto_resolved" };
    const res = await run();
    expect(await res.json()).toMatchObject({ acknowledged: true, date: "2026-10-09" });
    expect(deliverPush).not.toHaveBeenCalled();
  });

  it("outside the night window: nothing at all", async () => {
    vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
    await run();
    expect(calls).toEqual([]);
  });
});
