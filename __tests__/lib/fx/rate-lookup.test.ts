import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalSupabase } from "@/lib/powersync/local-supabase";

// The day's rate for an entry form (lib/fx/rate-lookup.ts): from the server —
// and with no connection from the device copy, which has the rates since 2025
// (owner, 2026-10-28: the accounts page opened offline, a line typed in US$).

const h = vi.hoisted(() => ({ reachable: true, deviceReady: true }));
vi.mock("@/lib/pwa/connection", () => ({ isServerReachable: () => h.reachable }));

const deviceRates = [
  { id: "fx1", currency: "USD", rate_date: "2026-10-23", rate: "3.31" },
  { id: "fx2", currency: "USD", rate_date: "2026-10-26", rate: "3.25" },
  { id: "fx3", currency: "CAD", rate_date: "2026-10-26", rate: "2.3" },
];
const local = createLocalSupabase({
  getAll: async <T,>(sql: string) => (/FROM fx_rates/.test(sql) ? deviceRates : []) as T[],
});
vi.mock("@/lib/powersync/store", () => ({ readyLocalDatabase: () => (h.deviceReady ? {} : null) }));
vi.mock("@/lib/powersync/local-results", () => ({ localClient: async () => local }));

import { lookupFxRate } from "@/lib/fx/rate-lookup";

/** A server whose fx_rates read answers `answer` (or fails). */
function server(answer: { data: unknown; error: unknown }) {
  const query = {
    select: () => query,
    eq: () => query,
    lte: () => query,
    order: () => query,
    limit: () => query,
    maybeSingle: vi.fn(async () => answer),
  };
  return { from: vi.fn(() => query), query } as never as Parameters<typeof lookupFxRate>[0] & { from: ReturnType<typeof vi.fn> };
}

describe("the day's rate for an entry form", () => {
  beforeEach(() => {
    h.reachable = true;
    h.deviceReady = true;
  });

  it("online: the server's", async () => {
    const supabase = server({ data: { rate_date: "2026-10-27", rate: 3.27 }, error: null });
    expect(await lookupFxRate(supabase, "USD", "2026-10-27")).toEqual({ rate: 3.27, date: "2026-10-27" });
  });

  it("no connection: the device copy's — the day's own or the last before it — without asking the server", async () => {
    h.reachable = false;
    const supabase = server({ data: null, error: { message: "should not be asked" } });
    expect(await lookupFxRate(supabase, "USD", "2026-10-25")).toEqual({ rate: 3.31, date: "2026-10-23" });
    expect(await lookupFxRate(supabase, "CAD", "2026-10-28")).toEqual({ rate: 2.3, date: "2026-10-26" });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("the connection drops as it asks: the device copy's", async () => {
    const supabase = server({ data: null, error: { message: "TypeError: Failed to fetch" } });
    expect(await lookupFxRate(supabase, "USD", "2026-10-28")).toEqual({ rate: 3.25, date: "2026-10-26" });
  });

  it("neither has one (no copy on this device): none — the form asks for it to be typed", async () => {
    h.reachable = false;
    h.deviceReady = false;
    expect(await lookupFxRate(server({ data: null, error: null }), "USD", "2026-10-21")).toBeNull();
  });
});
