import type { SupabaseClient } from "@supabase/supabase-js";
import { isChildAuditTable } from "@/lib/audit";
import { israelDayStart, israelHourOf, shiftDayKey } from "@/lib/activity/days";
import { CARD_REFUND_METHOD } from "@/lib/payments";

// "היום בעסק" — the activity page's picture of the day: the money that came in,
// the orders opened, the tasks done, the hours worked, how busy each hour was,
// and each person's day. All on the Israeli calendar, from Israel's midnight.

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "מזומן",
  check: "צ׳ק",
  cheque: "צ׳ק",
  credit: "אשראי",
  credit_card: "אשראי",
  card: "אשראי",
  bank_transfer: "העברה",
  transfer: "העברה",
  bit: "ביט",
  paybox: "פייבוקס",
};

/** One log row, as little of it as the day's numbers need. */
export type DayLogRow = {
  created_at: string;
  changed_by: string | null;
  table_name: string;
  action: string;
  status_to: string | null;
  status_from: string | null;
  amount: string | null;
  /** A payment's method — a card refund (CARD_REFUND_METHOD) isn't money that came in. */
  method?: string | null;
};

export type PersonShift = { clockIn: string; clockOut: string | null; minutes: number };

/** What one person did today. */
export type PersonDay = {
  userId: string;
  /** Their actions today (not their logins, nor the side-rows an action writes). */
  actions: number;
  firstAt: string | null;
  lastAt: string | null;
  loginAt: string | null;
  logoutAt: string | null;
  orders: number;
  deliveries: number;
  payments: number;
  paymentsTotal: number;
  tasksNew: number;
  tasksDone: number;
  expenses: number;
  customers: number;
  projects: number;
  documents: number;
  /** Actions per hour of the day (0–23, Israel time). */
  hourly: number[];
  /** Their work clock today, for someone who clocks in. */
  shift: PersonShift | null;
};

export type ActivityToday = {
  dayKey: string;
  /** People's actions today (the same count the hours and the people add up to). */
  actions: number;
  hourly: number[];
  money: { total: number; count: number; methods: { label: string; total: number }[] };
  orders: { count: number; total: number };
  /** Done today, of those plus the ones due today still open. */
  tasks: { done: number; of: number };
  hours: { minutes: number; workers: number; onShiftNow: number };
  people: PersonDay[];
};

const isCreate = (action: string) => action === "INSERT" || action === "create";
const isUpdate = (action: string) => action === "UPDATE" || action === "update" || action === "status_changed";
const DONE = new Set(["done", "completed"]);

function emptyPerson(userId: string): PersonDay {
  return {
    userId,
    actions: 0,
    firstAt: null,
    lastAt: null,
    loginAt: null,
    logoutAt: null,
    orders: 0,
    deliveries: 0,
    payments: 0,
    paymentsTotal: 0,
    tasksNew: 0,
    tasksDone: 0,
    expenses: 0,
    customers: 0,
    projects: 0,
    documents: 0,
    hourly: Array(24).fill(0),
    shift: null,
  };
}

/**
 * The day's log rows → the hourly count and each person's day. `userIdOf` maps
 * a row's changed_by (a users.id, or the login id the database writes) to the
 * person's users.id. Rows must be oldest first.
 */
export function summarizeDayRows(
  rows: DayLogRow[],
  userIdOf: (changedBy: string) => string | null
): { actions: number; hourly: number[]; people: Map<string, PersonDay> } {
  const hourly = Array(24).fill(0) as number[];
  const people = new Map<string, PersonDay>();
  let actions = 0;

  for (const row of rows) {
    if (!row.changed_by) continue; // the system's own rows aren't anyone's activity
    const userId = userIdOf(row.changed_by) ?? row.changed_by;
    const person = people.get(userId) ?? emptyPerson(userId);
    people.set(userId, person);

    if (row.table_name === "auth") {
      if (row.action === "login" && !person.loginAt) person.loginAt = row.created_at;
      if (row.action === "logout") person.logoutAt = row.created_at;
      continue;
    }
    if (row.table_name === "system" || isChildAuditTable(row.table_name)) continue;

    const hour = israelHourOf(row.created_at);
    if (hour === null) continue;
    actions += 1;
    hourly[hour] += 1;
    person.actions += 1;
    person.hourly[hour] += 1;
    person.firstAt ??= row.created_at;
    person.lastAt = row.created_at;

    const created = isCreate(row.action);
    const becameDone = isUpdate(row.action) && DONE.has(row.status_to ?? "") && !DONE.has(row.status_from ?? "");
    switch (row.table_name) {
      case "orders":
        if (created) person.orders += 1;
        else if (isUpdate(row.action) && row.status_to === "delivered" && row.status_from !== "delivered") person.deliveries += 1;
        break;
      case "payments":
        if (created && row.method !== CARD_REFUND_METHOD) {
          person.payments += 1;
          const amount = Number(row.amount);
          if (Number.isFinite(amount)) person.paymentsTotal += amount;
        }
        break;
      case "tasks":
        if (created) person.tasksNew += 1;
        else if (becameDone) person.tasksDone += 1;
        break;
      case "expenses":
        if (created) person.expenses += 1;
        break;
      case "customers":
        if (created) person.customers += 1;
        break;
      case "projects":
        if (created) person.projects += 1;
        break;
      case "documents":
        if (created || row.action === "upload") person.documents += 1;
        break;
    }
  }
  return { actions, hourly, people };
}

