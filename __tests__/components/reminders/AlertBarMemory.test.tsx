// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

// The alert strip under the top bar arrives a moment after the page and used
// to push the whole page down (phone layout shift, 2026-10-07). Each section's
// strip is remembered on the device as it last stood, drawn from the first
// paint, and the real one takes its place without anything moving.

const route = vi.hoisted(() => ({ path: "/projects" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.path }));

const store = vi.hoisted(() => ({ alerts: null as unknown[] | null, error: null as string | null }));
vi.mock("@/lib/ui/alert-bar-store", () => ({
  useAlertBarAlerts: () => ({ alerts: store.alerts, error: store.error, loading: false }),
  refreshAlertBarAlerts: () => {},
}));

import { AlertBar } from "@/components/reminders/AlertBar";
import { ALERT_BAR_MEMORY_COOKIE, parseAlertBarMemory, rememberAlertBar } from "@/lib/ui/alert-bar-memory";

const cookieValue = () =>
  document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${ALERT_BAR_MEMORY_COOKIE}=`))
    ?.slice(ALERT_BAR_MEMORY_COOKIE.length + 1);

function clearCookie() {
  document.cookie = `${ALERT_BAR_MEMORY_COOKIE}=; path=/; max-age=0`;
}

const alert = (id: string, level: "danger" | "warning" | "info", module = "projects") => ({
  id,
  level,
  module,
  title: `התראה ${id}`,
  href: "/projects",
  entityType: "summary",
  reminderIds: [],
  dueAt: null,
});

describe("the alert strip's memory", () => {
  beforeEach(() => {
    clearCookie();
    sessionStorage.clear();
    route.path = "/projects";
    store.alerts = null;
    store.error = null;
  });
  afterEach(() => cleanup());

  it("reads only well-formed entries", () => {
    expect(parseAlertBarMemory("projects.warning.1,sales.danger.3")).toEqual({
      projects: { level: "warning", count: 1 },
      sales: { level: "danger", count: 3 },
    });
    expect(parseAlertBarMemory(encodeURIComponent("tasks.info.2"))).toEqual({ tasks: { level: "info", count: 2 } });
    expect(parseAlertBarMemory("x.loud.1,y.warning.0,../etc.info.1,z.info.abc")).toEqual({});
    expect(parseAlertBarMemory(undefined)).toEqual({});
  });

  it("remembers a section's strip, and forgets it when it's gone", () => {
    rememberAlertBar("projects", { level: "warning", count: 1 });
    rememberAlertBar("sales", { level: "danger", count: 2 });
    expect(parseAlertBarMemory(cookieValue())).toEqual({
      projects: { level: "warning", count: 1 },
      sales: { level: "danger", count: 2 },
    });
    rememberAlertBar("projects", null);
    expect(parseAlertBarMemory(cookieValue())).toEqual({ sales: { level: "danger", count: 2 } });
  });

  it("before the alerts arrive: the strip as it last stood, in its place", () => {
    const { container } = render(<AlertBar remembered={{ projects: { level: "warning", count: 1 } }} />);
    expect(container.textContent).toContain("1 לטיפול");
  });

  it("nothing remembered for this section, or the alerts failed to load: no strip", () => {
    const { container, rerender } = render(<AlertBar remembered={{ sales: { level: "warning", count: 1 } }} />);
    expect(container.textContent).toBe("");
    store.error = "טעינת ההתראות נכשלה.";
    rerender(<AlertBar remembered={{ projects: { level: "warning", count: 1 } }} />);
    expect(container.textContent).toBe("");
  });

  it("once they arrive: the real strip, and the memory follows it", async () => {
    store.alerts = [alert("a1", "danger"), alert("a2", "warning"), alert("a3", "danger", "sales")];
    const { container, rerender } = render(<AlertBar remembered={{ projects: { level: "warning", count: 1 } }} />);
    expect(container.textContent).toContain("1 באיחור");
    expect(parseAlertBarMemory(cookieValue())).toEqual({ projects: { level: "danger", count: 1 } });

    store.alerts = [];
    await act(async () => rerender(<AlertBar remembered={{ projects: { level: "warning", count: 1 } }} />));
    expect(container.textContent).toBe("");
    expect(parseAlertBarMemory(cookieValue())).toEqual({});
  });
});
