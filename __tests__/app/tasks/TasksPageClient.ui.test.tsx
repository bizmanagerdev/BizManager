// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";

// The tasks board (/tasks) as the person using it sees it: which list each
// card lands in, what the search and the filters do to the board, the inline
// "הוספת כרטיס", moving a card (the tick, the card menu, a drag), snoozing,
// deleting, and opening a card (?task=<id>). Everything that leaves the page
// is stubbed at its module boundary: the network (offlineFetch), the device
// copy (deviceTaskSaves / saveTaskSnooze), the undo window, the router, and
// the task dialog.

// The URL the page reads. One object per "navigation", like Next's own
// useSearchParams — a fresh one every render would look like a new URL.
// The router is one object too, as Next's is: the board's search handler
// depends on it, and the toolbar it hands the top bar depends on that — a new
// router every render re-registers the toolbar every render, which renders
// the board again ("Maximum update depth exceeded").
const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", async () => {
  const shared = await import("@/__tests__/mocks/next-navigation");
  const router = shared.useRouter();
  return { ...shared, useRouter: () => router, useSearchParams: () => nav.params };
});

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), toasts) }));

// The server path for every save on this page.
const net = vi.hoisted(() => ({ offlineFetch: vi.fn() }));
vi.mock("@/lib/offline-queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline-queue")>()),
  offlineFetch: net.offlineFetch,
}));

// The device copy (PowerSync): null = this device saves on the server.
type FakeDeviceSaves = { create: ReturnType<typeof vi.fn>; move: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
const device = vi.hoisted(() => ({
  saves: null as null | FakeDeviceSaves,
  saveTaskSnooze: vi.fn(),
}));
vi.mock("@/lib/tasks/device-task-saves", () => ({
  deviceTaskSaves: () => device.saves,
  saveTaskSnooze: device.saveTaskSnooze,
}));

// Delete and snooze go through the undo window: applied on screen at once,
// saved when the window closes. The window itself (a toast with "בטל" and a
// timer) is the undo engine's business — here each test closes it by hand,
// committing or undoing.
type DeferredAction = Parameters<typeof import("@/lib/undo-engine").scheduleDeferredAction>[0];
const undo = vi.hoisted(() => ({ actions: [] as DeferredAction[] }));
vi.mock("@/lib/undo-engine", () => ({
  scheduleDeferredAction: (args: DeferredAction) => {
    args.onApplyOptimistic();
    undo.actions.push(args);
  },
}));

// The task dialog is loaded through next/dynamic — the one thing on this page
// that does — so that's the boundary: a stand-in that shows which task is open
// and hands the test the dialog's callbacks.
type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string | null;
  prefill: { subject: string } | null;
  viewerRole?: string;
  onSaved: (created?: Record<string, unknown> | null) => void;
};
const dialog = vi.hoisted(() => ({ props: null as DialogProps | null }));
vi.mock("next/dynamic", () => ({
  default: () =>
    function TaskDialogStandIn(props: DialogProps) {
      dialog.props = props;
      if (!props.open) return null;
      return (
        <div role="dialog" aria-label={`משימה ${props.taskId}`}>
          <span>{props.prefill?.subject}</span>
          <button type="button" onClick={() => props.onOpenChange(false)}>
            סגירה
          </button>
        </div>
      );
    },
}));

// The clock's menu is a Radix dropdown (an open one stalls jsdom's timers);
// these tests are about what the board does with the answer, so the clock is
// a plain button that snoozes to a fixed morning, plus "back now" when lit.
// Like the real one, a click on it stops there — it doesn't open the card too.
const snooze = vi.hoisted(() => ({ until: "2026-10-20T05:00:00.000Z" }));
vi.mock("@/components/tasks/TaskSnoozeButton", () => ({
  TaskSnoozeButton: ({ snoozedUntil, onSnooze }: { snoozedUntil: string | null; onSnooze: (until: string | null) => void }) => (
    <span onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label={snoozedUntil ? "חוזרת בקרוב" : "לטיפול בהמשך"} onClick={() => onSnooze(snooze.until)} />
      {snoozedUntil ? <button type="button" aria-label="חזרה עכשיו" onClick={() => onSnooze(null)} /> : null}
    </span>
  ),
}));

