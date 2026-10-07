// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// The device pages' timing report and frame marker: a report says where the
// time went and is sent at most a few times a day per page; a page shown from
// a saved frame refreshes its server parts, a fresh one doesn't.

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("@/lib/sentry-lazy", () => ({ withSentry: (fn: (s: typeof sentry) => void) => fn(sentry) }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const nav = vi.hoisted(() => ({ start: 0 }));
vi.mock("@/lib/ui/navigation-timing", () => ({ lastNavigationStart: () => nav.start }));

import { reportPageTiming } from "@/lib/powersync/page-timing";
import DeviceFrameMark from "@/components/powersync/DeviceFrameMark";

describe("the device pages' timing report", () => {
  beforeEach(() => {
    localStorage.clear();
    sentry.captureMessage.mockReset();
  });

  it("reports where the time went, at most ten times a day per page", () => {
    for (let i = 0; i < 12; i += 1) {
      nav.start = 1000 * (i + 1); // a page change each time
      reportPageTiming({ page: "tasks", source: "device", committedAt: nav.start + 400, paintedAt: nav.start + 450, computeMs: 120.4, size: 240 });
    }
    expect(sentry.captureMessage).toHaveBeenCalledTimes(10);
    const [message, context] = sentry.captureMessage.mock.calls[0];
    expect(message).toBe("PowerSync page timing");
    expect(context.tags).toMatchObject({ area: "powersync", timing_page: "tasks", timing_source: "device", timing_load: "navigation" });
    expect(context.extra).toMatchObject({ totalMs: 450, paintMs: 50, computeMs: 120, size: 240 });

    reportPageTiming({ page: "sales:orders", source: "kept", committedAt: nav.start + 10, paintedAt: nav.start + 20 });
    expect(sentry.captureMessage).toHaveBeenCalledTimes(11);
  });

  it("app openings have their own, larger allowance — trying them again and again doesn't use up the moves'", () => {
    const today = new Date().toISOString().slice(0, 10);
    nav.start = 0; // an opening: the page load itself
    // The moves' ten are used up; the openings' aren't.
    localStorage.setItem(`bizh-timing:${today}:dashboard:myTasks:navigation`, "10");
    localStorage.setItem(`bizh-timing:${today}:dashboard:myTasks:full`, "29");
    reportPageTiming({ page: "dashboard:myTasks", source: "stored", committedAt: 400, paintedAt: 450 });
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(`bizh-timing:${today}:dashboard:myTasks:full`)).toBe("30");
    // Thirty openings: that's the day's.
    localStorage.setItem(`bizh-timing:${today}:dashboard:todayAlerts:full`, "30");
    reportPageTiming({ page: "dashboard:todayAlerts", source: "stored", committedAt: 400, paintedAt: 450 });
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it("an opening of the dashboard says when its picture went up", () => {
    nav.start = 0; // the page load itself
    window.__bizhPictureAt = 120.4;
    reportPageTiming({ page: "dashboard:deliveries", source: "stored", committedAt: 500, paintedAt: 520 });
    delete window.__bizhPictureAt;
    expect(sentry.captureMessage.mock.calls[0][1].extra).toMatchObject({ pictureMs: 120, totalMs: 520 });
  });

  it("a part drawn again later — after a save or a refresh — isn't a page opening", () => {
    nav.start = 50_000;
    reportPageTiming({ page: "dashboard:deliveries", source: "kept", committedAt: 50_100, paintedAt: 50_150 });
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    // Drawn again moments later for the same opening: not reported twice.
    reportPageTiming({ page: "dashboard:deliveries", source: "kept", committedAt: 52_000, paintedAt: 52_050 });
    // Minutes after the last tap (there was a 214 s "opening" like this): not an opening at all.
    reportPageTiming({ page: "dashboard:todaySchedule", source: "kept", committedAt: 264_000, paintedAt: 264_050 });
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
  });
});

describe("DeviceFrameMark", () => {
  beforeEach(() => {
    router.refresh.mockReset();
    sessionStorage.clear();
  });

  it("marks the page as a device frame; a fresh one isn't refreshed", () => {
    const { container } = render(<DeviceFrameMark page="tasks" renderedAt={Date.now()} />);
    expect(container.querySelector('[data-device-page="tasks"]')).not.toBeNull();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("the app opened on a saved frame (rendered long before): its server parts are refreshed — once a minute at most", () => {
    render(<DeviceFrameMark page="dashboard" renderedAt={Date.now() - 60 * 60 * 1000} />);
    render(<DeviceFrameMark page="dashboard" renderedAt={Date.now() - 60 * 60 * 1000} />);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("moving to a page the app loaded ahead (rendered after it opened) never refreshes", () => {
    render(<DeviceFrameMark page="tasks" renderedAt={performance.timeOrigin + 1000} />);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("offline: no refresh (it would only fail and reload)", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<DeviceFrameMark page="sales" renderedAt={Date.now() - 60 * 60 * 1000} />);
    expect(router.refresh).not.toHaveBeenCalled();
    online.mockRestore();
  });
});
