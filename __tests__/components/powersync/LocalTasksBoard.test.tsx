// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

// The device version of the tasks board: the board the device worked out, a
// narrowed board while new filters are worked out, live updates when the copy
// changes, and the server version when the copy can't serve it.

// Next's router is one object for the page's life — so is this one.
const nav = vi.hoisted(() => {
  const replace = vi.fn();
  return { replace, router: { replace }, search: "" };
});
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const device = vi.hoisted(() => ({
  users: 3,
  onChange: null as null | ((event: { changedTables: string[] }) => void),
  db: null as unknown,
}));
vi.mock("@/lib/powersync/store", () => ({
  useLocalDatabase: () => device.db,
  useLocalSyncStatus: () => ({ hasSynced: true }),
}));
vi.mock("@/lib/sentry-lazy", () => ({ withSentry: () => {} }));

const computeLocalCard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/powersync/dashboard-local", () => ({
  computeLocalCard,
  LOCAL_CARD_TABLES: { tasksBoard: ["tasks"] },
}));
vi.mock("@/lib/powersync/local-supabase", () => ({ createLocalSupabase: () => ({}), LOCAL_TABLES: new Set(["tasks"]) }));

// The board itself is the server version's component; here it just lists what it was given.
vi.mock("@/app/(app)/tasks/TasksPageClient", () => ({
  default: (props: { tasks: Array<{ id: string }>; customers: Array<{ label: string }> }) => (
    <div>
      <ul aria-label="board">
        {props.tasks.map((t) => (
          <li key={t.id}>{t.id}</li>
        ))}
      </ul>
      <span>{props.customers.map((c) => c.label).join(",")}</span>
    </div>
  ),
}));

import LocalTasksBoard from "@/app/(app)/tasks/LocalTasksBoard";
import { resultKey } from "@/lib/powersync/local-results";
import { storeResult } from "@/lib/powersync/stored-results";

const viewer = { userId: "me", role: "admin", locale: "he" as const };
const allFilters = { q: "", priority: "", domain: "", linkedId: "", scope: "all" as const };
const task = (id: string, priority: string) => ({
  id, subject: id, subject_he: null, subject_ar: null, status: "todo", priority, due_date: null, due_time: null,
  city: null, business_domain: null, project_id: null, property_id: null, customer_id: null, project_name: null,
  property_name: null, customer_name: null, customer_phone: null, assigned_user_id: "me", assigned_user_name: null,
  members: [], comment_count: 0, attachment_count: 0, has_open_reminder: false, is_overdue: false, is_private: false,
  sort_order: null,
});
const options = { projects: [], properties: [], customers: [{ id: "c1", label: "לקוח" }], users: [] };

const shown = () => screen.queryAllByRole("listitem").map((li) => li.textContent);
const flush = () => act(async () => {});

describe("LocalTasksBoard", () => {
  beforeEach(() => {
    localStorage.clear(); // a fresh device: nothing stored from the last test
    nav.replace.mockReset();
    nav.search = "scope=all";
    computeLocalCard.mockReset();
    device.onChange = null;
    device.db = {
      get: async () => ({ n: device.users }),
      onChange: (handler: { onChange: (event: { changedTables: string[] }) => void }) => {
        device.onChange = handler.onChange;
        return () => {};
      },
    };
  });

  // First: a "yes, there is data" is remembered for the page load.
  it("goes to the server version when the copy holds nothing yet (rules not deployed)", async () => {
    device.users = 0;
    render(<LocalTasksBoard viewer={viewer} filters={allFilters} canSeeAll />);
    await flush();
    expect(computeLocalCard).not.toHaveBeenCalled();
    expect(nav.replace).toHaveBeenCalledWith("/tasks?scope=all&data=server");
    device.users = 3;
  });

  it("draws the board and its pickers from the device, then keeps it up to date", async () => {
    computeLocalCard.mockImplementation(async (_local, _kind, _viewer, filters) => ({
      filters,
      items: [task("t1", "high")],
      options,
    }));
    render(<LocalTasksBoard viewer={viewer} filters={allFilters} canSeeAll />);
    await flush();
    expect(shown()).toEqual(["t1"]);
    expect(screen.getByText("לקוח")).toBeTruthy();
    expect(computeLocalCard).toHaveBeenCalledWith(expect.anything(), "tasksBoard", viewer, allFilters);

    // A save synced back (PowerSync names the changed table): the board is
    // worked out again, by itself, a moment later.
    computeLocalCard.mockImplementation(async (_local, _kind, _viewer, filters) => ({
      filters,
      items: [task("t1", "high"), task("t2", "low")],
      options,
    }));
    await act(async () => {
      device.onChange?.({ changedTables: ["ps_data__tasks"] });
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(shown()).toEqual(["t1", "t2"]);
  });

  it("new filters: the board already here, narrowed, until the device's board for them is ready", async () => {
    computeLocalCard.mockImplementation(async (_local, _kind, _viewer, filters) => ({
      filters,
      items: [task("t1", "high"), task("t2", "low")],
      options,
    }));
    const { rerender } = render(<LocalTasksBoard viewer={viewer} filters={allFilters} canSeeAll />);
    await flush();
    expect(shown()).toEqual(["t1", "t2"]);

    let finish: (value: unknown) => void = () => {};
    computeLocalCard.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const highOnly = { ...allFilters, priority: "high" };
    rerender(<LocalTasksBoard viewer={viewer} filters={highOnly} canSeeAll />);
    expect(shown()).toEqual(["t1"]);
    await flush(); // the device starts on the new filters
    expect(shown()).toEqual(["t1"]);

    await act(async () => finish({ filters: highOnly, items: [task("t1", "high"), task("t3", "high")], options }));
    expect(shown()).toEqual(["t1", "t3"]);
  });

  it("goes to the server version when the device can't work it out", async () => {
    computeLocalCard.mockRejectedValue(new Error("Table x isn't synced to the device"));
    render(<LocalTasksBoard viewer={viewer} filters={allFilters} canSeeAll />);
    await flush();
    expect(nav.replace).toHaveBeenCalledWith("/tasks?scope=all&data=server");
    expect(shown()).toEqual([]);
  });

  it("right after the app opens, the board stored last time shows before the device database is ready", async () => {
    localStorage.clear();
    storeResult(resultKey({ kind: "tasksBoard", viewer, filters: allFilters }), {
      filters: allFilters,
      items: [task("t9", "high")],
      options,
    });
    device.db = null; // not open yet
    render(<LocalTasksBoard viewer={viewer} filters={allFilters} canSeeAll />);
    expect(shown()).toEqual(["t9"]);
    expect(computeLocalCard).not.toHaveBeenCalled();
    localStorage.clear();
  });
});
