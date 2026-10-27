import { describe, it, expect, vi, beforeEach } from "vitest";

// The twice-daily job that keeps the Bank of Israel's US$ and C$ rates.

const syncFxRates = vi.fn();
const captureMessage = vi.fn();
const captureException = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock("@/lib/fx/rates", () => ({ syncFxRates: (...args: unknown[]) => syncFxRates(...args) }));
vi.mock("@/lib/sentry-lazy", () => ({
  withSentry: (report: (s: unknown) => void) => report({ captureMessage, captureException }),
}));

import { GET } from "@/app/api/cron/fx-rates/route";

const run = (headers: Record<string, string> = { authorization: "Bearer s3cret" }) =>
  GET(new Request("http://test/api/cron/fx-rates", { headers }));

const fresh = {
  since: "2026-10-12",
  until: "2026-10-23",
  saved: 18,
  latest: { USD: "2026-10-22", CAD: "2026-10-22" },
  stale: [],
};

beforeEach(() => {
  syncFxRates.mockReset();
  captureMessage.mockReset();
  captureException.mockReset();
  process.env.CRON_SECRET = "s3cret";
});

describe("GET /api/cron/fx-rates", () => {
  it("refuses a caller without the cron secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = await run({ authorization: "Bearer wrong" });
    expect(res.status).toBe(401);
    expect(syncFxRates).not.toHaveBeenCalled();
  });

  it("brings the rates up to date and says what it saved", async () => {
    process.env.CRON_SECRET = "s3cret";
    syncFxRates.mockResolvedValue(fresh);
    const res = await run({ authorization: "Bearer s3cret" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ...fresh });
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("tells Sentry when a currency's newest rate is over a week old", async () => {
    syncFxRates.mockResolvedValue({ ...fresh, latest: { USD: "2026-10-10", CAD: "2026-10-22" }, stale: ["USD"] });
    const res = await run();
    expect(res.status).toBe(200);
    expect(captureMessage).toHaveBeenCalledWith(
      "Exchange rates are old: USD",
      expect.objectContaining({ level: "warning", tags: { area: "fx-rates" } })
    );
  });

  it("a failure is a 500, reported to Sentry", async () => {
    syncFxRates.mockRejectedValue(new Error("Bank of Israel rates: the service answered 503"));
    const res = await run();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Bank of Israel rates: the service answered 503" });
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
