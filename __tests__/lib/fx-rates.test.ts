import { describe, it, expect, vi } from "vitest";
import {
  boiRatesUrl,
  fetchBoiRates,
  FX_HISTORY_START,
  parseBoiCsv,
  shiftDateKey,
  syncFxRates,
} from "@/lib/fx/rates";

// The Bank of Israel's daily US$ and C$ rates (owner, 2026-10-22: "dollar to
// shekel and Canada to shekel — on the spot, for the accounts").

const HEADER =
  "SERIES_CODE,FREQ,BASE_CURRENCY,COUNTER_CURRENCY,UNIT_MEASURE,DATA_TYPE,DATA_SOURCE,TIME_COLLECT,CONF_STATUS,PUB_WEBSITE,UNIT_MULT,COMMENTS,TIME_PERIOD,OBS_VALUE,RELEASE_STATUS";
const line = (series: string, date: string, value: string, comment = "") =>
  `${series},D,X,ILS,ILS,OF00,BOI_MRKT,V,F,Y,0,${comment},${date},${value},YP`;

// As the bank answered on 2026-10-23.
const SAMPLE = [
  HEADER,
  line("RER_CAD_ILS", "2026-10-21", "2.2009"),
  line("RER_CAD_ILS", "2026-10-22", "2.2137"),
  line("RER_USD_ILS", "2026-10-21", "3.091"),
  line("RER_USD_ILS", "2026-10-22", "3.107"),
].join("\r\n");

describe("parseBoiCsv", () => {
  it("reads each series' day and rate", () => {
    expect(parseBoiCsv(SAMPLE)).toEqual([
      { currency: "CAD", rateDate: "2026-10-21", rate: 2.2009 },
      { currency: "CAD", rateDate: "2026-10-22", rate: 2.2137 },
      { currency: "USD", rateDate: "2026-10-21", rate: 3.091 },
      { currency: "USD", rateDate: "2026-10-22", rate: 3.107 },
    ]);
  });

  it("finds the columns by name, wherever the bank puts them", () => {
    const csv = "TIME_PERIOD,OBS_VALUE,SERIES_CODE\n2026-10-22,3.107,RER_USD_ILS";
    expect(parseBoiCsv(csv)).toEqual([{ currency: "USD", rateDate: "2026-10-22", rate: 3.107 }]);
  });

  it("keeps a quoted comment with a comma from shifting the columns", () => {
    const csv = [HEADER, line("RER_USD_ILS", "2026-10-22", "3.107", '"late, corrected"')].join("\n");
    expect(parseBoiCsv(csv)).toEqual([{ currency: "USD", rateDate: "2026-10-22", rate: 3.107 }]);
  });

  it("skips other series, bad dates, and values no rate has ever been", () => {
    const csv = [
      HEADER,
      line("RER_EUR_ILS", "2026-10-22", "3.6"),
      line("RER_USD_ILS", "22/10/2026", "3.107"),
      line("RER_USD_ILS", "2026-10-21", ""),
      line("RER_USD_ILS", "2026-10-20", "3107"),
      line("RER_CAD_ILS", "2026-10-22", "2.2137"),
    ].join("\n");
    expect(parseBoiCsv(csv)).toEqual([{ currency: "CAD", rateDate: "2026-10-22", rate: 2.2137 }]);
  });

  it("an empty answer is no rates; an answer without the rate columns is an error", () => {
    expect(parseBoiCsv("")).toEqual([]);
    expect(() => parseBoiCsv("<!DOCTYPE html><html>")).toThrow(/no SERIES_CODE/);
  });
});

describe("fetchBoiRates", () => {
  it("asks for both series over the days given", async () => {
    const fetchImpl = vi.fn(async (_url: string) => new Response(SAMPLE, { status: 200 }));
    await fetchBoiRates("2026-10-12", "2026-10-23", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0][0]).toBe(boiRatesUrl("2026-10-12", "2026-10-23"));
    expect(boiRatesUrl("2026-10-12", "2026-10-23")).toBe(
      "https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS,RER_CAD_ILS?startperiod=2026-10-12&endperiod=2026-10-23&format=csv"
    );
  });

  it("a stretch with no rates (the bank's 404, e.g. a weekend) is an empty answer", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>not found</html>", { status: 404 }));
    await expect(fetchBoiRates("2026-10-17", "2026-10-18", fetchImpl as unknown as typeof fetch)).resolves.toEqual([]);
  });

  it("any other failure is an error", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    await expect(fetchBoiRates("2026-10-12", "2026-10-23", fetchImpl as unknown as typeof fetch)).rejects.toThrow(/503/);
  });
});

