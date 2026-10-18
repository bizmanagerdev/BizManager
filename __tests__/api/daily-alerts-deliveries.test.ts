import { describe, it, expect, vi, beforeEach } from "vitest";

// The 17:00 "משלוחים היום" push. It asked for orders "out_for_delivery" /
// "confirmed" / "processing" — statuses no order has (an open order is
// "draft") — so it never went out. Now it counts the deliveries list's open
// orders, by the city each goes to (found mapping addresses, 2026-10-16).

type Call = { table: string; method: string; args: unknown[] };
const calls: Call[] = [];
let openDeliveries: Record<string, unknown>[] = [];

function makeSupabase() {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "not", "lt", "lte", "gte", "order", "range"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    }
    const answer = () => {
      if (table === "push_alert_config") {
        return {
          data: [
            { id: "a1", alert_type: "deliveries", title: "משלוחים היום", body: "", url: "/sales", enabled: true, mode: "scheduled", send_hour_israel: 17, schedule: "daily", recipient_user_ids: ["u1"] },
          ],
          error: null,
        };
      }
      if (table === "delivery_overview_view") return { data: openDeliveries, error: null };
      return { data: [], error: null };
    };
    builder.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(answer()).then(onF, onR);
    return builder;
  };
  return { from };
}

const deliverPush = vi.fn(async (..._args: unknown[]) => ({ sent: 1, failed: 0 }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => makeSupabase() }));
vi.mock("@/lib/notifications/deliver", () => ({ deliverPush: (...args: unknown[]) => deliverPush(...args) }));
vi.mock("@/lib/notifications/identity", () => ({ usersToAuthMap: async () => new Map([["u1", "auth-1"]]) }));

import { GET } from "@/app/api/cron/daily-alerts/route";

const run = () => GET(new Request("http://test/api/cron/daily-alerts?force=true"));
const sentPush = () => deliverPush.mock.calls[0]?.[2] as { title: string; body: string } | undefined;

beforeEach(() => {
  calls.length = 0;
  deliverPush.mockClear();
  delete process.env.CRON_SECRET;
});

describe("the 17:00 deliveries push", () => {
  it("asks for every open order, as the deliveries list does", async () => {
    openDeliveries = [];
    await run();
    const filter = calls.find((c) => c.table === "delivery_overview_view" && c.method === "not");
    expect(filter?.args[0]).toBe("status");
    expect(String(filter?.args[2])).toContain("delivered");
    expect(calls.some((c) => c.table === "delivery_overview_view" && c.method === "in")).toBe(false);
  });

  it("goes out with the count per city, a branch order under the branch's city", async () => {
    openDeliveries = [
      { customer_address: "אלעד | שמעיה 8", customer_city: "אלעד", branch_address: null },
      { customer_address: "בני ברק | חזון איש 8", customer_city: "בני ברק", branch_address: null },
      { customer_address: "בני ברק | גוטמכר 10", customer_city: "בני ברק", branch_address: null },
      { customer_address: "ירושלים | יפו 20", customer_city: "ירושלים", branch_address: "חיפה | הרצל 5" },
    ];
    await run();
    expect(sentPush()).toMatchObject({ title: "🚚 4 משלוחים היום" });
    expect(sentPush()?.body).toContain("בני ברק: 2");
    expect(sentPush()?.body).toContain("חיפה: 1");
    expect(sentPush()?.body).not.toContain("ירושלים");
    expect(deliverPush.mock.calls[0]?.[1]).toEqual(["auth-1"]);
  });

  it("stays quiet when nothing is waiting", async () => {
    openDeliveries = [];
    await run();
    expect(deliverPush).not.toHaveBeenCalled();
  });
});
