// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markDeliveryConfirmed, useConfirmedDeliveries } from "@/lib/orders/confirmed-deliveries";

// An order confirmed as delivered on this phone leaves the deliveries lists at
// once — even while the confirmation waits for a connection — so it can't be
// confirmed (and paid) twice (owner, 2026-10-11).
describe("confirmed deliveries", () => {
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("an order marked delivered is in the set at once", () => {
    const { result } = renderHook(() => useConfirmedDeliveries());
    expect(result.current.has("order-1")).toBe(false);
    act(() => markDeliveryConfirmed("order-1"));
    expect(result.current.has("order-1")).toBe(true);
  });

  it("forgets a mark after three days — by then the server's lists have it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T08:00:00Z"));
    markDeliveryConfirmed("order-2");
    vi.setSystemTime(new Date("2026-10-14T09:00:00Z"));
    const { result } = renderHook(() => useConfirmedDeliveries());
    expect(result.current.has("order-2")).toBe(false);
  });
});
