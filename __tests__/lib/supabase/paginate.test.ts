import { describe, it, expect, vi } from "vitest";
import { fetchAllPaged, fetchAllPagedResult } from "@/lib/supabase/paginate";

// A fake "table" of N rows that responds to .range(from, to) like Supabase does.
function fakePager(total: number) {
  const all = Array.from({ length: total }, (_, i) => ({ id: i }));
  return (from: number, to: number) =>
    Promise.resolve({ data: all.slice(from, to + 1), error: null });
}

describe("fetchAllPaged — no silent truncation", () => {
  it("returns ALL rows even when they exceed one page", async () => {
    const rows = await fetchAllPaged<{ id: number }>(fakePager(2500), 1000);
    expect(rows).toHaveLength(2500); // not capped at 1000
    expect(rows[0].id).toBe(0);
    expect(rows[2499].id).toBe(2499);
  });

  it("stops after one short page (fewer than pageSize)", async () => {
    const page = vi.fn(fakePager(150));
    const rows = await fetchAllPaged(page, 1000);
    expect(rows).toHaveLength(150);
    expect(page).toHaveBeenCalledTimes(1); // no needless extra fetch
  });

  it("handles an exact multiple of the page size", async () => {
    const page = vi.fn(fakePager(2000));
    const rows = await fetchAllPaged(page, 1000);
    expect(rows).toHaveLength(2000);
    expect(page).toHaveBeenCalledTimes(3); // 1000, 1000, then an empty page
  });

  it("throws on a query error instead of returning partial data", async () => {
    await expect(
      fetchAllPaged(() => Promise.resolve({ data: null, error: { message: "boom" } }))
    ).rejects.toEqual({ message: "boom" });
  });
});

describe("fetchAllPagedResult — {data,error} drop-in (no throw)", () => {
  it("returns all rows with error=null on success", async () => {
    const all = Array.from({ length: 1500 }, (_, i) => ({ id: i }));
    const res = await fetchAllPagedResult<{ id: number }>(
      (from, to) => Promise.resolve({ data: all.slice(from, to + 1), error: null }),
      1000
    );
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(1500);
  });

  it("returns {data:null, error:{message}} on failure (preserving the message)", async () => {
    const res = await fetchAllPagedResult(() =>
      Promise.resolve({ data: null, error: { message: "nope" } })
    );
    expect(res.data).toBeNull();
    expect(res.error).toEqual({ message: "nope" });
  });
});
