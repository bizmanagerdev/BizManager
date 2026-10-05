// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { STALE_FIRST_PAGE_MS, useInfiniteScroll } from "@/hooks/useInfiniteScroll";

// A list's first page can come from a copy Next fetched ahead of the click —
// the sales tabs and the nav prefetch whole pages. Shown at once either way;
// an aged one is then fetched again behind the scenes and swapped in.

type Row = { id: string };
const getId = (row: Row) => row.id;
const SERVER_ROWS: Row[] = [{ id: "a" }, { id: "b" }];

function setup(loadedAt: number | undefined) {
  const fetchPage = vi.fn(async () => ({ rows: [{ id: "new" }, { id: "a" }], hasMore: true }));
  const hook = renderHook(() =>
    useInfiniteScroll<Row>({ initialRows: SERVER_ROWS, initialHasMore: false, fetchPage, getId, loadedAt })
  );
  return { fetchPage, hook };
}

describe("useInfiniteScroll — an aged first page", () => {
  it("leaves a freshly read first page alone", async () => {
    const { fetchPage, hook } = setup(Date.now());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchPage).not.toHaveBeenCalled();
    expect(hook.result.current.rows).toBe(SERVER_ROWS);
  });

  it("shows an aged copy at once, then swaps in a fresh first page", async () => {
    const { fetchPage, hook } = setup(Date.now() - STALE_FIRST_PAGE_MS - 1_000);
    expect(hook.result.current.rows).toBe(SERVER_ROWS);
    await waitFor(() => expect(hook.result.current.rows.map(getId)).toEqual(["new", "a"]));
    expect(fetchPage).toHaveBeenCalledWith(1);
    expect(hook.result.current.hasMore).toBe(true);
  });

  it("never refetches a list that doesn't say when it was read", async () => {
    const { fetchPage } = setup(undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("keeps the copy on screen when the refetch fails", async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error("offline");
    });
    const hook = renderHook(() =>
      useInfiniteScroll<Row>({
        initialRows: SERVER_ROWS,
        initialHasMore: false,
        fetchPage,
        getId,
        loadedAt: Date.now() - STALE_FIRST_PAGE_MS - 1_000,
      })
    );
    await waitFor(() => expect(fetchPage).toHaveBeenCalled());
    expect(hook.result.current.rows).toBe(SERVER_ROWS);
    expect(hook.result.current.error).toBeNull();
  });
});
