// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// "offline action permanently failed" names the saves given up on (the
// queue's note of each) and the first one's address as a tag to search by.

const { sentry } = vi.hoisted(() => ({ sentry: { captureMessage: vi.fn(), addBreadcrumb: vi.fn() } }));
vi.mock("@/lib/sentry-lazy", () => ({ withSentry: (report: (s: typeof sentry) => void) => report(sentry) }));

import ConnectionTelemetry from "@/components/pwa/ConnectionTelemetry";
import { CONNECTION_EVENTS } from "@/lib/offline-queue";

afterEach(() => {
  cleanup();
  sentry.captureMessage.mockReset();
});

describe("ConnectionTelemetry", () => {
  it("reports which saves were given up on, and why", () => {
    render(<ConnectionTelemetry />);
    const items = [{ label: "סיום המשמרת", path: "/api/attendance/my/close", status: 404, error: "אין לך משמרת פתוחה." }];
    window.dispatchEvent(new CustomEvent(CONNECTION_EVENTS.failed, { detail: { count: 1, items } }));

    expect(sentry.captureMessage).toHaveBeenCalledWith("offline action permanently failed", {
      level: "warning",
      tags: { area: "offline", offline_path: "/api/attendance/my/close" },
      extra: { count: 1, items },
    });
  });

  it("still reports a failure that comes with a count only (files)", () => {
    render(<ConnectionTelemetry />);
    window.dispatchEvent(new CustomEvent(CONNECTION_EVENTS.failed, { detail: { count: 2 } }));

    expect(sentry.captureMessage).toHaveBeenCalledWith("offline action permanently failed", {
      level: "warning",
      tags: { area: "offline" },
      extra: { count: 2, items: undefined },
    });
  });
});