type SessionRow = { user_id: string | null; clock_in: string | null; clock_out: string | null };

/**
 * Minutes of work inside the day from a set of clock sessions: each clipped to
 * the day (a shift from last night counts from midnight) and an open one
 * counted up to now, at most 16 hours (a forgotten clock-out isn't a 30-hour day).
 */
export function workedMinutesToday(sessions: SessionRow[], dayStartMs: number, dayEndMs: number, nowMs: number): number {
  let minutes = 0;
  for (const s of sessions) {
    if (!s.clock_in) continue;
    const start = Math.max(new Date(s.clock_in).getTime(), dayStartMs);
    const rawEnd = s.clock_out ? new Date(s.clock_out).getTime() : Math.min(nowMs, new Date(s.clock_in).getTime() + 16 * 3600_000);
    const end = Math.min(rawEnd, dayEndMs, nowMs);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) minutes += (end - start) / 60000;
  }
  return Math.round(minutes);
}

async function loadDayLogRows(supabase: SupabaseClient, startIso: string): Promise<DayLogRow[]> {
  const PAGE = 1000;
  const rows: DayLogRow[] = [];
  // The database answers at most 1000 rows at a time; a busy day can pass that.
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await supabase
      .from("audit_logs")
      .select("created_at,changed_by,table_name,action,status_to:new_data->>status,status_from:old_data->>status,amount:new_data->>amount_total,method:new_data->>payment_method")
      .gte("created_at", startIso)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error || !data) break;
    rows.push(...(data as unknown as DayLogRow[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

/** The whole picture of one Israeli day (normally today), for the activity page. */
export async function loadActivityToday(
  supabase: SupabaseClient,
  dayKey: string,
  nowMs: number = Date.now()
): Promise<ActivityToday> {
  const startMs = israelDayStart(dayKey).getTime();
  const endMs = israelDayStart(shiftDayKey(dayKey, 1)).getTime();
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();

  const [users, logRows, payments, orders, tasksDone, tasksDue, sessions] = await Promise.all([
    supabase.from("users").select("id,auth_user_id").range(0, 999),
    loadDayLogRows(supabase, startIso),
    // Recorded today — not dated today: a payment can be entered weeks ahead
    // with a future date (an expected transfer, a post-dated check), and that
    // isn't money that came in today. This is also what the feed shows.
    // A card statement's refund is recorded as income in its domain, but no money came in.
    supabase.from("payments").select("amount_total,payment_method").gte("created_at", startIso).lt("created_at", endIso).neq("payment_method", CARD_REFUND_METHOD).range(0, 999),
    supabase.from("orders").select("total_amount").gte("created_at", startIso).lt("created_at", endIso).range(0, 999),
    supabase.from("tasks").select("id").gte("completed_at", startIso).lt("completed_at", endIso).in("status", ["done"]).range(0, 999),
    supabase.from("tasks").select("id").gte("due_date", startIso).lt("due_date", endIso).in("status", ["todo", "in_progress"]).range(0, 999),
    supabase.from("attendance_sessions").select("user_id,clock_in,clock_out").lt("clock_in", endIso).or(`clock_out.is.null,clock_out.gte."${startIso}"`).gte("clock_in", new Date(startMs - 24 * 3600_000).toISOString()).range(0, 999),
  ]);

  const userIdByValue = new Map<string, string>();
  for (const u of (users.data ?? []) as { id?: string; auth_user_id?: string | null }[]) {
    if (typeof u.id !== "string") continue;
    userIdByValue.set(u.id, u.id);
    if (typeof u.auth_user_id === "string" && u.auth_user_id) userIdByValue.set(u.auth_user_id, u.id);
  }
  const { actions, hourly, people } = summarizeDayRows(logRows, (value) => userIdByValue.get(value) ?? null);

  // Money recorded today, by how it was paid.
  const byMethod = new Map<string, number>();
  let moneyTotal = 0;
  const paymentRows = (payments.data ?? []) as { amount_total?: number | string | null; payment_method?: string | null }[];
  for (const p of paymentRows) {
    const amount = Number(p.amount_total);
    if (!Number.isFinite(amount)) continue;
    moneyTotal += amount;
    const label = PAYMENT_METHOD_LABELS[p.payment_method ?? ""] ?? "אחר";
    byMethod.set(label, (byMethod.get(label) ?? 0) + amount);
  }

  // Orders opened today. ("draft" is every open order's status until it's
  // delivered — not an unfinished one — so it counts.)
  const orderRows = (orders.data ?? []) as { total_amount?: number | string | null }[];
  const ordersTotal = orderRows.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

  // Tasks: those done today, of those plus the ones still open that were due today.
  const doneIds = new Set(((tasksDone.data ?? []) as { id: string }[]).map((t) => t.id));
  const dueIds = new Set(((tasksDue.data ?? []) as { id: string }[]).map((t) => t.id));
  const forToday = new Set([...doneIds, ...dueIds]);

  // Hours on the clock today, and each person's shift.
  const sessionRows = (sessions.data ?? []) as SessionRow[];
  const byWorker = new Map<string, SessionRow[]>();
  for (const s of sessionRows) {
    if (!s.user_id) continue;
    byWorker.set(s.user_id, [...(byWorker.get(s.user_id) ?? []), s]);
  }
  let onShiftNow = 0;
  for (const [userId, list] of byWorker) {
    const minutes = workedMinutesToday(list, startMs, endMs, nowMs);
    const clockIns = list.map((s) => s.clock_in).filter((v): v is string => Boolean(v)).sort();
    const open = list.some((s) => !s.clock_out && s.clock_in && nowMs - new Date(s.clock_in).getTime() < 16 * 3600_000);
    if (open) onShiftNow += 1;
    const clockOuts = list.map((s) => s.clock_out).filter((v): v is string => Boolean(v)).sort();
    const person = people.get(userId) ?? emptyPerson(userId);
    person.shift = {
      clockIn: clockIns[0] ?? startIso,
      clockOut: open ? null : clockOuts[clockOuts.length - 1] ?? null,
      minutes,
    };
    people.set(userId, person);
  }
  const workedMinutes = Array.from(byWorker.values()).reduce(
    (sum, list) => sum + workedMinutesToday(list, startMs, endMs, nowMs),
    0
  );

  return {
    dayKey,
    actions,
    hourly,
    money: {
      total: moneyTotal,
      count: paymentRows.length,
      methods: Array.from(byMethod, ([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total),
    },
    orders: { count: orderRows.length, total: ordersTotal },
    tasks: { done: doneIds.size, of: forToday.size },
    hours: { minutes: workedMinutes, workers: byWorker.size, onShiftNow },
    people: Array.from(people.values()).sort((a, b) => b.actions - a.actions || a.userId.localeCompare(b.userId)),
  };
}

/** Hebrew count phrases that read for one or many ("הזמנה חדשה" / "3 הזמנות חדשות"). */
function counted(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n.toLocaleString("he-IL")} ${many}`;
}

/**
 * What a person got done today, as short phrases for their day card — the
 * biggest things first: "3 הזמנות חדשות", "2 תשלומים · ₪4,700", "4 משימות בוצעו".
 */
export function personHighlights(p: PersonDay): string[] {
  const out: string[] = [];
  if (p.orders) out.push(counted(p.orders, "הזמנה חדשה", "הזמנות חדשות"));
  if (p.deliveries) out.push(counted(p.deliveries, "הזמנה נמסרה", "הזמנות נמסרו"));
  if (p.payments) {
    const money = p.paymentsTotal > 0 ? ` · ₪${Math.round(p.paymentsTotal).toLocaleString("he-IL")}` : "";
    out.push(`${counted(p.payments, "תשלום אחד", "תשלומים")}${money}`);
  }
  if (p.tasksDone) out.push(counted(p.tasksDone, "משימה בוצעה", "משימות בוצעו"));
  if (p.tasksNew) out.push(counted(p.tasksNew, "משימה חדשה", "משימות חדשות"));
  if (p.expenses) out.push(counted(p.expenses, "הוצאה נרשמה", "הוצאות נרשמו"));
  if (p.customers) out.push(counted(p.customers, "לקוח חדש", "לקוחות חדשים"));
  if (p.projects) out.push(counted(p.projects, "פרויקט חדש", "פרויקטים חדשים"));
  if (p.documents) out.push(counted(p.documents, "מסמך הועלה", "מסמכים הועלו"));
  return out;
}

/** "8 שע' 35 דק'" — minutes of work as hours and minutes. */
export function formatWorkedMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} דק'`;
  return rest ? `${hours} שע' ${rest} דק'` : `${hours} שע'`;
}
