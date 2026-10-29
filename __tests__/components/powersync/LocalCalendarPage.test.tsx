// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

// The device version of the calendar (owner, 2026-10-29: "yes go build 1-3"):
// the placeholder until the device has worked the feeds out, then the
// calendar with mine and everyone's; worked out again by itself when a task
// changes; the server version when the copy can't serve it.

const nav = vi.hoisted(() => {
  const replace = vi.fn();
  return { replace, router: { replace } };
});
vi.mock("next/navigation", () => ({ useRouter: () => nav.router }));

const device = vi.hoisted(() => ({
  users: 3,
  onChange: null as null | ((event: { changedTables: string[] }) => void),
  db: null as unknown,
  status: { hasSynced: true } as { hasSynced: boolean } | null,
}));
vi.mock("@/lib/powersync/store", () => ({
  useLocalDatabase: () => device.db,
  useLocalSyncStatus: () => device.status,
  useLocalCopyBehind: () => false,
}));
vi.mock("@/lib/sentry-lazy", () => ({ withSentry: () => {} }));

const computeLocalCard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/powersync/dashboard-local", () => ({
  computeLocalCard,
  LOCAL_CARD_TABLES: { calendar: ["tasks"] },
}));
vi.mock("@/lib/powersync/local-supabase", () => ({ createLocalSupabase: () => ({}), LOCAL_TABLES: new Set(["tasks"]) }));

// The calendar itself is the server version's component; here it lists what it was given.
vi.mock("@/app/(app)/calendar/CalendarSection", () => ({
  default: (props: { entries: Array<{ id: string }>; allEntries: Array<{ id: string }> | null; todayIso: string }) => (
    <div>
      <ul aria-label="mine">
        {props.entries.map((e) => (
          <li key={e.id}>{e.id}</li>
        ))}
      </ul>
      <span data-testid="all">{props.allEntries ? props.allEntries.map((e) => e.id).join(",") : "none"}</span>
      <span data-testid="today">{props.todayIso}</span>
    </div>
  ),
}));
vi.mock("@/app/(app)/calendar/CalendarSkeleton", () => ({ default: () => <div>placeholder</div> }));

import LocalCalendarPage from "@/app/(app)/calendar/LocalCalendarPage";

const viewer = { userId: "me", role: "admin", locale: "he" as const };
const entry = (id: string) => ({
  id, kind: "task", title: id, subtitle: "", href: `/tasks/${id}`, startDate: "2026-11-02", endDate: "2026-11-02", status: "todo", priority: null,
});
const mine = () => screen.queryAllByRole("listitem").map((li) => li.textContent);
const flush = () => act(async () => {});

describe("LocalCalendarPage", () => {
  beforeEach(() => {
    localStorage.clear();
    nav.replace.mockReset();
    computeLocalCard.mockReset();
    device.onChange = null;
    device.status = { hasSynced: true };
    device.users = 3;
    document.cookie = "bizh-device-pending=; path=/; max-age=0";
    device.db = {
      get: async () => ({ n: device.users }),
      onChange: (handler: { onChange: (event: { changedTables: string[] }) => void }) => {
        device.onChange = handler.onChange;
        return () => {};
      },
    };
  });

  it("the placeholder, then the calendar from the device — mine and everyone's", async () => {
    let finish: (value: unknown) => void = () => {};
    computeLocalCard.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    render(<LocalCalendarPage viewer={viewer} />);
    expect(screen.getByText("placeholder")).toBeTruthy();
    await flush();
    expect(computeLocalCard).toHaveBeenCalled();
    expect(screen.getByText("placeholder")).toBeTruthy();
    await act(async () => {
      finish({ mine: [entry("t1")], all: [entry("t1"), entry("t2")] });
    });
    expect(mine()).toEqual(["t1"]);
    expect(screen.getByTestId("all").textContent).toBe("t1,t2");
    expect(screen.getByTestId("today").textContent).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(computeLocalCard).toHaveBeenCalledWith(expect.anything(), "calendar", viewer, undefined);
  });

  it("a task saved and synced back: worked out again by itself", async () => {
    computeLocalCard.mockResolvedValue({ mine: [entry("t1")], all: null });
    render(<LocalCalendarPage viewer={viewer} />);
    await flush();
    expect(mine()).toEqual(["t1"]);
    computeLocalCard.mockResolvedValue({ mine: [entry("t1"), entry("t3")], all: null });
    await act(async () => {
      device.onChange?.({ changedTables: ["ps_data__tasks"] });
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(mine()).toEqual(["t1", "t3"]);
  });

  it("a copy that holds nothing yet: the server version", async () => {
    device.users = 0;
    render(<LocalCalendarPage viewer={viewer} />);
    await flush();
    expect(nav.replace).toHaveBeenCalledWith("/calendar?data=server");
  });
});