// The filter pickers are SearchableSelects (a Radix Popover whose first open
// costs ~15-20s in jsdom — see searchable-select.test.tsx). Plain selects with
// the same value/onChange contract stand in for them.
vi.mock("@/components/financial/DomainSelect", () => ({
  DomainSelect: ({ value, onChange, emptyLabel }: { value: string; onChange: (v: string) => void; emptyLabel?: string }) => (
    <select aria-label="תחום" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      <option value="general_business">שוטף</option>
      <option value="logistics_projects">פרויקטים</option>
      <option value="property_management">ניהול נכסים</option>
    </select>
  ),
}));
vi.mock("@/components/projects/ProjectPicker", () => ({
  ProjectPicker: (props: { value: string; onChange: (v: string) => void; emptyLabel: string; projects: { id: string; label: string }[] }) => (
    <select aria-label="בחירת פרויקט" value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      <option value="">{props.emptyLabel}</option>
      {props.projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("@/components/ui/searchable-select", () => ({
  SearchableSelect: (props: {
    value: string;
    onChange: (v: string) => void;
    ariaLabel?: string;
    emptyOptionLabel?: string;
    options: { value: string; label: string }[];
  }) => (
    <select aria-label={props.ariaLabel} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      <option value="">{props.emptyOptionLabel}</option>
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

// dnd-kit's own DndContext runs underneath (the cards and lists need its
// context); the wrapper only keeps the board's drag handlers, so a test can
// finish a drag the way dnd-kit reports one — jsdom has no layout for its
// sensors and collision detection to measure. The overlay (the card under the
// finger) is shown whenever the board gives it something.
const dnd = vi.hoisted(() => ({
  onDragStart: null as null | ((event: DragStartEvent) => void),
  onDragEnd: null as null | ((event: DragEndEvent) => void),
}));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  const RealDndContext = actual.DndContext;
  return {
    ...actual,
    DndContext: (props: ComponentProps<typeof actual.DndContext>) => {
      dnd.onDragStart = props.onDragStart ?? null;
      dnd.onDragEnd = props.onDragEnd ?? null;
      return <RealDndContext {...props} />;
    },
    DragOverlay: ({ children }: { children?: ReactNode }) => <div data-testid="drag-overlay">{children}</div>,
  };
});

import { push, refresh, replace } from "@/__tests__/mocks/next-navigation";
import TasksPageClient from "@/app/(app)/tasks/TasksPageClient";
import type { TaskBoardItem } from "@/app/(app)/tasks/loadTasks";
import { PageTitleProvider, useHeaderToolbar } from "@/components/layout/page-title-context";
import { PAGE_HEADER_TOOLBAR_ID } from "@/components/layout/PageHeaderToolbar";
import { formatShortDate } from "@/lib/date";
import { israelDateKey } from "@/lib/timezone";

type Props = ComponentProps<typeof TasksPageClient>;

const ME = "u-me";
const OTHER = "u-other";
const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (days: number) => israelDateKey(new Date(Date.now() + days * DAY_MS));

function task(overrides: Partial<TaskBoardItem> & { id: string }): TaskBoardItem {
  return {
    subject: "משימה",
    subject_he: null,
    subject_ar: null,
    status: "todo",
    priority: "medium",
    due_date: null,
    due_time: null,
    city: null,
    business_domain: "general_business",
    project_id: null,
    property_id: null,
    customer_id: null,
    project_name: null,
    property_name: null,
    customer_name: null,
    customer_phone: null,
    assigned_user_id: ME,
    assigned_user_name: "אני",
    members: [],
    comment_count: 0,
    attachment_count: 0,
    has_open_reminder: false,
    is_overdue: false,
    is_private: false,
    sort_order: 100,
    snoozed_until: null,
    ...overrides,
  };
}

// A small board: two to-dos (one urgent), one under way, one done; nothing blocked.
function boardTasks(): TaskBoardItem[] {
  return [
    task({ id: "t1", subject: "להתקשר לספק", status: "todo", sort_order: 100 }),
    task({ id: "t2", subject: "להזמין חומרים", status: "todo", sort_order: 200, priority: "urgent" }),
    task({ id: "t3", subject: "לתקן ברז", status: "in_progress", sort_order: 100 }),
    task({ id: "t4", subject: "לשלוח חשבונית", status: "done", sort_order: 100 }),
  ];
}

// The app's top bar shows whatever the page registered with
// useSetHeaderToolbar — on a computer, the board's search, מסננים and
// משימות קבועות live there, not in the page.
function TopBar() {
  return <header>{useHeaderToolbar()}</header>;
}

function Board(props: Partial<Props>) {
  return (
    <PageTitleProvider>
      <TopBar />
      <TasksPageClient
        tasks={boardTasks()}
        projects={[]}
        properties={[]}
        customers={[]}
        users={[
          { id: ME, label: "אני" },
          { id: OTHER, label: "יוסי" },
        ]}
        currentUserId={ME}
        locale="he"
        {...props}
      />
    </PageTitleProvider>
  );
}

function renderBoard(props: Partial<Props> = {}, url = "") {
  // A stable array: a new one on every render would read as the server
  // sending a fresh board each time.
  const fixed = { ...props, tasks: props.tasks ?? boardTasks() };
  nav.params = new URLSearchParams(url);
  const view = render(<Board {...fixed} />);
  return {
    ...view,
    /** The URL moved and the server's board for it arrived — what follows router.push. */
    arrive(nextUrl: string, tasks: TaskBoardItem[]) {
      nav.params = new URLSearchParams(nextUrl);
      view.rerender(<Board {...fixed} tasks={tasks} />);
    },
  };
}

/** One list on the board, by status — data-column is how the board itself finds its lists. */
function list(status: string) {
  const node = document.querySelector<HTMLElement>(`[data-column="${status}"]`);
  if (!node) throw new Error(`no "${status}" list on the board`);
  return within(node);
}

/** The board's lists, in the order they're on screen. */
function listOrder() {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-column]")).map((node) => node.dataset.column);
}

/** A card, by its title (the card is a button: tap it to open the task). */
function card(subject: string) {
  // A search paints the matched words in their own <mark>, which can put a
  // space into the card's accessible name — compared without spaces.
  const bare = subject.replace(/\s+/g, "");
  return screen.getByRole("button", { name: (name) => name.replace(/\s+/g, "").includes(bare) });
}

/** Text a search painted — split by its yellow <mark>s, so matched as a whole. */
function painted(text: string) {
  return (_: string, element: Element | null) =>
    element?.textContent === text && !Array.from(element.children).some((child) => child.textContent === text);
}

// An open add box holds its text as the textarea's content — that's not a card.
const NOT_TYPED = { ignore: "script, style, textarea" };

/** Does `first` come before `second` on the page? (A list reads top to bottom.) */
function isAbove(first: string, second: string) {
  const a = screen.getByText(first, NOT_TYPED);
  return Boolean(a.compareDocumentPosition(screen.getByText(second, NOT_TYPED)) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** The sideways-scrolling row that holds the lists (the magnifier sizes it). */
function scroller() {
  return document.querySelector<HTMLElement>('[data-column="todo"]')!.parentElement!;
}

function filtersButton() {
  return screen.getByRole("button", { name: /^מסננים/ });
}

/** A filter field in the open panel, by its label (the panel is drawn twice: phone and computer). */
function filterField(label: string) {
  const field = screen.getAllByText(label)[0].parentElement!;
  return within(field).getByRole("combobox");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => act(async () => {});
const ok = { queued: false, ok: true, data: {} };
const failed = { queued: false, ok: false, status: 500, error: "server error" };

const originalMatchMedia = window.matchMedia;
function screenWidth(width: number) {
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    return { ...originalMatchMedia(query), matches: min ? width >= Number(min[1]) : false };
  }) as typeof window.matchMedia;
}

function rect(left: number, width: number): DOMRect {
  return { left, width, right: left + width, top: 0, bottom: 100, height: 100, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
}

beforeEach(() => {
  net.offlineFetch.mockReset();
  net.offlineFetch.mockResolvedValue(ok);
  device.saves = null;
  device.saveTaskSnooze.mockReset();
  toasts.success.mockClear();
  toasts.error.mockClear();
  push.mockClear();
  replace.mockClear();
  refresh.mockClear();
  undo.actions = [];
  dialog.props = null;
  localStorage.clear();
  // Nothing on this page may reach a real server.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("no network in tests");
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.matchMedia = originalMatchMedia;
  document.getElementById(PAGE_HEADER_TOOLBAR_ID)?.remove();
});

describe("the board's lists", () => {
  it("files each card in its own list, in the default order לביצוע / בתהליך / בוצע / חסום", () => {
    renderBoard();
    expect(listOrder()).toEqual(["todo", "in_progress", "done", "blocked"]);
    expect(list("todo").getByText("להתקשר לספק")).toBeInTheDocument();
    expect(list("todo").getByText("להזמין חומרים")).toBeInTheDocument();
    expect(list("in_progress").getByText("לתקן ברז")).toBeInTheDocument();
    expect(list("done").getByText("לשלוח חשבונית")).toBeInTheDocument();
    expect(list("todo").getByText("לביצוע")).toBeInTheDocument();
    expect(list("blocked").getByText("חסום")).toBeInTheDocument();
    // The count beside each list's name.
    expect(list("todo").getByText("2")).toBeInTheDocument();
    expect(list("blocked").getByText("0")).toBeInTheDocument();
  });

  it("says so in a list with nothing in it", () => {
    renderBoard();
    expect(list("blocked").getByText("אין משימות ברשימה הזו.")).toBeInTheDocument();
    expect(list("todo").queryByText("אין משימות ברשימה הזו.")).toBeNull();
  });

  it("an empty board: every list says it's empty", () => {
    renderBoard({ tasks: [] });
    for (const status of ["todo", "in_progress", "done", "blocked"]) {
      expect(list(status).getByText("אין משימות ברשימה הזו.")).toBeInTheDocument();
    }
  });

  it("a task with no status, or one the board has no list for (cancelled), goes to לביצוע", () => {
    renderBoard({
      tasks: [
        task({ id: "a", subject: "בלי סטטוס", status: null }),
        task({ id: "b", subject: "בוטלה", status: "cancelled" }),
      ],
    });
    expect(list("todo").getByText("בלי סטטוס")).toBeInTheDocument();
    expect(list("todo").getByText("בוטלה")).toBeInTheDocument();
  });

  it("orders a list by sort_order (a card nobody placed goes last), not by the order the server sent", () => {
    renderBoard({
      tasks: [
        task({ id: "a", subject: "שלישית", sort_order: null }),
        task({ id: "b", subject: "שנייה", sort_order: 50 }),
        task({ id: "c", subject: "ראשונה", sort_order: -10 }),
      ],
    });
    expect(isAbove("ראשונה", "שנייה")).toBe(true);
    expect(isAbove("שנייה", "שלישית")).toBe(true);
  });

  it("keeps the order this person dragged the lists into (saved on the device); a broken saved order is ignored", () => {
    localStorage.setItem(`tasks-board-order:${ME}`, JSON.stringify(["done", "nonsense", "todo"]));
    renderBoard();
    // The two it knows first, then the ones missing in their usual order.
    expect(listOrder()).toEqual(["done", "todo", "in_progress", "blocked"]);
  });

  it("falls back to the usual order when what's saved isn't a list order at all", () => {
    localStorage.setItem(`tasks-board-order:${ME}`, "{not json");
    const { unmount } = renderBoard();
    expect(listOrder()).toEqual(["todo", "in_progress", "done", "blocked"]);
    unmount();
    localStorage.setItem(`tasks-board-order:${ME}`, JSON.stringify({ todo: 1 }));
    renderBoard();
    expect(listOrder()).toEqual(["todo", "in_progress", "done", "blocked"]);
  });

  it("re-reads the board when the server sends a new one (after a save, or for new filters)", () => {
    const view = renderBoard();
    view.arrive("", [task({ id: "n1", subject: "משימה מהשרת", status: "blocked" })]);
    expect(list("blocked").getByText("משימה מהשרת")).toBeInTheDocument();
    expect(screen.queryByText("להתקשר לספק")).toBeNull();
  });
});

describe("what a card shows", () => {
  it("its details on one line: due date and time, project, property, customer and phone, city, lock, bell, files, comments, people", () => {
    const today = inDays(0);
    renderBoard({
      tasks: [
        task({
          id: "c1",
          subject: "לבדוק מזגן",
          priority: "urgent",
          due_date: today,
          due_time: "09:30",
          project_name: "משכן משה",
          property_name: "בניין A",
          customer_name: "דוד כהן",
          customer_phone: "050-1234567",
          city: "בני ברק",
          is_private: true,
          has_open_reminder: true,
          attachment_count: 2,
          comment_count: 3,
          members: [
            { id: "m1", name: "אבי לוי", color: null },
            { id: "m2", name: "בני כץ", color: null },
            { id: "m3", name: "גדי רון", color: null },
            { id: "m4", name: "דני טל", color: null },
          ],
        }),
      ],
    });
    const c = within(card("לבדוק מזגן"));
    expect(c.getByText("דחופה")).toBeInTheDocument();
    expect(c.getByText(`${formatShortDate(today)} 09:30`)).toBeInTheDocument();
    expect(c.getByText("משכן משה")).toBeInTheDocument();
    expect(c.getByText("בניין A")).toBeInTheDocument();
    expect(c.getByText("דוד כהן")).toBeInTheDocument();
    expect(c.getByText("· 050-1234567")).toBeInTheDocument();
    // A city alone isn't an address: the tap says so instead of opening Waze
    // in the middle of town (owner, 2026-10-15).
    expect(c.queryByRole("link", { name: "בני ברק" })).not.toBeInTheDocument();
    expect(c.getByRole("button", { name: "בני ברק" })).toHaveAttribute("title", "אין כתובת מלאה לניווט");
    expect(c.getByTitle("משימה פרטית — רק את/ה רואה אותה")).toBeInTheDocument();
    expect(c.getByTitle("2 קבצים מצורפים")).toHaveTextContent("2");
    expect(c.getByText("3")).toBeInTheDocument();
    // Three faces, then "+1" for the fourth person.
    expect(c.getByText("+1")).toBeInTheDocument();
  });

  // Addresses plan B, step 5: the card's Waze goes to the task's own address.
  it.each([
    ["Google's point of its full address", { address: "רבי עקיבא 10", location_point: { lat: 32.08, lng: 34.83 } }, "ll=32.08,34.83"],
    ["its street with the city, when no point is kept", { address: "רבי עקיבא 10", location_point: null }, "waze.com/ul?q="],
  ])("the city opens Waze to %s", (_label, fields, href) => {
    renderBoard({ tasks: [task({ id: "w1", subject: "להתקין", city: "בני ברק", ...fields })] });
    expect(within(card("להתקין")).getByRole("link", { name: "בני ברק" }).getAttribute("href")).toContain(href);
  });

  it("a priority badge only when it's out of the ordinary (high/urgent) — never בינונית", () => {
    renderBoard({
      tasks: [
        task({ id: "a", subject: "רגילה", priority: "medium" }),
        task({ id: "b", subject: "גבוהה מאוד", priority: "high" }),
      ],
    });
    expect(screen.queryByText("בינונית")).toBeNull();
    expect(within(card("גבוהה מאוד")).getByText("גבוהה")).toBeInTheDocument();
  });

  it("one attached file is said in words", () => {
    renderBoard({ tasks: [task({ id: "a", subject: "עם קובץ", attachment_count: 1 })] });
    expect(within(card("עם קובץ")).getByTitle("קובץ אחד מצורף")).toBeInTheDocument();
  });

  it("a done card has its tick checked, and no snooze clock", () => {
    renderBoard();
    const done = within(card("לשלוח חשבונית"));
    expect(done.getByRole("button", { name: "החזרה ללביצוע" })).toBeInTheDocument();
    expect(done.queryByRole("button", { name: "לטיפול בהמשך" })).toBeNull();
    expect(within(card("להתקשר לספק")).getByRole("button", { name: "לטיפול בהמשך" })).toBeInTheDocument();
  });

  it("in Hebrew, an Arabic-authored task shows its Hebrew translation", () => {
    renderBoard({ tasks: [task({ id: "a", subject: "اتصل بالمورد", subject_he: "להתקשר לספק" })] });
    expect(screen.getByText("להתקשר לספק")).toBeInTheDocument();
    expect(screen.queryByText("اتصل بالمورد")).toBeNull();
  });

  it("in Arabic: the lists' names are Arabic, a Hebrew task shows its Arabic translation, an Arabic-authored one its original", () => {
    renderBoard({
      locale: "ar",
      tasks: [
        task({ id: "a", subject: "לתקן ברז", subject_ar: "إصلاح الحنفية" }),
        task({ id: "b", subject: "اتصل بالمورد", subject_he: "להתקשר לספק" }),
      ],
    });
    expect(list("todo").getByText("للتنفيذ")).toBeInTheDocument();
    expect(list("done").getByText("منجز")).toBeInTheDocument();
    expect(screen.getByText("إصلاح الحنفية")).toBeInTheDocument();
    expect(screen.getByText("اتصل بالمورد")).toBeInTheDocument();
    expect(screen.queryByText("להתקשר לספק")).toBeNull();
  });
});

describe("opening a task", () => {
  it("tapping a card opens it, filled from the card at once — and the URL is left alone", () => {
    renderBoard();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("לתקן ברז"));
    const open = screen.getByRole("dialog", { name: "משימה t3" });
    expect(within(open).getByText("לתקן ברז")).toBeInTheDocument();
    fireEvent.click(within(open).getByRole("button", { name: "סגירה" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("a link to /tasks?task=<id> opens that task; closing it takes ?task= off the URL so it doesn't reopen", () => {
    renderBoard({}, "task=t2");
    const open = screen.getByRole("dialog", { name: "משימה t2" });
    expect(within(open).getByText("להזמין חומרים")).toBeInTheDocument();
    fireEvent.click(within(open).getByRole("button", { name: "סגירה" }));
    expect(replace).toHaveBeenCalledWith("/tasks");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("…and keeps the rest of the URL (the search) when it does", () => {
    renderBoard({}, "q=ספק&task=t1");
    fireEvent.click(within(screen.getByRole("dialog", { name: "משימה t1" })).getByRole("button", { name: "סגירה" }));
    expect(replace).toHaveBeenCalledWith(`/tasks?${new URLSearchParams({ q: "ספק" })}`);
  });

  it("a worker opens a task as a worker; the office opens it with no role restriction", () => {
    const { unmount } = renderBoard();
    expect(dialog.props?.viewerRole).toBe("worker");
    unmount();
    renderBoard({ canSeeAll: true });
    expect(dialog.props?.viewerRole).toBeUndefined();
  });
});

describe("a task saved from the dialog", () => {
  it("a new task shows on the board at once, in its list, and the board is read again", () => {
    renderBoard();
    act(() => dialog.props!.onSaved({ id: "new1", subject: "משימה חדשה מהטופס", status: "in_progress", sort_order: -5000 }));
    expect(list("in_progress").getByText("משימה חדשה מהטופס")).toBeInTheDocument();
    expect(isAbove("משימה חדשה מהטופס", "לתקן ברז")).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a far-off to-do (due more than a week out) waits off the board — the refresh still runs", () => {
    renderBoard();
    act(() => dialog.props!.onSaved({ id: "far", subject: "לחדש ביטוח", status: "todo", due_date: inDays(30) }));
    expect(screen.queryByText("לחדש ביטוח")).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a to-do due within the week shows; a far-off task someone already started shows too (only לביצוע waits)", () => {
    renderBoard();
    act(() => dialog.props!.onSaved({ id: "soon", subject: "לשלם חשמל", status: "todo", due_date: inDays(2) }));
    act(() => dialog.props!.onSaved({ id: "started", subject: "לצבוע חדר", status: "in_progress", due_date: inDays(30) }));
    expect(list("todo").getByText("לשלם חשמל")).toBeInTheDocument();
    expect(list("in_progress").getByText("לצבוע חדר")).toBeInTheDocument();
  });

  it("a task already on the board isn't added twice; an untitled one is called משימה", () => {
    renderBoard();
    act(() => dialog.props!.onSaved({ id: "t1", subject: "להתקשר לספק", status: "todo" }));
    expect(screen.getAllByText("להתקשר לספק")).toHaveLength(1);
    act(() => dialog.props!.onSaved({ id: "nameless", assigned_user_id: OTHER }));
    expect(list("todo").getByText("משימה")).toBeInTheDocument();
  });

  it("an edit (nothing created) only reads the board again", () => {
    renderBoard();
    act(() => dialog.props!.onSaved());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(list("todo").getAllByRole("button", { name: /סימון כבוצע/ })).toHaveLength(2);
  });

  it("saved on the device copy, the board (drawn from the copy) shows it by itself — no server refresh", () => {
    device.saves = { create: vi.fn(), move: vi.fn(), remove: vi.fn() };
    renderBoard();
    act(() => dialog.props!.onSaved({ id: "new2", subject: "מהמכשיר", status: "todo" }));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("quick-add (הוספת כרטיס)", () => {
  it("the card shows in its list before the server answers; the box closes and the board is reconciled after", async () => {
    const answer = deferred<typeof ok>();
    net.offlineFetch.mockReturnValueOnce(answer.promise);
    renderBoard();
    const inProgress = list("in_progress");
    fireEvent.click(inProgress.getByText("הוספת כרטיס"));
    fireEvent.change(inProgress.getByPlaceholderText("כותרת המשימה"), { target: { value: "להחליף נורה" } });
    fireEvent.click(inProgress.getByRole("button", { name: "הוספה" }));

    expect(inProgress.getByText("להחליף נורה", NOT_TYPED)).toBeInTheDocument();
    // Newest on top.
    expect(isAbove("להחליף נורה", "לתקן ברז")).toBe(true);
    expect(net.offlineFetch).toHaveBeenCalledWith(
      "/api/tasks/create",
      {
        subject: "להחליף נורה",
        status: "in_progress",
        business_domain: "general_business",
        priority: "medium",
        assigned_user_id: ME,
      },
      "משימה חדשה",
      { idempotent: true }
    );
    expect(inProgress.getByRole("button", { name: "מוסיף..." })).toBeDisabled();

    await act(async () => answer.resolve(ok));
    expect(inProgress.queryByPlaceholderText("כותרת המשימה")).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
    // No toast for the happy path — the card appearing is the feedback.
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("one card per line, the last line typed ending up highest", async () => {
    renderBoard();
    const blocked = list("blocked");
    fireEvent.click(blocked.getByText("הוספת כרטיס"));
    fireEvent.change(blocked.getByPlaceholderText("כותרת המשימה"), { target: { value: "- לקנות ברגים\n- לקנות דבק\n" } });
    expect(blocked.getByText("2 שורות — ייווצרו 2 משימות")).toBeInTheDocument();
    fireEvent.click(blocked.getByRole("button", { name: "הוספת 2" }));
    await flush();
    expect(net.offlineFetch).toHaveBeenCalledTimes(2);
    expect(net.offlineFetch.mock.calls.map((call) => (call[1] as { subject: string }).subject)).toEqual(["לקנות ברגים", "לקנות דבק"]);
    expect(isAbove("לקנות דבק", "לקנות ברגים")).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("the add at the top of a list opens the box above its cards; Enter adds, Shift+Enter doesn't", async () => {
    renderBoard();
    const todo = list("todo");
    fireEvent.click(todo.getAllByRole("button", { name: "הוספת כרטיס" })[0]);
    const box = todo.getByPlaceholderText("כותרת המשימה");
    expect(Boolean(box.compareDocumentPosition(screen.getByText("להתקשר לספק")) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    fireEvent.change(box, { target: { value: "לאסוף מפתח" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(net.offlineFetch).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    await flush();
    expect(net.offlineFetch).toHaveBeenCalledTimes(1);
    expect(todo.getByText("לאסוף מפתח")).toBeInTheDocument();
  });

  it("nothing to add until something's typed; Escape or ביטול closes the box and forgets the text", () => {
    renderBoard();
    const blocked = list("blocked");
    fireEvent.click(blocked.getByText("הוספת כרטיס"));
    // The empty-list line steps aside while the box is open.
    expect(blocked.queryByText("אין משימות ברשימה הזו.")).toBeNull();
    const box = blocked.getByPlaceholderText("כותרת המשימה");
    fireEvent.change(box, { target: { value: "   \n  " } });
    expect(blocked.getByRole("button", { name: "הוספה" })).toBeDisabled();

    fireEvent.change(box, { target: { value: "טיוטה" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(blocked.queryByPlaceholderText("כותרת המשימה")).toBeNull();
    expect(blocked.getByText("אין משימות ברשימה הזו.")).toBeInTheDocument();

    fireEvent.click(blocked.getByText("הוספת כרטיס"));
    expect(blocked.getByPlaceholderText("כותרת המשימה")).toHaveValue("");
    fireEvent.click(blocked.getByRole("button", { name: "ביטול" }));
    expect(blocked.queryByPlaceholderText("כותרת המשימה")).toBeNull();
    expect(net.offlineFetch).not.toHaveBeenCalled();
  });

  it("a line the server refuses comes off the board again, and a toast names it", async () => {
    net.offlineFetch.mockResolvedValueOnce(failed);
    renderBoard();
    const todo = list("todo");
    fireEvent.click(todo.getByText("הוספת כרטיס"));
    fireEvent.change(todo.getByPlaceholderText("כותרת המשימה"), { target: { value: "לא תישמר" } });
    fireEvent.click(todo.getByRole("button", { name: "הוספה" }));
    await flush();
    expect(screen.queryByText("לא תישמר")).toBeNull();
    expect(toasts.error).toHaveBeenCalledWith("1 משימות לא נוצרו", { description: "לא תישמר" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a request that throws is treated the same as a refusal", async () => {
    net.offlineFetch.mockRejectedValueOnce(new Error("network down"));
    renderBoard();
    const todo = list("todo");
    fireEvent.click(todo.getByText("הוספת כרטיס"));
    fireEvent.change(todo.getByPlaceholderText("כותרת המשימה"), { target: { value: "נפלה ברשת" } });
    fireEvent.click(todo.getByRole("button", { name: "הוספה" }));
    await flush();
    expect(screen.queryByText("נפלה ברשת")).toBeNull();
    expect(toasts.error).toHaveBeenCalledWith("1 משימות לא נוצרו", { description: "נפלה ברשת" });
  });

  it("offline, the save waits in the queue — the card stays", async () => {
    net.offlineFetch.mockResolvedValueOnce({ queued: true, reason: "offline" });
    renderBoard();
    const todo = list("todo");
    fireEvent.click(todo.getByText("הוספת כרטיס"));
    fireEvent.change(todo.getByPlaceholderText("כותרת המשימה"), { target: { value: "בתור" } });
    fireEvent.click(todo.getByRole("button", { name: "הוספה" }));
    await flush();
    expect(todo.getByText("בתור")).toBeInTheDocument();
    expect(toasts.error).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("with a device copy: each line is created on the copy (it shows the cards itself), not sent to the server", async () => {
    const create = vi.fn(async () => ({}));
    device.saves = { create, move: vi.fn(), remove: vi.fn() };
    renderBoard();
    const todo = list("todo");
    fireEvent.click(todo.getByText("הוספת כרטיס"));
    fireEvent.change(todo.getByPlaceholderText("כותרת המשימה"), { target: { value: "אחת\nשתיים" } });
    fireEvent.click(todo.getByRole("button", { name: "הוספת 2" }));
    await flush();
    expect(create).toHaveBeenNthCalledWith(1, {
      subject: "אחת",
      status: "todo",
      business_domain: "general_business",
      priority: "medium",
      assigned_user_id: ME,
    });
    expect(create).toHaveBeenNthCalledWith(2, expect.objectContaining({ subject: "שתיים" }));
    expect(net.offlineFetch).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(todo.queryByPlaceholderText("כותרת המשימה")).toBeNull();
  });

  it("…and if the copy can't take it, a toast says the task wasn't created", async () => {
    device.saves = { create: vi.fn(async () => Promise.reject(new Error("db locked"))), move: vi.fn(), remove: vi.fn() };
    renderBoard();
    const todo = list("todo");
    fireEvent.click(todo.getByText("הוספת כרטיס"));
    fireEvent.change(todo.getByPlaceholderText("כותרת המשימה"), { target: { value: "לא נוצרה" } });
    fireEvent.click(todo.getByRole("button", { name: "הוספה" }));
    await flush();
    expect(toasts.error).toHaveBeenCalledWith("שגיאה ביצירת משימה", expect.objectContaining({ description: expect.any(String) }));
  });

  // Found by the tests, 2026-10-11: the box closed and what was typed was lost.
  it("…and the box stays open with what was typed, to try again — which, once it goes in, closes it", async () => {
    const create = vi.fn(async () => {}).mockRejectedValueOnce(new Error("db locked"));
    device.saves = { create, move: vi.fn(), remove: vi.fn() };
    renderBoard();
    const todo = list("todo");
    fireEvent.click(todo.getByText("הוספת כרטיס"));
    fireEvent.change(todo.getByPlaceholderText("כותרת המשימה"), { target: { value: "לנסות שוב" } });
    fireEvent.click(todo.getByRole("button", { name: "הוספה" }));
    await flush();
    expect(toasts.error).toHaveBeenCalledWith("שגיאה ביצירת משימה", expect.anything());
    expect(todo.getByPlaceholderText("כותרת המשימה")).toHaveValue("לנסות שוב");

    fireEvent.click(todo.getByRole("button", { name: "הוספה" }));
    await flush();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ subject: "לנסות שוב" }));
    expect(todo.queryByPlaceholderText("כותרת המשימה")).toBeNull();
  });

  it("…of several lines, the box keeps only the ones not added, so a retry doesn't add any twice", async () => {
    const create = vi.fn(async () => {});
    create.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("db locked"));
    device.saves = { create, move: vi.fn(), remove: vi.fn() };
    renderBoard();
    const todo = list("todo");
    fireEvent.click(todo.getByText("הוספת כרטיס"));
    fireEvent.change(todo.getByPlaceholderText("כותרת המשימה"), { target: { value: "אחת\nשתיים\nשלוש" } });
    fireEvent.click(todo.getByRole("button", { name: "הוספת 3" }));
    await flush();
    // The first went in; the second failed, and the rest weren't tried.
    expect(create).toHaveBeenCalledTimes(2);
    expect(todo.getByPlaceholderText("כותרת המשימה")).toHaveValue("שתיים\nשלוש");
    expect(todo.getByRole("button", { name: "הוספת 2" })).toBeEnabled();
  });

  // Found by the tests, 2026-10-11: the card took clicks while it still had
  // its stand-in id, and each sent that id to the server, which failed.
  it("a new card is greyed and does nothing until the server gives it its id — then it opens and ticks under that id", async () => {
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValueOnce("00000000-0000-4000-8000-000000000001");
    const answer = deferred<unknown>();
    net.offlineFetch.mockReturnValueOnce(answer.promise);
    renderBoard();
    const todo = list("todo");
    fireEvent.click(todo.getByText("הוספת כרטיס"));
    fireEvent.change(todo.getByPlaceholderText("כותרת המשימה"), { target: { value: "לקנות מנורה" } });
    fireEvent.click(todo.getByRole("button", { name: "הוספה" }));

    const saving = card("לקנות מנורה");
    expect(saving).toHaveAttribute("aria-busy", "true");
    expect(saving).toHaveAttribute("inert");
    expect(saving.className).toContain("opacity-60");
    // Not draggable either.
    expect(saving).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(saving);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(within(saving).getByRole("button", { name: "סימון כבוצע" }));
    fireEvent.click(within(saving).getByRole("button", { name: "לטיפול בהמשך" }));
    fireEvent.contextMenu(saving);
    expect(screen.queryByRole("button", { name: "פתיחה" })).toBeNull();
    act(() =>
      dnd.onDragEnd!({
        active: { id: "temp-00000000-0000-4000-8000-000000000001" },
        over: { id: "column:done" },
      } as unknown as DragEndEvent)
    );
    expect(list("todo").getByText("לקנות מנורה", NOT_TYPED)).toBeInTheDocument();
    expect(undo.actions).toHaveLength(0);
    // Nothing went to the server but the create itself.
    expect(net.offlineFetch).toHaveBeenCalledTimes(1);

    await act(async () => answer.resolve({ queued: false, ok: true, data: { task: { id: "real-1", subject: "לקנות מנורה" } } }));
    const saved = card("לקנות מנורה");
    expect(saved).not.toHaveAttribute("aria-busy");
    expect(saved).not.toHaveAttribute("inert");
    expect(saved).toHaveAttribute("aria-disabled", "false");

    fireEvent.click(saved);
    fireEvent.click(within(screen.getByRole("dialog", { name: "משימה real-1" })).getByRole("button", { name: "סגירה" }));
    fireEvent.click(within(saved).getByRole("button", { name: "סימון כבוצע" }));
    expect(net.offlineFetch).toHaveBeenLastCalledWith(
      "/api/tasks/update-status",
      expect.objectContaining({ id: "real-1", status: "done" }),
      "עדכון סטטוס משימה"
    );
    await flush();
    uuid.mockRestore();
  });
});

describe("ticking a card done (and back)", () => {
  it("moves it to the top of בוצע at once, saves the new place, and says so", async () => {
    renderBoard();
    fireEvent.click(within(card("להתקשר לספק")).getByRole("button", { name: "סימון כבוצע" }));
    expect(list("done").getByText("להתקשר לספק")).toBeInTheDocument();
    expect(isAbove("להתקשר לספק", "לשלוח חשבונית")).toBe(true);
    // 1000 above the list's top card (sort_order 100).
    expect(net.offlineFetch).toHaveBeenCalledWith(
      "/api/tasks/update-status",
      { id: "t1", status: "done", sort_order: -900 },
      "עדכון סטטוס משימה"
    );
    await flush();
    expect(toasts.success).toHaveBeenCalledWith('"להתקשר לספק" סומנה כבוצע');
  });

  it("unticking a done card returns it to לביצוע", async () => {
    renderBoard();
    fireEvent.click(within(card("לשלוח חשבונית")).getByRole("button", { name: "החזרה ללביצוע" }));
    expect(list("todo").getByText("לשלוח חשבונית")).toBeInTheDocument();
    await flush();
    expect(toasts.success).toHaveBeenCalledWith('"לשלוח חשבונית" הוחזרה ללביצוע');
  });

  it("a refused save puts the card back where it was, with an error toast", async () => {
    net.offlineFetch.mockResolvedValueOnce(failed);
    renderBoard();
    fireEvent.click(within(card("להתקשר לספק")).getByRole("button", { name: "סימון כבוצע" }));
    expect(list("done").getByText("להתקשר לספק")).toBeInTheDocument();
    await flush();
    expect(list("todo").getByText("להתקשר לספק")).toBeInTheDocument();
    expect(isAbove("להתקשר לספק", "להזמין חומרים")).toBe(true);
    expect(toasts.error).toHaveBeenCalledWith("שגיאה בעדכון סטטוס", expect.objectContaining({ description: expect.any(String) }));
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("a save that throws puts it back too", async () => {
    net.offlineFetch.mockRejectedValueOnce(new Error("network down"));
    renderBoard();
    fireEvent.click(within(card("להתקשר לספק")).getByRole("button", { name: "סימון כבוצע" }));
    await flush();
    expect(list("todo").getByText("להתקשר לספק")).toBeInTheDocument();
    expect(toasts.error).toHaveBeenCalledWith("שגיאה בעדכון סטטוס", expect.anything());
  });

  it("offline, the move waits in the queue: the card stays moved, no 'done' toast yet", async () => {
    net.offlineFetch.mockResolvedValueOnce({ queued: true, reason: "offline" });
    renderBoard();
    fireEvent.click(within(card("להתקשר לספק")).getByRole("button", { name: "סימון כבוצע" }));
    await flush();
    expect(list("done").getByText("להתקשר לספק")).toBeInTheDocument();
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("with a device copy the move is saved there; if the copy can't take it, the server gets it", async () => {
    const move = vi.fn(async () => {});
    device.saves = { create: vi.fn(), move, remove: vi.fn() };
    renderBoard();
    fireEvent.click(within(card("להתקשר לספק")).getByRole("button", { name: "סימון כבוצע" }));
    await flush();
    expect(move).toHaveBeenCalledWith("t1", "done", -900);
    expect(net.offlineFetch).not.toHaveBeenCalled();

    move.mockRejectedValueOnce(new Error("db locked"));
    fireEvent.click(within(card("להזמין חומרים")).getByRole("button", { name: "סימון כבוצע" }));
    await flush();
    expect(net.offlineFetch).toHaveBeenCalledWith("/api/tasks/update-status", expect.objectContaining({ id: "t2", status: "done" }), "עדכון סטטוס משימה");
  });
});

describe("the card menu (right-click; hold on a phone)", () => {
  it("names the task and offers the three other lists; moving there is silent", async () => {
    renderBoard();
    fireEvent.contextMenu(card("לתקן ברז"));
    // Drawn twice — a sheet for a phone and a popover at the cursor — CSS shows one.
    expect(screen.getAllByText("לתקן ברז")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "לביצוע" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "בוצע" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "חסום" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "בתהליך" })).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "חסום" })[0]);
    expect(screen.queryByRole("button", { name: "חסום" })).toBeNull();
    expect(list("blocked").getByText("לתקן ברז")).toBeInTheDocument();
    expect(net.offlineFetch).toHaveBeenCalledWith(
      "/api/tasks/update-status",
      expect.objectContaining({ id: "t3", status: "blocked" }),
      "עדכון סטטוס משימה"
    );
    await flush();
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("פתיחה opens the task", () => {
    renderBoard();
    fireEvent.contextMenu(card("לתקן ברז"));
    fireEvent.click(screen.getAllByRole("button", { name: "פתיחה" })[1]);
    expect(screen.getByRole("dialog", { name: "משימה t3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "פתיחה" })).toBeNull();
  });

  it("delete asks first; ביטול keeps the task", () => {
    renderBoard();
    fireEvent.contextMenu(card("לתקן ברז"));
    fireEvent.click(screen.getByRole("button", { name: "מחיקת המשימה" }));
    const confirm = screen.getByRole("dialog", { name: "מחיקת משימה" });
    expect(confirm).toHaveTextContent('למחוק את המשימה "לתקן ברז"?');
    fireEvent.click(within(confirm).getByRole("button", { name: "ביטול" }));
    expect(screen.queryByRole("dialog", { name: "מחיקת משימה" })).toBeNull();
    expect(undo.actions).toHaveLength(0);
    expect(list("in_progress").getByText("לתקן ברז")).toBeInTheDocument();
  });

  it("confirmed, the card goes at once; when the undo window closes it's deleted on the server", async () => {
    renderBoard();
    fireEvent.contextMenu(card("לתקן ברז"));
    fireEvent.click(screen.getAllByRole("button", { name: "מחיקה" })[0]);
    fireEvent.click(within(screen.getByRole("dialog", { name: "מחיקת משימה" })).getByRole("button", { name: "מחיקה" }));
    expect(screen.queryByText("לתקן ברז")).toBeNull();
    expect(undo.actions).toHaveLength(1);
    expect(undo.actions[0]).toMatchObject({ key: "task:delete:t3", message: "המשימה נמחקה" });

    await expect(undo.actions[0].onCommit()).resolves.toEqual({ ok: true });
    expect(net.offlineFetch).toHaveBeenCalledWith("/api/tasks/delete", { id: "t3" }, "מחיקת משימה");
  });

  it("a refused delete reports the error (the undo engine shows it), and undo brings the card back", async () => {
    net.offlineFetch.mockResolvedValueOnce(failed);
    renderBoard();
    fireEvent.contextMenu(card("לתקן ברז"));
    fireEvent.click(screen.getByRole("button", { name: "מחיקת המשימה" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "מחיקת משימה" })).getByRole("button", { name: "מחיקה" }));
    const result = await undo.actions[0].onCommit();
    expect(result.ok).toBe(false);
    expect((result as { error?: string }).error).toMatch(/^שגיאה במחיקת משימה: /);
    act(() => undo.actions[0].onRevert());
    expect(list("in_progress").getByText("לתקן ברז")).toBeInTheDocument();
  });

  // Found by the tests, 2026-10-11: undo put back the whole board as it was
  // when the delete began, so a move saved in the undo window vanished.
  it("undo brings back only the deleted card, in its place — a card moved meanwhile stays moved", async () => {
    const view = renderBoard();
    fireEvent.contextMenu(card("להתקשר לספק"));
    fireEvent.click(screen.getByRole("button", { name: "מחיקת המשימה" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "מחיקת משימה" })).getByRole("button", { name: "מחיקה" }));
    expect(screen.queryByText("להתקשר לספק")).toBeNull();
    // In the undo window another card is ticked done, and that is saved.
    fireEvent.click(within(card("לתקן ברז")).getByRole("button", { name: "סימון כבוצע" }));
    await flush();

    act(() => undo.actions[0].onRevert());
    expect(list("todo").getByText("להתקשר לספק")).toBeInTheDocument();
    expect(isAbove("להתקשר לספק", "להזמין חומרים")).toBe(true);
    expect(list("done").getByText("לתקן ברז")).toBeInTheDocument();

    // A board from the server that already has the card again: undo doesn't add it twice.
    fireEvent.contextMenu(card("להתקשר לספק"));
    fireEvent.click(screen.getByRole("button", { name: "מחיקת המשימה" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "מחיקת משימה" })).getByRole("button", { name: "מחיקה" }));
    view.arrive("", boardTasks());
    act(() => undo.actions[1].onRevert());
    expect(screen.getAllByText("להתקשר לספק")).toHaveLength(1);
  });

  it("with a device copy the delete is saved there; if it can't be, on the server", async () => {
    const remove = vi.fn(async () => {});
    device.saves = { create: vi.fn(), move: vi.fn(), remove };
    renderBoard();
    fireEvent.contextMenu(card("לתקן ברז"));
    fireEvent.click(screen.getByRole("button", { name: "מחיקת המשימה" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "מחיקת משימה" })).getByRole("button", { name: "מחיקה" }));
    await undo.actions[0].onCommit();
    expect(remove).toHaveBeenCalledWith("t3");
    expect(net.offlineFetch).not.toHaveBeenCalled();

    remove.mockRejectedValueOnce(new Error("db locked"));
    await undo.actions[0].onCommit();
    expect(net.offlineFetch).toHaveBeenCalledWith("/api/tasks/delete", { id: "t3" }, "מחיקת משימה");
  });
});

describe("holding a card on a phone", () => {
  it("a hold opens the card menu on release, not the task", () => {
    vi.useFakeTimers();
    renderBoard();
    const target = card("להתקשר לספק");
    fireEvent.pointerDown(target, { pointerType: "touch", clientX: 40, clientY: 80 });
    act(() => vi.advanceTimersByTime(450));
    fireEvent.pointerUp(target, { pointerType: "touch" });
    fireEvent.click(target);
    expect(screen.getAllByRole("button", { name: "פתיחה" })).toHaveLength(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a finger that moves is a scroll, and a quick tap opens the task", () => {
    vi.useFakeTimers();
    renderBoard();
    const target = card("להתקשר לספק");
    fireEvent.pointerDown(target, { pointerType: "touch", clientX: 40, clientY: 80 });
    fireEvent.pointerMove(target, { pointerType: "touch", clientX: 40, clientY: 120 });
    act(() => vi.advanceTimersByTime(450));
    fireEvent.click(target);
    expect(screen.queryByRole("button", { name: "פתיחה" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "משימה t1" })).toBeInTheDocument();
  });

  it("a mouse press is never a hold (a computer has right-click)", () => {
    vi.useFakeTimers();
    renderBoard();
    const target = card("להתקשר לספק");
    fireEvent.pointerDown(target, { pointerType: "mouse", clientX: 40, clientY: 80 });
    act(() => vi.advanceTimersByTime(450));
    fireEvent.click(target);
    expect(screen.getByRole("dialog", { name: "משימה t1" })).toBeInTheDocument();
  });

  it("on a tablet the hold belongs to dragging, so it opens no menu", () => {
    screenWidth(800);
    vi.useFakeTimers();
    renderBoard();
    const target = card("להתקשר לספק");
    fireEvent.pointerDown(target, { pointerType: "touch", clientX: 40, clientY: 80 });
    act(() => vi.advanceTimersByTime(450));
    fireEvent.click(target);
    expect(screen.queryByRole("button", { name: "פתיחה" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "משימה t1" })).toBeInTheDocument();
  });
});

describe("dragging", () => {
  type Box = { top: number; height: number };
  function drop(activeId: string, overId: string | null, boxes: { active?: Box; over?: Box } = {}) {
    const box = (b?: Box) => (b ? { ...b, left: 0, width: 200, right: 200, bottom: b.top + b.height } : null);
    act(() =>
      dnd.onDragEnd!({
        active: { id: activeId, data: { current: undefined }, rect: { current: { initial: box(boxes.active), translated: null } } },
        over: overId === null ? null : { id: overId, rect: box(boxes.over), data: { current: undefined }, disabled: false },
        delta: { x: 0, y: 0 },
        collisions: null,
        activatorEvent: new Event("pointerdown"),
      } as unknown as DragEndEvent)
    );
  }

  it("a card dropped on another list goes to its bottom at once, saved quietly", async () => {
    renderBoard();
    drop("t1", "column:done");
    expect(list("done").getByText("להתקשר לספק")).toBeInTheDocument();
    expect(isAbove("לשלוח חשבונית", "להתקשר לספק")).toBe(true);
    expect(net.offlineFetch).toHaveBeenCalledWith(
      "/api/tasks/update-status",
      { id: "t1", status: "done", sort_order: 1100 },
      "עדכון סטטוס משימה"
    );
    await flush();
    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("dropped on the lower half of a card it lands after it; on the upper half, before it", () => {
    renderBoard();
    drop("t1", "t3", { active: { top: 60, height: 20 }, over: { top: 0, height: 100 } });
    expect(list("in_progress").getByText("להתקשר לספק")).toBeInTheDocument();
    expect(isAbove("לתקן ברז", "להתקשר לספק")).toBe(true);

    drop("t2", "t3", { active: { top: 0, height: 20 }, over: { top: 0, height: 100 } });
    expect(isAbove("להזמין חומרים", "לתקן ברז")).toBe(true);
    expect(net.offlineFetch).toHaveBeenLastCalledWith(
      "/api/tasks/update-status",
      { id: "t2", status: "in_progress", sort_order: -900 },
      "עדכון סטטוס משימה"
    );
  });

  it("reorders within a list", () => {
    renderBoard();
    expect(isAbove("להתקשר לספק", "להזמין חומרים")).toBe(true);
    drop("t2", "t1", { active: { top: 0, height: 20 }, over: { top: 0, height: 100 } });
    expect(isAbove("להזמין חומרים", "להתקשר לספק")).toBe(true);
    expect(net.offlineFetch).toHaveBeenCalledWith(
      "/api/tasks/update-status",
      { id: "t2", status: "todo", sort_order: -900 },
      "עדכון סטטוס משימה"
    );
  });

  it("a refused drag puts the board back as it was, with an error toast", async () => {
    net.offlineFetch.mockResolvedValueOnce(failed);
    renderBoard();
    drop("t1", "column:blocked");
    expect(list("blocked").getByText("להתקשר לספק")).toBeInTheDocument();
    await flush();
    expect(list("todo").getByText("להתקשר לספק")).toBeInTheDocument();
    expect(toasts.error).toHaveBeenCalledWith("שגיאה בעדכון סטטוס", expect.anything());
  });

  it("a drag whose save throws is put back too", async () => {
    net.offlineFetch.mockRejectedValueOnce(new Error("network down"));
    renderBoard();
    drop("t1", "column:blocked");
    await flush();
    expect(list("todo").getByText("להתקשר לספק")).toBeInTheDocument();
    expect(toasts.error).toHaveBeenCalledWith("שגיאה בעדכון סטטוס", expect.anything());
  });

  // Found by the tests, 2026-10-11: a failed drag put back the whole board as
  // it was at drag time, wiping whatever changed while it was saving.
  it("a refused drag puts back only that card — a card moved while it was saving stays moved", async () => {
    const answer = deferred<typeof failed>();
    net.offlineFetch.mockReturnValueOnce(answer.promise);
    renderBoard();
    drop("t1", "column:blocked");
    fireEvent.click(within(card("לתקן ברז")).getByRole("button", { name: "סימון כבוצע" }));
    await flush();

    await act(async () => answer.resolve(failed));
    expect(list("todo").getByText("להתקשר לספק")).toBeInTheDocument();
    expect(isAbove("להתקשר לספק", "להזמין חומרים")).toBe(true);
    expect(list("done").getByText("לתקן ברז")).toBeInTheDocument();
    expect(toasts.error).toHaveBeenCalledWith("שגיאה בעדכון סטטוס", expect.anything());
  });

  it("…nor does it wipe a newer board the server sent while it was saving", async () => {
    const answer = deferred<typeof failed>();
    net.offlineFetch.mockReturnValueOnce(answer.promise);
    const view = renderBoard();
    drop("t1", "column:blocked");
    view.arrive("", [...boardTasks(), task({ id: "n1", subject: "חדשה מהשרת", status: "in_progress", sort_order: 300 })]);

    await act(async () => answer.resolve(failed));
    expect(list("in_progress").getByText("חדשה מהשרת")).toBeInTheDocument();
    expect(list("todo").getByText("להתקשר לספק")).toBeInTheDocument();
  });

  it("…and a newer move of the same card, saved, stands", async () => {
    const answer = deferred<typeof failed>();
    net.offlineFetch.mockReturnValueOnce(answer.promise);
    renderBoard();
    drop("t1", "column:blocked");
    fireEvent.click(within(card("להתקשר לספק")).getByRole("button", { name: "סימון כבוצע" }));
    await flush();

    await act(async () => answer.resolve(failed));
    expect(list("done").getByText("להתקשר לספק")).toBeInTheDocument();
  });

  it("dropped nowhere, on itself, or somewhere that isn't a list: nothing moves and nothing is saved", () => {
    renderBoard();
    drop("t1", null);
    drop("t1", "t1");
    drop("t1", "column:cancelled");
    drop("missing", "column:done");
    expect(list("todo").getByText("להתקשר לספק")).toBeInTheDocument();
    expect(net.offlineFetch).not.toHaveBeenCalled();
  });

  it("the click that ends a drag doesn't open the card; the next one does", async () => {
    renderBoard();
    act(() => {
      dnd.onDragEnd!({ active: { id: "t1" }, over: null } as unknown as DragEndEvent);
      fireEvent.click(screen.getByText("להתקשר לספק"));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    fireEvent.click(screen.getByText("להתקשר לספק"));
    expect(screen.getByRole("dialog", { name: "משימה t1" })).toBeInTheDocument();
  });

  it("a list dragged by its handle takes the new place, kept on this device for next time", () => {
    renderBoard();
    drop("column:done", "column:todo");
    expect(listOrder()).toEqual(["done", "todo", "in_progress", "blocked"]);
    expect(JSON.parse(localStorage.getItem(`tasks-board-order:${ME}`)!)).toEqual(["done", "todo", "in_progress", "blocked"]);
    // A list dropped on a card, or on itself, stays put.
    drop("column:done", "t1");
    drop("column:done", "column:done");
    expect(listOrder()).toEqual(["done", "todo", "in_progress", "blocked"]);
    expect(net.offlineFetch).not.toHaveBeenCalled();
  });

  it("while dragging, the card (or the list's name) rides under the finger", () => {
    renderBoard();
    const overlay = screen.getByTestId("drag-overlay");
    act(() => dnd.onDragStart!({ active: { id: "t3" } } as unknown as DragStartEvent));
    expect(within(overlay).getByText("לתקן ברז")).toBeInTheDocument();
    drop("t3", null);
    expect(overlay).toBeEmptyDOMElement();
    act(() => dnd.onDragStart!({ active: { id: "column:blocked" } } as unknown as DragStartEvent));
    expect(within(overlay).getByText("חסום")).toBeInTheDocument();
  });
});

describe("snoozing (לטיפול בהמשך)", () => {
  it("takes the card off the board at once; when the undo window closes it's saved, and the board is read again", async () => {
    device.saveTaskSnooze.mockResolvedValue({ ...ok, onDevice: false });
    renderBoard();
    fireEvent.click(within(card("להתקשר לספק")).getByRole("button", { name: "לטיפול בהמשך" }));
    expect(screen.queryByText("להתקשר לספק")).toBeNull();
    expect(undo.actions[0]).toMatchObject({ key: "task:snooze:t1", message: "המשימה תחזור ב־20/10/26" });

    await expect(undo.actions[0].onCommit()).resolves.toEqual({ ok: true });
    expect(device.saveTaskSnooze).toHaveBeenCalledWith("t1", snooze.until, "דחיית משימה");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("saved on the device copy, nothing needs reading again", async () => {
    device.saveTaskSnooze.mockResolvedValue({ queued: false, ok: true, data: null, onDevice: true });
    renderBoard();
    fireEvent.click(within(card("להתקשר לספק")).getByRole("button", { name: "לטיפול בהמשך" }));
    await undo.actions[0].onCommit();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a refused snooze reports why; undo puts the card back", async () => {
    device.saveTaskSnooze.mockResolvedValue({ ...failed, onDevice: false });
    renderBoard();
    fireEvent.click(within(card("להתקשר לספק")).getByRole("button", { name: "לטיפול בהמשך" }));
    const result = await undo.actions[0].onCommit();
    expect(result.ok).toBe(false);
    expect((result as { error?: string }).error).toMatch(/^הדחייה לא נשמרה: /);
    act(() => undo.actions[0].onRevert());
    expect(list("todo").getByText("להתקשר לספק")).toBeInTheDocument();
  });

  // Found by the tests, 2026-10-11: undo put back the whole board as it was
  // when the snooze began, so a move saved in the undo window vanished.
  it("undo brings back only the snoozed card, in its place — a card moved meanwhile stays moved", async () => {
    renderBoard();
    fireEvent.click(within(card("להתקשר לספק")).getByRole("button", { name: "לטיפול בהמשך" }));
    expect(screen.queryByText("להתקשר לספק")).toBeNull();
    fireEvent.click(within(card("לתקן ברז")).getByRole("button", { name: "סימון כבוצע" }));
    await flush();

    act(() => undo.actions[0].onRevert());
    expect(list("todo").getByText("להתקשר לספק")).toBeInTheDocument();
    expect(isAbove("להתקשר לספק", "להזמין חומרים")).toBe(true);
    expect(list("done").getByText("לתקן ברז")).toBeInTheDocument();
  });

  it("while searching, undo just unlights the card — moved in the meantime, it stays where it was moved", async () => {
    renderBoard({}, "q=ספק");
    fireEvent.click(within(card("להתקשר לספק")).getByRole("button", { name: "לטיפול בהמשך" }));
    fireEvent.contextMenu(card("להתקשר לספק"));
    fireEvent.click(screen.getAllByRole("button", { name: "חסום" })[0]);
    await flush();

    act(() => undo.actions[0].onRevert());
    expect(list("blocked").getByText(painted("להתקשר לספק"))).toBeInTheDocument();
    expect(within(card("להתקשר לספק")).getByRole("button", { name: "לטיפול בהמשך" })).toBeInTheDocument();
    expect(within(card("להתקשר לספק")).queryByRole("button", { name: "חוזרת בקרוב" })).toBeNull();
  });

  it("while searching, a snoozed card stays where the search found it, lit — and can be brought back now", () => {
    renderBoard({}, "q=ספק");
    fireEvent.click(within(card("להתקשר לספק")).getByRole("button", { name: "לטיפול בהמשך" }));
    const lit = within(card("להתקשר לספק"));
    expect(lit.getByRole("button", { name: "חוזרת בקרוב" })).toBeInTheDocument();

    fireEvent.click(lit.getByRole("button", { name: "חזרה עכשיו" }));
    expect(undo.actions[1]).toMatchObject({ key: "task:snooze:t1", message: "המשימה חזרה לרשימה" });
    expect(within(card("להתקשר לספק")).getByRole("button", { name: "לטיפול בהמשך" })).toBeInTheDocument();
  });
});

describe("search", () => {
  it("narrows the board at once, and asks the server for the search after a pause in typing", () => {
    vi.useFakeTimers();
    renderBoard();
    const search = screen.getByPlaceholderText("חיפוש...");
    fireEvent.change(search, { target: { value: "ס" } });
    fireEvent.change(search, { target: { value: "ספ" } });
    fireEvent.change(search, { target: { value: "ספק" } });
    expect(search).toHaveValue("ספק");
    act(() => vi.advanceTimersByTime(399));
    expect(push).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    // One request, for what was typed last.
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(`/tasks?${new URLSearchParams({ q: "ספק" })}`);
    // The board already shows only what matches, from the cards it has —
    // what matched painted yellow.
    expect(screen.getByText(painted("להתקשר לספק"))).toBeInTheDocument();
    expect(screen.getByText("ספק", { selector: "mark" })).toBeInTheDocument();
    expect(screen.queryByText("להזמין חומרים")).toBeNull();
    expect(screen.queryByText("לתקן ברז")).toBeNull();
  });

  it("the server's results replace the board when they arrive — a far-off task it found shows like any other", () => {
    vi.useFakeTimers();
    const view = renderBoard();
    fireEvent.change(screen.getByPlaceholderText("חיפוש..."), { target: { value: "ביטוח" } });
    act(() => vi.advanceTimersByTime(400));
    // Nothing loaded matches yet.
    expect(screen.queryByText(/ביטוח/)).toBeNull();
    // The board itself hides nothing by date: a to-do due months out waits
    // off the board because the server leaves it out, and its search keeps it in.
    view.arrive("q=ביטוח", [task({ id: "far", subject: "לחדש ביטוח רכב", due_date: inDays(60) })]);
    expect(list("todo").getByText(painted("לחדש ביטוח רכב"))).toBeInTheDocument();
    expect(screen.getByPlaceholderText("חיפוש...")).toHaveValue("ביטוח");
  });

  it("matches the Hebrew translation of an Arabic-authored task too", () => {
    vi.useFakeTimers();
    renderBoard({ tasks: [task({ id: "a", subject: "اتصل بالمورد", subject_he: "להתקשר לספק" }), task({ id: "b", subject: "אחר" })] });
    fireEvent.change(screen.getByPlaceholderText("חיפוש..."), { target: { value: "לספק" } });
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByText(painted("להתקשר לספק"))).toBeInTheDocument();
    expect(screen.queryByText("אחר")).toBeNull();
  });

  it("starts from the search in the URL", () => {
    renderBoard({}, "q=ברז");
    expect(screen.getByPlaceholderText("חיפוש...")).toHaveValue("ברז");
  });
});

describe("filters", () => {
  it("מסננים opens the filter panel and closes it again (its ✕, the backdrop, or Escape)", () => {
    renderBoard();
    expect(filtersButton()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("עדיפות")).toBeNull();
    fireEvent.click(filtersButton());
    expect(filtersButton()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByText("עדיפות").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: "סגירת מסננים" })[0]);
    expect(screen.queryByText("עדיפות")).toBeNull();

    fireEvent.click(filtersButton());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("עדיפות")).toBeNull();
  });

  it("a priority narrows the board at once, then the URL follows; מסננים counts it", () => {
    renderBoard();
    fireEvent.click(filtersButton());
    fireEvent.change(filterField("עדיפות"), { target: { value: "urgent" } });
    expect(push).toHaveBeenCalledWith("/tasks?priority=urgent");
    expect(screen.getByText("להזמין חומרים")).toBeInTheDocument();
    expect(screen.queryByText("להתקשר לספק")).toBeNull();
    expect(screen.queryByText("לתקן ברז")).toBeNull();
    expect(filtersButton()).toHaveTextContent("1");
    expect(filterField("עדיפות")).toHaveValue("urgent");
  });

  it("taking a filter back off before the server answers shows the whole board again", () => {
    renderBoard();
    fireEvent.click(filtersButton());
    fireEvent.change(filterField("עדיפות"), { target: { value: "urgent" } });
    fireEvent.change(filterField("עדיפות"), { target: { value: "" } });
    expect(push).toHaveBeenLastCalledWith("/tasks");
    expect(screen.getByText("להתקשר לספק")).toBeInTheDocument();
    expect(screen.getByText("לתקן ברז")).toBeInTheDocument();
  });

  it("when the server's board for the filter arrives, it's what shows", () => {
    const view = renderBoard();
    fireEvent.click(filtersButton());
    fireEvent.change(filterField("עדיפות"), { target: { value: "high" } });
    view.arrive("priority=high", [task({ id: "h1", subject: "דחוף מהשרת", priority: "high" })]);
    expect(screen.getByText("דחוף מהשרת")).toBeInTheDocument();
    expect(screen.queryByText("להתקשר לספק")).toBeNull();
    expect(filterField("עדיפות")).toHaveValue("high");
  });

  it("projects as the domain: the board narrows to it and a project picker appears; a project narrows it further", () => {
    renderBoard({
      projects: [
        { id: "p1", label: "משכן משה" },
        { id: "p2", label: "בית כנסת" },
      ],
      tasks: [
        task({ id: "a", subject: "יציקה", business_domain: "logistics_projects", project_id: "p1" }),
        task({ id: "b", subject: "חשמל", business_domain: "logistics_projects", project_id: "p2" }),
        task({ id: "c", subject: "שוטפת", business_domain: "general_business" }),
      ],
    });
    fireEvent.click(filtersButton());
    expect(screen.queryByText("פרויקט")).toBeNull();
    fireEvent.change(screen.getAllByRole("combobox", { name: "תחום" })[0], { target: { value: "logistics_projects" } });
    expect(push).toHaveBeenLastCalledWith("/tasks?domain=logistics_projects");
    expect(screen.queryByText("שוטפת")).toBeNull();
    expect(screen.getByText("חשמל")).toBeInTheDocument();

    const picker = screen.getAllByRole("combobox", { name: "בחירת פרויקט" })[0];
    expect(within(picker).getByRole("option", { name: "כל הפרויקטים" })).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: "p1" } });
    expect(push).toHaveBeenLastCalledWith("/tasks?domain=logistics_projects&linked_id=p1");
    expect(screen.getByText("יציקה")).toBeInTheDocument();
    expect(screen.queryByText("חשמל")).toBeNull();
    expect(filtersButton()).toHaveTextContent("2");
  });

  it("property management as the domain offers a property picker", () => {
    renderBoard({ properties: [{ id: "pr1", label: "רחוב הרצל 5" }] }, "domain=property_management");
    fireEvent.click(filtersButton());
    expect(screen.getAllByText("נכס").length).toBeGreaterThan(0);
    const picker = screen.getAllByRole("combobox", { name: "סינון לפי נכס" })[0];
    expect(within(picker).getByRole("option", { name: "כל הנכסים" })).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: "pr1" } });
    expect(push).toHaveBeenLastCalledWith("/tasks?domain=property_management&linked_id=pr1");
  });

  it("changing the domain drops the project or property picked under the old one", () => {
    renderBoard({}, "domain=logistics_projects&linked_id=p1");
    fireEvent.click(filtersButton());
    fireEvent.change(screen.getAllByRole("combobox", { name: "תחום" })[0], { target: { value: "general_business" } });
    expect(push).toHaveBeenLastCalledWith("/tasks?domain=general_business");
  });

  it("the server version of the page (?data=server) stays the server version through filtering", () => {
    renderBoard({}, "data=server");
    fireEvent.click(filtersButton());
    fireEvent.change(filterField("עדיפות"), { target: { value: "low" } });
    expect(push).toHaveBeenCalledWith("/tasks?priority=low&data=server");
  });

  it("the office: שלי / הכל, mine by default; הכל goes in the URL", () => {
    renderBoard({ canSeeAll: true });
    fireEvent.click(filtersButton());
    const [mine] = screen.getAllByRole("button", { name: "שלי" });
    const [all] = screen.getAllByRole("button", { name: "הכל" });
    expect(mine).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveAttribute("aria-pressed", "false");
    // The chosen half is the app's one toggle look, blue (owner,
    // 2026-10-11: "all the toggles should be blue").
    expect(mine).toHaveClass("bg-secondary", "text-secondary-foreground");
    expect(all).not.toHaveClass("bg-secondary");
    expect(all).not.toHaveClass("bg-secondary");
    fireEvent.click(all);
    expect(push).toHaveBeenCalledWith("/tasks?scope=all");
  });

  it("back from everyone's to שלי: the board keeps my tasks, ones I'm on, and my private ones", () => {
    renderBoard(
      {
        canSeeAll: true,
        tasks: [
          task({ id: "a", subject: "שלי ממש", assigned_user_id: ME }),
          task({ id: "b", subject: "של יוסי", assigned_user_id: OTHER }),
          task({ id: "c", subject: "יוסי ואני", assigned_user_id: OTHER, members: [{ id: ME, name: "אני", color: null }] }),
          task({ id: "d", subject: "פרטית", assigned_user_id: OTHER, is_private: true }),
        ],
      },
      "scope=all"
    );
    expect(filtersButton()).toHaveTextContent("1");
    fireEvent.click(filtersButton());
    fireEvent.click(screen.getAllByRole("button", { name: "שלי" })[0]);
    expect(push).toHaveBeenCalledWith("/tasks");
    expect(screen.queryByText("של יוסי")).toBeNull();
    expect(screen.getByText("שלי ממש")).toBeInTheDocument();
    expect(screen.getByText("יוסי ואני")).toBeInTheDocument();
    expect(screen.getByText("פרטית")).toBeInTheDocument();
  });

  it("a worker has no שלי / הכל and no משימות קבועות — and ?scope=all doesn't widen their board", () => {
    renderBoard({}, "scope=all");
    expect(screen.queryByRole("link", { name: "משימות קבועות" })).toBeNull();
    fireEvent.click(filtersButton());
    expect(screen.queryByText("היקף")).toBeNull();
    fireEvent.change(filterField("עדיפות"), { target: { value: "high" } });
    expect(push).toHaveBeenCalledWith("/tasks?priority=high");
  });

  it("the office has a משימות קבועות button in the bar", () => {
    renderBoard({ canSeeAll: true });
    expect(screen.getByRole("link", { name: "משימות קבועות" })).toHaveAttribute("href", "/tasks/recurring");
  });

  it("the count on מסננים covers every live filter in the URL", () => {
    renderBoard({ canSeeAll: true }, "priority=high&domain=sales&scope=all");
    expect(filtersButton()).toHaveTextContent("3");
  });
});

describe("on a phone", () => {
  it("the search, a filters button and משימות קבועות sit in the strip under the bar", () => {
    const strip = document.createElement("div");
    strip.id = PAGE_HEADER_TOOLBAR_ID;
    document.body.appendChild(strip);
    renderBoard({ canSeeAll: true });
    const phone = within(strip);
    expect(phone.getByPlaceholderText("חיפוש...")).toBeInTheDocument();
    expect(phone.getByRole("link", { name: "משימות קבועות" })).toHaveAttribute("href", "/tasks/recurring");
    fireEvent.click(phone.getByRole("button", { name: "הצגת מסננים" }));
    expect(phone.getByRole("button", { name: "הסתרת מסננים" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByText("עדיפות").length).toBeGreaterThan(0);
  });

  it("lands on לביצוע — scrolled to the middle of the screen", () => {
    vi.useFakeTimers();
    renderBoard();
    const row = scroller();
    const scrollBy = vi.fn();
    row.scrollBy = scrollBy;
    row.getBoundingClientRect = () => rect(0, 400);
    // Right to left: לביצוע starts off to the right.
    const lefts: Record<string, number> = { todo: 500, in_progress: 120, done: -260, blocked: -640 };
    for (const [status, left] of Object.entries(lefts)) {
      document.querySelector<HTMLElement>(`[data-column="${status}"]`)!.getBoundingClientRect = () => rect(left, 360);
    }
    act(() => vi.advanceTimersByTime(50));
    // Its middle (500 + 180) onto the screen's (200).
    expect(scrollBy).toHaveBeenCalledWith({ left: 480, behavior: "auto" });
  });

  it("a flick that skips past the next list is walked back to it — one list per swipe", () => {
    vi.useFakeTimers();
    renderBoard();
    const row = scroller();
    const scrollBy = vi.fn();
    row.scrollBy = scrollBy;
    row.getBoundingClientRect = () => rect(0, 400);
    const place = (lefts: Record<string, number>) => {
      for (const [status, left] of Object.entries(lefts)) {
        document.querySelector<HTMLElement>(`[data-column="${status}"]`)!.getBoundingClientRect = () => rect(left, 360);
      }
    };
    place({ todo: 20, in_progress: -360, done: -740, blocked: -1120 });
    act(() => vi.advanceTimersByTime(50));
    fireEvent.pointerDown(row);
    // The flick ends with בוצע — two lists on — in the middle.
    place({ todo: 780, in_progress: 400, done: 20, blocked: -360 });
    fireEvent.scroll(row);
    act(() => vi.advanceTimersByTime(200));
    // Back to בתהליך: its middle (400 + 180) onto the screen's (200).
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 380, behavior: "smooth" });
  });

  it("on a computer, where all four lists fit, nothing is scrolled", () => {
    screenWidth(1280);
    vi.useFakeTimers();
    renderBoard();
    const row = scroller();
    const scrollBy = vi.fn();
    row.scrollBy = scrollBy;
    act(() => vi.advanceTimersByTime(50));
    expect(scrollBy).not.toHaveBeenCalled();
  });
});

describe("the magnifier", () => {
  it("shrinks the lists to titles only, and back", () => {
    renderBoard({ tasks: [task({ id: "a", subject: "עם פרויקט", project_name: "משכן משה", priority: "urgent" })] });
    const zoomOut = screen.getByRole("button", { name: "הצגת כל הרשימה במסך אחד" });
    expect(zoomOut).toHaveAttribute("aria-pressed", "false");
    expect(scroller().style.fontSize).toBe("0.875rem");
    fireEvent.click(zoomOut);

    const zoomIn = screen.getByRole("button", { name: "חזרה לתצוגה רגילה" });
    expect(zoomIn).toHaveAttribute("aria-pressed", "true");
    expect(parseFloat(scroller().style.fontSize)).toBeCloseTo(0.875 * 0.6);
    expect(screen.getByText("עם פרויקט")).toBeInTheDocument();
    expect(screen.queryByText("משכן משה")).toBeNull();
    expect(screen.queryByText("דחופה")).toBeNull();

    fireEvent.click(zoomIn);
    expect(scroller().style.fontSize).toBe("0.875rem");
    expect(screen.getByText("משכן משה")).toBeInTheDocument();
  });

  it("a list longer than the screen is shrunk just enough to fit", () => {
    renderBoard();
    const cards = document.querySelector<HTMLElement>('[data-column="todo"] [data-cards]')!;
    Object.defineProperty(cards, "scrollHeight", { value: 600, configurable: true });
    Object.defineProperty(cards, "clientHeight", { value: 300, configurable: true });
    fireEvent.click(screen.getByRole("button", { name: "הצגת כל הרשימה במסך אחד" }));
    // Half the height, less 5% for what doesn't scale.
    expect(parseFloat(scroller().style.fontSize)).toBeCloseTo(0.875 * 0.5 * 0.95);
  });
});