describe("shiftDateKey", () => {
  it("moves across months and years", () => {
    expect(shiftDateKey("2026-10-03", -10)).toBe("2026-09-23");
    expect(shiftDateKey("2026-01-05", -10)).toBe("2025-12-26");
  });
});

/** A fake fx_rates table: the newest day each currency already has, and what
 *  was written. */
function fakeSupabase(newest: Record<string, string | null>) {
  const upserts: { rows: Record<string, unknown>[]; options: unknown }[] = [];
  const from = (table: string) => {
    expect(table).toBe("fx_rates");
    let currency = "";
    const query = {
      select: () => query,
      eq: (_column: string, value: string) => {
        currency = value;
        return query;
      },
      order: () => query,
      limit: () => query,
      maybeSingle: async () => ({ data: newest[currency] ? { rate_date: newest[currency] } : null, error: null }),
      upsert: async (rows: Record<string, unknown>[], options: unknown) => {
        upserts.push({ rows, options });
        return { error: null };
      },
    };
    return query;
  };
  return { client: { from } as never, upserts };
}

const answering = (csv: string) => vi.fn(async () => new Response(csv, { status: 200 })) as unknown as typeof fetch;

describe("syncFxRates", () => {
  it("an empty table gets the whole history", async () => {
    const { client, upserts } = fakeSupabase({});
    const fetchImpl = answering(SAMPLE);
    const result = await syncFxRates(client, { today: "2026-10-23", fetchImpl });
    expect(result.since).toBe(FX_HISTORY_START);
    expect(vi.mocked(fetchImpl).mock.calls[0][0]).toContain(`startperiod=${FX_HISTORY_START}&endperiod=2026-10-23`);
    expect(upserts[0].options).toEqual({ onConflict: "currency,rate_date" });
    expect(upserts[0].rows[3]).toMatchObject({ currency: "USD", rate_date: "2026-10-22", rate: 3.107, source: "boi" });
    expect(result).toMatchObject({ saved: 4, latest: { USD: "2026-10-22", CAD: "2026-10-22" }, stale: [] });
  });

  it("after that, asks again from ten days before the older of the two newest rates", async () => {
    const { client } = fakeSupabase({ USD: "2026-10-22", CAD: "2026-10-21" });
    const fetchImpl = answering(SAMPLE);
    const result = await syncFxRates(client, { today: "2026-10-23", fetchImpl });
    expect(result.since).toBe("2026-10-11");
  });

  it("a currency with none yet brings the history back", async () => {
    const { client } = fakeSupabase({ USD: "2026-10-22", CAD: null });
    const result = await syncFxRates(client, { today: "2026-10-23", fetchImpl: answering(SAMPLE) });
    expect(result.since).toBe(FX_HISTORY_START);
  });

  it("writes a long history a thousand rows at a time", async () => {
    const days = Array.from({ length: 1500 }, (_, i) => shiftDateKey("2020-01-01", i));
    const csv = [HEADER, ...days.map((d) => line("RER_USD_ILS", d, "3.5")), ...days.map((d) => line("RER_CAD_ILS", d, "2.6"))].join("\n");
    const { client, upserts } = fakeSupabase({});
    const result = await syncFxRates(client, { today: "2024-02-08", fetchImpl: answering(csv) });
    expect(upserts.map((u) => u.rows.length)).toEqual([1000, 1000, 1000]);
    expect(result.saved).toBe(3000);
  });

  it("says when the newest rate is over a week old", async () => {
    const { client } = fakeSupabase({ USD: "2026-10-10", CAD: "2026-10-22" });
    const notFound = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const result = await syncFxRates(client, { today: "2026-10-23", fetchImpl: notFound });
    expect(result).toMatchObject({ saved: 0, latest: { USD: "2026-10-10", CAD: "2026-10-22" }, stale: ["USD"] });
  });
});
