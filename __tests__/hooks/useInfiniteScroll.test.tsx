// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { useEffect } from "react";

const net = vi.hoisted(() => ({ online: true }));
vi.mock("@/hooks/useOfflineRows", () => ({ useOnline: () => net.online }));

import { LOAD_RETRY_PAUSE_MS, STALE_FIRST_PAGE_MS, useInfiniteScroll } from "@/hooks/useInfiniteScroll";

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

// The bottom of a list asking for its next page. The sentinel is usually
// still on screen after a page fails, so asking again at once looped as fast
// as the requests could fail — with no connection, forever. Now a failure
// stops the asking until "try again", the connection coming back, or a pause;
// with no connection nothing is asked at all; and only one page is asked for
// at a time.

const observers = vi.hoisted(() => ({ live: [] as Array<{ callback: IntersectionObserverCallback; on: boolean }> }));
beforeAll(() => {
  class FakeObserver {
    record: { callback: IntersectionObserverCallback; on: boolean };
    constructor(callback: IntersectionObserverCallback) {
      this.record = { callback, on: true };
      observers.live.push(this.record);
    }
    observe() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
    disconnect() {
      this.record.on = false;
    }
  }
  // @ts-expect-error - test stand-in
  window.IntersectionObserver = FakeObserver;
});
beforeEach(() => {
  observers.live = [];
  net.online = true;
});
afterEach(() => {
  vi.useRealTimers();
});

function sentinelOnScreen() {
  act(() => {
    for (const record of observers.live.filter((r) => r.on)) {
      record.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    }
  });
}

type Hook = Pick<ReturnType<typeof useInfiniteScroll<Row>>, "rows" | "error" | "offline" | "retry">;
function mountList(fetchPage: (page: number) => Promise<{ rows: Row[]; hasMore: boolean }>, enabled = true) {
  const latest: { hook: Hook | null } = { hook: null };
  function Harness({ on }: { on: boolean }) {
    const { sentinelRef, rows, error, offline, retry } = useInfiniteScroll<Row>({
      initialRows: SERVER_ROWS,
      initialHasMore: true,
      fetchPage,
      getId,
      enabled: on,
    });
    useEffect(() => {
      latest.hook = { rows, error, offline, retry };
    });
    return <div ref={sentinelRef} />;
  }
  const view = render(<Harness on={enabled} />);
  return { latest, rerender: (on: boolean) => view.rerender(<Harness on={on} />) };
}

describe("useInfiniteScroll — the next page", () => {
  it("a failed page stops the asking, in Hebrew, until retry()", async () => {
    const fetchPage = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ rows: [{ id: "c" }], hasMore: false });
    const { latest } = mountList(fetchPage);
    sentinelOnScreen();
    await waitFor(() => expect(latest.hook?.error).toBeTruthy());
    expect(latest.hook?.error).toMatch(/[א-ת]/);
    sentinelOnScreen();
    sentinelOnScreen();
    expect(fetchPage).toHaveBeenCalledTimes(1);

    act(() => latest.hook!.retry());
    await waitFor(() => expect(latest.hook?.rows.map(getId)).toEqual(["a", "b", "c"]));
    expect(fetchPage).toHaveBeenLastCalledWith(2);
    expect(latest.hook?.error).toBeNull();
  });

  it("asks again by itself after a pause", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchPage = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue({ rows: [], hasMore: false });
    const { latest } = mountList(fetchPage);
    sentinelOnScreen();
    await waitFor(() => expect(latest.hook?.error).toBeTruthy());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOAD_RETRY_PAUSE_MS + 10);
    });
    sentinelOnScreen();
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
  });

  it("with no connection asks for nothing, and says so", () => {
    net.online = false;
    const fetchPage = vi.fn();
    const { latest } = mountList(fetchPage);
    sentinelOnScreen();
    expect(fetchPage).not.toHaveBeenCalled();
    expect(latest.hook?.offline).toBe(true);
  });

  it("asks for one page at a time", async () => {
    let release: () => void = () => {};
    const fetchPage = vi.fn(
      () =>
        new Promise<{ rows: Row[]; hasMore: boolean }>((resolve) => {
          release = () => resolve({ rows: [{ id: "c" }], hasMore: true });
        })
    );
    mountList(fetchPage);
    // Both sentinels (the table's and the cards') can report in the same moment.
    sentinelOnScreen();
    sentinelOnScreen();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await act(async () => release());
  });

  it("a list turned off doesn't watch its sentinel; turned on, it does", async () => {
    const fetchPage = vi.fn(async () => ({ rows: [], hasMore: false }));
    const { rerender } = mountList(fetchPage, false);
    sentinelOnScreen();
    expect(fetchPage).not.toHaveBeenCalled();
    rerender(true);
    sentinelOnScreen();
    await waitFor(() => expect(fetchPage).toHaveBeenCalledWith(2));
  });
});
