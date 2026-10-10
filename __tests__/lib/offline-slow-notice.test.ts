// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECTION_EVENTS, slowNotice } from "@/lib/offline-queue";

// The "שומר..." notice is a loading toast, which never times out by itself —
// a slow save that then went through left it on screen for good. Every slow
// notice now ends with `settled`, which takes it away.
describe("slowNotice", () => {
  const seen: string[] = [];
  const record = (e: Event) => seen.push(e.type);

  beforeEach(() => {
    vi.useFakeTimers();
    seen.length = 0;
    window.addEventListener(CONNECTION_EVENTS.slow, record);
    window.addEventListener(CONNECTION_EVENTS.settled, record);
  });
  afterEach(() => {
    window.removeEventListener(CONNECTION_EVENTS.slow, record);
    window.removeEventListener(CONNECTION_EVENTS.settled, record);
    vi.useRealTimers();
  });

  it("a write answered in time says nothing", () => {
    const end = slowNotice("הזמנה", 4000);
    vi.advanceTimersByTime(3999);
    end();
    vi.advanceTimersByTime(5000);
    expect(seen).toEqual([]);
  });

  it("a slow write says slow, and settled when it's answered — once", () => {
    const end = slowNotice("הזמנה", 4000);
    vi.advanceTimersByTime(4000);
    expect(seen).toEqual([CONNECTION_EVENTS.slow]);
    end();
    end();
    expect(seen).toEqual([CONNECTION_EVENTS.slow, CONNECTION_EVENTS.settled]);
  });
});
