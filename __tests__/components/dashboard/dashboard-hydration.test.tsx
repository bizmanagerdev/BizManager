// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { Suspense, lazy, type ComponentProps, type ComponentType, type ReactElement } from "react";

// The dashboard's cards as the browser takes over the server's HTML: the first
// browser render must produce exactly what the server rendered, or React throws
// that HTML away (a text mismatch) or leaves it wrong (an attribute mismatch).
// Both used to happen on /dashboard (2026-10-11).

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));

import { Cell } from "@/app/(app)/dashboard/DashboardSections";
import MyTasksPanel from "@/components/dashboard/MyTasksPanel";
import AttendanceApprovals from "@/components/dashboard/AttendanceApprovals";
import type { DashboardTask } from "@/lib/dashboard/tasks-overview";
import type { PhoneQueueData } from "@/lib/attendance/phone-reports";

let root: Root | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The server's HTML, hydrated by `client`; everything React reported on the way. */
async function hydrate(serverHtml: string, client: ReactElement) {
  const container = document.createElement("div");
  container.innerHTML = serverHtml;
  document.body.appendChild(container);
  const reported: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args) => reported.push(args.map(String).join(" ")));
  root = hydrateRoot(container, client, { onRecoverableError: (error) => reported.push(String(error)) });
  // Hydration runs in the background; let it finish, lazy modules and all.
  await new Promise((resolve) => setTimeout(resolve, 150));
  return { container, reported };
}

function task(id: string): DashboardTask {
  return {
    id,
    subject: `משימה ${id}`,
    subject_he: null,
    subject_ar: null,
    due_date: null,
    due_time: null,
    priority: null,
    status: "todo",
    sort_order: null,
    project_name: null,
    overdue: false,
  };
}

describe("המשימות שלי in its board cell", () => {
  it("hydrates with the server's menu ids while the card's code is still arriving", async () => {
    const tasks = [task("a"), task("b"), task("c")];
    // Two cells, as the board's secondary row lists them.
    const board = (card: ReactElement) => (
      <Suspense fallback={null}>
        <div>
          {[
            <Cell key="todayAlerts" item={{ id: "todayAlerts", rank: 0, node: <div>התראות</div> }} fill order={1} />,
            <Cell key="myTasks" item={{ id: "myTasks", rank: 1, node: card }} fill order={2} />,
          ]}
        </div>
      </Suspense>
    );
    const html = renderToString(board(<MyTasksPanel tasks={tasks} locale="he" />));
    expect(html.match(/id="radix-/g)).toHaveLength(3);

    // In the browser a card is a client component whose code may still be
    // loading when hydration reaches it — React waits for it and picks up again.
    type Props = ComponentProps<typeof MyTasksPanel>;
    let requested = false;
    const LoadingPanel = lazy(
      () =>
        new Promise<{ default: ComponentType<Props> }>((resolve) => {
          requested = true;
          queueMicrotask(() => resolve({ default: MyTasksPanel }));
        })
    );
    const { container, reported } = await hydrate(html, board(<LoadingPanel tasks={tasks} locale="he" />));

    expect(requested).toBe(true);
    expect(reported).toEqual([]);
    expect(container.querySelectorAll('button[id^="radix-"]')).toHaveLength(3);
  });
});

describe("נוכחות עובדים — who's on shift", () => {
  const CLOCK_IN = "2026-10-11T05:00:00.000Z";
  const data: PhoneQueueData = {
    pending: [],
    open: [
      {
        id: "r1",
        user_id: "u1",
        worker_name: "משה כהן",
        worker_phone: null,
        worker_avatar_color: null,
        clock_in: CLOCK_IN,
        created_at: CLOCK_IN,
        source: "phone",
        notes: null,
        notes_he: null,
        reported_by_name: null,
      },
    ],
  };

  it("first paints the hours the server drew, then the device's own clock", async () => {
    // Fakes the clock only; React's own timers stay real.
    vi.useFakeTimers({ toFake: ["Date"] });
    const serverTime = new Date("2026-10-11T14:00:20.000Z").getTime(); // 9:00 on shift
    vi.setSystemTime(serverTime);
    const card = (
      <AttendanceApprovals data={data} projectOptions={[]} propertyOptions={[]} locale="he" renderedAt={serverTime} />
    );
    const html = renderToString(<Suspense fallback={null}>{card}</Suspense>);
    expect(html).toContain("9:00");

    // The browser hydrates a minute later.
    vi.setSystemTime(serverTime + 60_000);
    const { container, reported } = await hydrate(html, <Suspense fallback={null}>{card}</Suspense>);

    expect(reported).toEqual([]);
    expect(container.textContent).toContain("9:01");
  });
});
