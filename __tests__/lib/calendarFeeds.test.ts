import { describe, expect, it } from "vitest";
import { createLocalSupabase, type LocalReader } from "@/lib/powersync/local-supabase";
import { AppSchema } from "@/lib/powersync/schema";
import { getCalendarFeeds, getScheduleEntries } from "@/lib/projectSchedule";

// The calendar's feeds (owner, 2026-10-29: "yes go build 1-3"). Everyone's is
// read once and mine is picked out of it — the page used to read the whole
// feed twice — so mine must come out exactly as reading mine on its own does.
// No list stops at 500 any more, the name lookups go in batches of 150, and
// a day's items keep one order (the device and the server compare them in
// order). Run on the device copy's reader, the way the device works them out.

type Row = Record<string, unknown>;
const COLUMNS = new Map(AppSchema.tables.map((table) => [table.name, table.columns.map((column) => column.name)]));
const padded = (table: string, row: Row): Row => ({
  ...Object.fromEntries((COLUMNS.get(table) ?? []).map((column) => [column, null])),
  ...row,
});

function reader(tables: Record<string, Row[]>, reads: string[] = []): LocalReader {
  return {
    async getAll<T>(sql: string): Promise<T[]> {
      const match = /^SELECT \* FROM ([a-z_]+)/.exec(sql);
      if (!match) throw new Error(`can't run: ${sql}`);
      reads.push(match[1]);
      return (tables[match[1]] ?? []).map((row) => padded(match[1], row)) as T[];
    },
  };
}

const ME = "u1";
const OTHER = "u2";
const FUTURE = "2099-01-01T00:00:00Z";

function tables(): Record<string, Row[]> {
  return {
    users: [
      { id: ME, full_name: "אני", email: "me@x", role: "admin", active: 1 },
      { id: OTHER, full_name: "נתן", email: "n@x", role: "worker", active: 1 },
    ],
    customers: [
      { id: "c1", name: "כהן" },
      { id: "c2", name: "לוי" },
    ],
    tasks: [
      { id: "t1", subject: "להתקשר", status: "todo", due_date: "2026-11-02", assigned_user_id: ME, project_id: "p1" },
      { id: "t2", subject: "להעמיס", status: "in_progress", due_date: "2026-11-02", assigned_user_id: OTHER, project_id: null },
      // Mine, but snoozed by me: off my calendar, still on everyone's.
      { id: "t3", subject: "נדחה", status: "todo", due_date: "2026-11-03", assigned_user_id: ME, project_id: null },
      { id: "t4", subject: "גמור", status: "done", due_date: "2026-11-02", assigned_user_id: ME, project_id: null },
    ],
    task_snoozes: [{ task_id: "t3", user_id: ME, until: FUTURE }],
    projects: [
      { id: "p1", name: "הובלה", status: "active", start_date: "2026-11-02", end_date: "2026-11-03", project_manager_id: ME, customer_id: "c1" },
      { id: "p2", name: "פינוי", status: "active", start_date: "2026-11-05", end_date: "2026-11-05", project_manager_id: OTHER, customer_id: "c2" },
    ],
    orders: [
      // Someone else's order I was picked to see.
      { id: "o1", customer_id: "c1", status: "draft", requested_delivery_date: "2026-11-04", created_by: OTHER },
      { id: "o2", customer_id: "c2", status: "draft", requested_delivery_date: "2026-11-04", created_by: ME },
      { id: "o3", customer_id: "c2", status: "draft", requested_delivery_date: "2026-11-06", created_by: OTHER },
      { id: "o4", customer_id: "c1", status: "delivered", requested_delivery_date: "2026-11-04", created_by: ME },
    ],
    order_delivery_recipients: [{ order_id: "o1", user_id: ME }],
    reminders: [
      { id: "r1", status: "pending", remind_at: "2026-11-02T08:00:00Z", assigned_to: ME, created_by: OTHER, content: "לחזור", action_type: "call", customer_id: "c1" },
      // Never assigned, made by me: mine.
      { id: "r2", status: "pending", remind_at: "2026-11-02T09:00:00Z", assigned_to: null, created_by: ME, content: "לבדוק", action_type: "call" },
      { id: "r3", status: "pending", remind_at: "2026-11-02T10:00:00Z", assigned_to: OTHER, created_by: ME, content: "שלו", action_type: "call" },
    ],
  };
}

const ids = (list: { id: string }[]) => list.map((e) => e.id).sort();

