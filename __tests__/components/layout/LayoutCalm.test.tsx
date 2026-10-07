// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

// Calmer loading on phones. (1) Each dashboard card remembers how tall it
// last stood on this device (a cookie the server reads), so its placeholder is
// that tall and the card fills a box already the right size. (2) What still
// jumps is reported: for each page opened, the shifts in its first seconds
// that nobody caused, the biggest ones with what moved.

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("@/lib/sentry-lazy", () => ({ withSentry: (run: (s: typeof sentry) => void) => run(sentry) }));
const nav = vi.hoisted(() => ({ pathname: "/projects/11111111-2222-4333-8444-555555555555", start: 0 }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("@/lib/ui/navigation-timing", () => ({ installNavigationTiming: () => {}, lastNavigationStart: () => nav.start }));

import { HELD_HEIGHTS_COOKIE, parseHeldHeights, rememberHeldHeight } from "@/lib/ui/held-heights";

const clearCookie = () => (document.cookie = `${HELD_HEIGHTS_COOKIE}=; path=/; max-age=0`);

describe("remembered card heights", () => {
  beforeEach(() => {
    clearCookie();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  });

  it("kept per card on a phone (rounded), read back by the server", () => {
    rememberHeldHeight("myTasks", 281);
    rememberHeldHeight("todaySchedule", 402);
    const raw = document.cookie.split("; ").find((c) => c.startsWith(`${HELD_HEIGHTS_COOKIE}=`))!.split("=")[1];
    expect(parseHeldHeights(raw)).toEqual({ myTasks: 280, todaySchedule: 404 });
  });

  it("never on the desktop layout (fixed cells there), never nonsense", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    rememberHeldHeight("myTasks", 300);
    expect(document.cookie).not.toContain(HELD_HEIGHTS_COOKIE);
    expect(parseHeldHeights("myTasks:12;bad id:300;deliveries:9999;payments:abc;todayAlerts:120")).toEqual({ todayAlerts: 120 });
  });
});

describe("the layout shift report", () => {
  type Callback = (list: { getEntries: () => unknown[] }) => void;
  let feed: Callback = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    sentry.captureMessage.mockReset();
    localStorage.clear();
    class FakeObserver {
      static supportedEntryTypes = ["layout-shift"];
      constructor(callback: Callback) {
        feed = callback;
      }
      observe() {}
    }
    vi.stubGlobal("PerformanceObserver", FakeObserver);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a page that jumped while loading: the biggest shifts, with what moved", async () => {
    const { default: LayoutShiftReport } = await import("@/components/layout/LayoutShiftReport");
    render(<LayoutShiftReport />);
    const card = document.createElement("div");
    card.className = "rounded-xl border bg-card";
    card.textContent = "משימות שלי";
    const rect = (y: number, height: number) => ({ y, height }) as DOMRectReadOnly;
    act(() =>
      feed({
        getEntries: () => [
          { startTime: 900, value: 0.42, hadRecentInput: false, sources: [{ node: card, previousRect: rect(200, 64), currentRect: rect(480, 64) }] },
          { startTime: 1200, value: 0.3, hadRecentInput: true, sources: [] }, // the person tapped: not counted
          { startTime: 1500, value: 0.1, hadRecentInput: false, sources: [] },
        ],
      })
    );
    await act(async () => vi.advanceTimersByTime(8000));
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [title, report] = sentry.captureMessage.mock.calls[0];
    expect(title).toBe("Layout shift");
    expect(report.tags).toMatchObject({ shift_page: "/projects/[id]", shift_screen: "phone", shift_load: "full" });
    expect(report.extra.total).toBe(0.52);
    expect(report.extra.shifts[0]).toBe('0.42 at 900ms: div.rounded-xl.border.bg-card "משימות שלי" ↓280px');
    expect(report.extra.shifts[1]).toBe("0.1 at 1500ms: (nothing named)");
  });
});
