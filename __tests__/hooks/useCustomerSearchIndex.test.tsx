// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// Every customer for the search, read once per session. A page that only
// needs it when you search (the customers list) defers it until the page has
// settled — or loads it the moment its search box is used (`load()`), rather
// than competing with the page's own first load.

const { fetchSearchIndex } = vi.hoisted(() => ({ fetchSearchIndex: vi.fn() }));
vi.mock("@/lib/search/fetchSearchIndex", () => ({ fetchSearchIndex }));
vi.mock("@/lib/offline-cache", () => ({ saveSnapshot: vi.fn(async () => {}), loadSnapshot: vi.fn(async () => null) }));

import { useCustomerSearchIndex } from "@/hooks/useCustomerSearchIndex";

describe("useCustomerSearchIndex — deferred", () => {
  it("waits, then loads at once when asked", async () => {
    fetchSearchIndex.mockResolvedValue([{ id: "c1", name: "אבי" }]);
    const { result } = renderHook(() => useCustomerSearchIndex({ deferUntilIdle: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchSearchIndex).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);

    act(() => result.current.load());
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(fetchSearchIndex).toHaveBeenCalledWith("customers");
    expect(result.current.loading).toBe(false);
  });
});