describe("the calendar's feeds", () => {
  it("mine, picked out of everyone's, is exactly mine read on its own — and everyone's is everyone's", async () => {
    const local = createLocalSupabase(reader(tables()));
    const feeds = await getCalendarFeeds(local, { userId: ME, canSeeAll: true });
    expect(feeds.mine).toEqual(await getScheduleEntries(local, { scope: "mine", userId: ME }));
    expect(feeds.all).toEqual(await getScheduleEntries(local, { scope: "all", userId: ME }));
    expect(ids(feeds.mine)).toEqual(["o1", "o2", "p1", "r1", "r2", "t1"]);
    expect(ids(feeds.all ?? [])).toEqual(["o1", "o2", "o3", "p1", "p2", "r1", "r2", "r3", "t1", "t2", "t3"]);
  });

  it("everyone's names whose task it is; mine doesn't print my own name", async () => {
    const feeds = await getCalendarFeeds(createLocalSupabase(reader(tables())), { userId: ME, canSeeAll: true });
    expect(feeds.all?.find((e) => e.id === "t2")?.subtitle).toBe("נתן");
    expect(feeds.mine.find((e) => e.id === "t1")?.subtitle).toBe("הובלה");
  });

  it("reads everything once — the page used to read the whole feed twice", async () => {
    const reads: string[] = [];
    await getCalendarFeeds(createLocalSupabase(reader(tables(), reads)), { userId: ME, canSeeAll: true });
    const count = (table: string) => reads.filter((t) => t === table).length;
    expect(count("projects")).toBe(2); // the feed, and the tasks' project names
    expect(count("orders")).toBe(1);
    expect(count("reminders")).toBe(1);
    // The feed, and the reminders' task subjects (none here).
    expect(count("tasks")).toBe(1);
  });

  it("someone who can't see everyone's gets theirs only", async () => {
    const feeds = await getCalendarFeeds(createLocalSupabase(reader(tables())), { userId: ME, canSeeAll: false });
    expect(feeds.all).toBeNull();
    expect(ids(feeds.mine)).toEqual(["o1", "o2", "p1", "r1", "r2", "t1"]);
  });

  it("no list stops at 500: every project shows, the newest too", async () => {
    const data = tables();
    data.projects = Array.from({ length: 1200 }, (_, i) => ({
      id: `p${String(i).padStart(4, "0")}`,
      name: `פרויקט ${i}`,
      status: "active",
      start_date: `2026-${String((i % 12) + 1).padStart(2, "0")}-01`,
      end_date: null,
      project_manager_id: ME,
      customer_id: "c1",
    }));
    const feeds = await getCalendarFeeds(createLocalSupabase(reader(data)), { userId: ME, canSeeAll: true });
    expect(feeds.all?.filter((e) => e.kind === "project")).toHaveLength(1200);
    expect(feeds.mine.filter((e) => e.kind === "project")).toHaveLength(1200);
  });

  it("every pending reminder shows — they stopped at 500 too", async () => {
    const data = tables();
    data.reminders = Array.from({ length: 1100 }, (_, i) => ({
      id: `r${String(i).padStart(4, "0")}`,
      status: "pending",
      remind_at: "2026-11-02T08:00:00Z",
      assigned_to: ME,
      created_by: ME,
      content: `תזכורת ${i}`,
      action_type: "call",
    }));
    const feeds = await getCalendarFeeds(createLocalSupabase(reader(data)), { userId: ME, canSeeAll: true });
    expect(feeds.mine.filter((e) => e.kind === "reminder")).toHaveLength(1100);
  });

  it("asks for names 150 ids at a time", async () => {
    const data = tables();
    data.customers = Array.from({ length: 400 }, (_, i) => ({ id: `c${i}`, name: `לקוח ${i}` }));
    data.projects = data.customers.map((c, i) => ({
      id: `p${i}`, name: `פרויקט ${i}`, status: "active", start_date: "2026-11-10", end_date: null, project_manager_id: OTHER, customer_id: c.id,
    }));
    // The reminders' own customer lookup aside: only the projects' customers here.
    data.reminders = data.reminders.map((r) => ({ ...r, customer_id: null }));
    const reads: string[] = [];
    const feeds = await getCalendarFeeds(createLocalSupabase(reader(data, reads)), { userId: ME, canSeeAll: true });
    expect(reads.filter((t) => t === "customers").length).toBe(3);
    expect(feeds.all?.find((e) => e.id === "p399")?.subtitle).toBe("לקוח 399");
  });

  it("a day's items keep one order: tasks, reminders, projects, deliveries; then the name; then the id", async () => {
    const data = tables();
    data.tasks = [
      { id: "tb", subject: "אותו שם", status: "todo", due_date: "2026-11-02", assigned_user_id: ME, project_id: null },
      { id: "ta", subject: "אותו שם", status: "todo", due_date: "2026-11-02", assigned_user_id: ME, project_id: null },
    ];
    data.task_snoozes = [];
    const feeds = await getCalendarFeeds(createLocalSupabase(reader(data)), { userId: ME, canSeeAll: true });
    const day = (feeds.all ?? []).filter((e) => e.startDate === "2026-11-02").map((e) => `${e.kind}:${e.id}`);
    // The reminders by name: לבדוק, לחזור, שלו.
    expect(day).toEqual(["task:ta", "task:tb", "reminder:r2", "reminder:r1", "reminder:r3", "project:p1"]);
  });
});
