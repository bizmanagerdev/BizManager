import { describe, it, expect, vi, afterEach } from "vitest";
import * as XLSX from "xlsx";
import type { NextRequest } from "next/server";

// The customers export's WhatsApp column: the overview view doesn't carry it,
// so the route looks it up on the customers table. All ~650 ids went in one
// request — an address too long to send — and the failure was ignored, so the
// column came out empty (found 2026-10-11). It goes in batches now.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));

import { GET as exportCustomers } from "@/app/api/customers/export/route";

const CUSTOMERS = Array.from({ length: 400 }, (_, i) => ({
  customer_id: `c${String(i).padStart(3, "0")}`,
  customer_name: `לקוח ${i}`,
}));

function makeSupabase() {
  const whatsappBatches: string[][] = [];
  const from = (table: string) => {
    let ids: string[] = [];
    let range: [number, number] = [0, 999];
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "order", "gt", "lte", "eq"]) builder[method] = () => builder;
    builder.in = (_column: string, values: string[]) => {
      ids = values;
      whatsappBatches.push(values);
      return builder;
    };
    builder.range = (lo: number, hi: number) => {
      range = [lo, hi];
      return builder;
    };
    const answer = () =>
      table === "customer_overview_view"
        ? { data: CUSTOMERS.slice(range[0], range[1] + 1), error: null }
        : { data: ids.map((id) => ({ id, whatsapp: `05${id.slice(1)}` })), error: null };
    builder.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(answer()).then(onF, onR);
    return builder;
  };
  return { supabase: { from }, whatsappBatches };
}

describe("GET /api/customers/export — the WhatsApp column", () => {
  it("is filled for every customer, looked up in batches no request can outgrow", async () => {
    const { supabase, whatsappBatches } = makeSupabase();
    requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase } });

    const response = await exportCustomers({
      nextUrl: new URL("https://biz-h.com/api/customers/export"),
    } as unknown as NextRequest);
    const book = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(book.Sheets[book.SheetNames[0]]);

    expect(rows).toHaveLength(400);
    expect(rows[0]["וואטסאפ"]).toBe("05000");
    expect(rows[399]["וואטסאפ"]).toBe("05399");
    expect(whatsappBatches.length).toBeGreaterThan(1);
    expect(Math.max(...whatsappBatches.map((batch) => batch.length))).toBeLessThanOrEqual(150);
  });
});

// The export pages through the list in its own order — name, then id, so
// customers who share a name are never repeated or skipped between pages —
// and names the file by Israel's date, not UTC's.
describe("GET /api/customers/export — order and file name", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sorts by name then id, applies the filters, and stamps Israel's date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 22:30 UTC on the 13th is already 01:30 on the 14th in Israel.
    vi.setSystemTime(new Date("2026-10-13T22:30:00Z"));
    const orders: string[][] = [];
    const filters: Array<[string, string, unknown]> = [];
    const from = (table: string) => {
      const order: string[] = [];
      if (table === "customer_overview_view") orders.push(order);
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.in = () => builder;
      builder.range = () => builder;
      builder.order = (column: string) => {
        order.push(column);
        return builder;
      };
      for (const op of ["gt", "lte", "eq"]) {
        builder[op] = (column: string, value: unknown) => {
          filters.push([op, column, value]);
          return builder;
        };
      }
      builder.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(onF, onR);
      return builder;
    };
    requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase: { from } } });

    const response = await exportCustomers({
      nextUrl: new URL("https://biz-h.com/api/customers/export?with_debt=yes"),
    } as unknown as NextRequest);

    expect(orders[0]).toEqual(["customer_name", "customer_id"]);
    expect(filters).toEqual([["gt", "open_balance", 0]]);
    expect(decodeURIComponent(response.headers.get("Content-Disposition") ?? "")).toContain("2026-10-14.xlsx");
  });
});
