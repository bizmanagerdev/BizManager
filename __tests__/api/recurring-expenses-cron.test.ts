import { describe, it, expect, vi, beforeEach } from "vitest";

// The nightly job that makes the day's recurring bills (the cash-flow page
// opens from the device copy and no longer asks the server to).

const ensureRecurringExpensesForDate = vi.fn();
const adminClient = { admin: true };

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => adminClient }));
vi.mock("@/lib/recurring-expenses", () => ({
  ensureRecurringExpensesForDate: (...args: unknown[]) => ensureRecurringExpensesForDate(...args),
}));

import { GET } from "@/app/api/cron/recurring-expenses/route";

const run = (headers: Record<string, string> = { authorization: "Bearer s3cret" }) =>
  GET(new Request("http://test/api/cron/recurring-expenses", { headers }));

beforeEach(() => {
  ensureRecurringExpensesForDate.mockReset();
  process.env.CRON_SECRET = "s3cret";
});

describe("GET /api/cron/recurring-expenses", () => {
  it("refuses a caller without the cron secret", async () => {
    const res = await run({ authorization: "Bearer wrong" });
    expect(res.status).toBe(401);
    expect(ensureRecurringExpensesForDate).not.toHaveBeenCalled();
  });

  it("makes the day's bills with the server's key and says how many", async () => {
    ensureRecurringExpensesForDate.mockResolvedValue({ ok: true, createdCount: 3, skippedMissingSchema: false });
    const res = await run();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, created: 3 });
    expect(ensureRecurringExpensesForDate).toHaveBeenCalledWith(adminClient);
  });

  it("a refused generator is a 500 with its message", async () => {
    ensureRecurringExpensesForDate.mockResolvedValue({
      ok: false,
      createdCount: 0,
      skippedMissingSchema: false,
      error: "שגיאה ביצירת הוצאות קבועות",
    });
    const res = await run();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "שגיאה ביצירת הוצאות קבועות" });
  });

  it("a thrown error is a 500 too", async () => {
    ensureRecurringExpensesForDate.mockRejectedValue(new Error("network down"));
    const res = await run();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "network down" });
  });
});
