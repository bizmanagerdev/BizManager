import { describe, expect, it } from "vitest";
import { filterBoardLocally, type TaskBoardFilters } from "@/lib/tasks/boardFilters";
import type { TaskBoardItem } from "@/app/(app)/tasks/loadTasks";

// The board shows newly picked filters at once, from the tasks already on
// screen, until the server's own board for them arrives. It must never hide a
// task the server would show for filters that didn't change.

const ME = "u-me";

function task(overrides: Partial<TaskBoardItem>): TaskBoardItem {
  return {
    id: "t",
    subject: "משימה",
    subject_he: null,
    subject_ar: null,
    status: "todo",
    priority: "normal",
    due_date: null,
    due_time: null,
    city: null,
    business_domain: "general",
    project_id: null,
    property_id: null,
    customer_id: null,
    project_name: null,
    property_name: null,
    customer_name: null,
    customer_phone: null,
    assigned_user_id: null,
    assigned_user_name: null,
    members: [],
    comment_count: 0,
    attachment_count: 0,
    has_open_reminder: false,
    is_overdue: false,
    is_private: false,
    sort_order: null,
    snoozed_until: null,
    ...overrides,
  };
}

const NONE: TaskBoardFilters = { q: "", priority: "", domain: "", linkedId: "", scope: "mine" };

const TASKS = [
  task({ id: "a", subject: "להתקשר ללקוח", priority: "high", assigned_user_id: ME }),
  task({ id: "b", subject: "Order boxes", priority: "normal", business_domain: "logistics_projects", project_id: "p1" }),
  task({ id: "c", subject: "תיקון", priority: "high", business_domain: "logistics_projects", project_id: "p2", members: [{ id: ME, name: "", color: null }] }),
  task({ id: "d", subject: "פרטי", is_private: true }),
];

const ids = (tasks: TaskBoardItem[]) => tasks.map((t) => t.id);

describe("filterBoardLocally", () => {
  it("applies a newly picked priority, area or project", () => {
    expect(ids(filterBoardLocally(TASKS, { ...NONE, priority: "high" }, NONE, ME))).toEqual(["a", "c"]);
    expect(ids(filterBoardLocally(TASKS, { ...NONE, domain: "logistics_projects" }, NONE, ME))).toEqual(["b", "c"]);
    const inLogistics = { ...NONE, domain: "logistics_projects" };
    expect(ids(filterBoardLocally(TASKS, { ...inLogistics, linkedId: "p2" }, inLogistics, ME))).toEqual(["c"]);
  });

  it("matches a search in any language the subject is kept in, ignoring case", () => {
    expect(ids(filterBoardLocally(TASKS, { ...NONE, q: "order" }, NONE, ME))).toEqual(["b"]);
    expect(ids(filterBoardLocally(TASKS, { ...NONE, q: "לקוח" }, NONE, ME))).toEqual(["a"]);
  });

  it("narrows everyone's board to mine: assigned, a member, or private", () => {
    const all = { ...NONE, scope: "all" as const };
    expect(ids(filterBoardLocally(TASKS, NONE, all, ME))).toEqual(["a", "c", "d"]);
  });

  it("leaves the board alone for filters that didn't change or were taken away", () => {
    const high = { ...NONE, priority: "high" };
    expect(filterBoardLocally(TASKS, high, high, ME)).toBe(TASKS);
    expect(filterBoardLocally(TASKS, NONE, high, ME)).toBe(TASKS);
    expect(filterBoardLocally(TASKS, { ...NONE, scope: "all" }, NONE, ME)).toBe(TASKS);
  });
});
