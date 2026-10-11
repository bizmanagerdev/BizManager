import { describe, it, expect, vi } from "vitest";
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
