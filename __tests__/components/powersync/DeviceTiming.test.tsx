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

import { reportPageTiming } from "@/lib/powersync/page-timing";
import DeviceFrameMark from "@/components/powersync/DeviceFrameMark";

describe("the device pages' timing report", () => {
  beforeEach(() => {
    localStorage.clear();
    sentry.captureMessage.mockReset();
  });

  it("reports where the time went, at most three times a day per page", () => {
    for (let i = 0; i < 5; i += 1) {
      reportPageTiming({ page: "tasks", source: "device", committedAt: 400, paintedAt: 450, computeMs: 120.4, size: 240 });
    }
    expect(sentry.captureMessage).toHaveBeenCalledTimes(3);
    const [message, context] = sentry.captureMessage.mock.calls[0];
    expect(message).toBe("PowerSync page timing");
    expect(context.tags).toMatchObject({ area: "powersync", timing_page: "tasks", timing_source: "device" });
    expect(context.extra).toMatchObject({ paintMs: 50, computeMs: 120, size: 240 });

    reportPageTiming({ page: "sales:orders", source: "kept", committedAt: 10, paintedAt: 20 });
    expect(sentry.captureMessage).toHaveBeenCalledTimes(4);
  });
});

describe("DeviceFrameMark", () => {
  beforeEach(() => router.refresh.mockReset());

  it("marks the page as a device frame; a fresh one isn't refreshed", () => {
    const { container } = render(<DeviceFrameMark page="tasks" renderedAt={Date.now()} />);
    expect(container.querySelector('[data-device-page="tasks"]')).not.toBeNull();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("shown from a saved frame (rendered long ago): its server parts are refreshed", () => {
    render(<DeviceFrameMark page="dashboard" renderedAt={Date.now() - 60 * 60 * 1000} />);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});
