import { describe, it, expect } from "vitest";
import { loadAttendanceSpark, SPARK_DAYS } from "@/lib/dashboard/sparklines";

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function makeSupabase(rows: Array<{ clock_in: string }>, error: { message: string } | null = null) {
  const from = () => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.gte = () => builder;
    builder.range = () => Promise.resolve({ data: error ? null : rows, error });
    return builder;
  };
  return { from } as unknown as Parameters<typeof loadAttendanceSpark>[0];
}

describe("loadAttendanceSpark", () => {
  it("is always exactly SPARK_DAYS long, a 0 for an empty day rather than a gap", async () => {
    const spark = await loadAttendanceSpark(makeSupabase([]));
    expect(spark).toHaveLength(SPARK_DAYS);
    expect(spark.every((n) => n === 0)).toBe(true);
  });

  it("counts rows per day, oldest first", async () => {
    const spark = await loadAttendanceSpark(
      makeSupabase([
        { clock_in: `${isoDaysAgo(6)}T08:00:00Z` },
        { clock_in: `${isoDaysAgo(6)}T09:00:00Z` },
        { clock_in: `${isoDaysAgo(0)}T08:00:00Z` }, // today
      ])
    );
    expect(spark[0]).toBe(2); // oldest day (6 days ago) got 2 sessions
    expect(spark[spark.length - 1]).toBe(1); // today got 1
    expect(spark.slice(1, -1).every((n) => n === 0)).toBe(true);
  });

  it("resolves to an empty series (not a throw) on a query error", async () => {
    const spark = await loadAttendanceSpark(makeSupabase([], { message: "boom" }));
    expect(spark).toEqual([]);
  });

  it("respects a custom day count", async () => {
    const spark = await loadAttendanceSpark(makeSupabase([]), 3);
    expect(spark).toHaveLength(3);
  });
});
