import type { SupabaseClient } from "@supabase/supabase-js";
import { reminderBucket } from "@/lib/notifications/categories";
import { DEFAULT_PREFS, sanitizeNotificationPrefs, type NotificationPrefs } from "@/lib/notifications/prefs";

// Reminders/Alerts unification — Phase 4: the worklist read model.
// One query over the unified `reminders` table returns everything that needs a
// given viewer's attention right now — both manual reminders they own and
// system reminders (issues) targeted at them or their role — excluding anything
// currently snoozed. This powers the "מה דורש טיפול" page and (later) the bell.

type Row = Record<string, unknown>;
export type WorklistSeverity = "info" | "warning" | "danger";

export type WorklistItem = {
  id: string;
  source: "manual" | "system";
  severity: WorklistSeverity;
  behavior: "silent" | "ping_once" | "ping_repeat";
  /** true for system summary rows (a count, no per-item action). */
  isSummary: boolean;
  title: string;
  content: string | null;
  url: string;
  category: string;
  remindAt: string;
  snoozedUntil: string | null;
  /** Push scheduling — when/whether this item will ping the phone. */
  nextPingAt: string | null;
  notifiedAt: string | null;
  assignedTo: string | null;
  audienceRole: string | null;
  createdBy: string | null;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  taskId: string | null;
  taskSubject: string | null;
  assignedToName: string | null;
  /** For system rows: 'rule:key'. The rule key is the prefix before the first ':'. */
  dedupeKey: string | null;
  /** Arrived since the viewer last opened their inbox. Set by getInboxView only. */
  isNew?: boolean;
};

const SELECT =
  "id,source,severity,behavior,title,content,url,category,remind_at,snoozed_until,next_ping_at,notified_at,dedupe_key," +
  "assigned_to,audience_role,created_by,customer_id,project_id,order_id,payment_id,task_id,vehicle_id,invoice_id,action_type";

const SEVERITY_RANK: Record<WorklistSeverity, number> = { danger: 0, warning: 1, info: 2 };

function str(row: Row, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.trim() ? v : null;
}

/**
 * Which audience_role buckets a viewer of the given role is ALLOWED to see.
 * This is a permission ceiling (used for the DB fetch + action authorization),
 * NOT what actually lands in their inbox — see ownAudienceRoles.
 */
export function visibleAudienceRoles(role: string | null | undefined): string[] {
  if (role === "admin") return ["all", "office", "admin"];
  if (role === "office") return ["all", "office"];
  // A worker gets NO role buckets — his inbox is his tasks and his own
  // reminders, nothing else. He used to be in the "all" bucket, which meant any
  // rule an admin pointed at 'all' in push_alert_config (overdue collections,
  // low stock, unpaid invoices…) landed on a driver's phone. Items still reach
  // him the two ways that are actually his: assigned_to = him, or a reminder he
  // created himself — both handled outside this function.
  return [];
}

/**
 * The buckets that are a viewer's OWN desk — what may INTERRUPT them (push)
 * without opting in. DELIVERY ONLY: this must never filter what a page shows.
 *
 * Note admin does NOT include "office": an admin SEES office items (they're in
 * the inbox, the dashboard and the nav badges via visibleAudienceRoles) but isn't
 * pushed them. That single difference is why the boss got 18 pushes of the
 * secretary's collection work on a Friday. He can opt back into being pushed per
 * bucket via notification_prefs.subscribe.
 */
export function ownAudienceRoles(role: string | null | undefined): string[] {
  if (role === "admin") return ["all", "admin"];
  if (role === "office") return ["all", "office"];
  // A worker is interrupted only by what is HIS: reminders assigned to him and
  // his task alerts (both routed by assigned_to, not by bucket) plus the daily
  // summary. Business-wide alerts are not his to chase. He can still opt into a
  // bucket explicitly via notification_prefs.subscribe.
  return [];
}

/** Manual reminders get a display title derived from what they're attached to. */
function manualTitle(row: Row, customerName: string | null, taskSubject: string | null): string {
  if (taskSubject) return `תזכורת: ${taskSubject}`;
  if (customerName) return `תזכורת: ${customerName}`;
  const content = str(row, "content");
  if (content) return content.length > 60 ? `${content.slice(0, 57)}…` : content;
  return "תזכורת";
}

function manualUrl(row: Row): string {
  const taskId = str(row, "task_id");
  if (taskId) return `/tasks/${taskId}`;
  const orderId = str(row, "order_id");
  if (orderId) return `/sales/orders/${orderId}`;
  const projectId = str(row, "project_id");
  if (projectId) return `/projects/${projectId}`;
  const vehicleId = str(row, "vehicle_id");
  if (vehicleId) return `/vehicles/${vehicleId}`;
  const invoiceId = str(row, "invoice_id");
  if (invoiceId) return "/invoices";
  const customerId = str(row, "customer_id");
  if (customerId) return `/customers/${customerId}`;
  return "/inbox";
}

/**
 * Everything the viewer is allowed to SEE, open and unresolved.
 *
 * Three separate questions, decided in three different places — keep them apart:
 *
 *   1. CAN I see it?      → my role (visibleAudienceRoles). Deliberately broad:
 *                           an admin sees the office's findings, because the
 *                           inbox is where you go to ask "what's outstanding?"
 *                           and it must give the real answer.
 *   2. DO I want to see it? → me, via notification_prefs.muted (default: empty →
 *                           I see everything I'm allowed to). The ONLY user-facing
 *                           visibility filter.
 *   3. Does it INTERRUPT me? → the deliver cron (ownAudienceRoles + subscribe +
 *                           delivery mode). Never affects this function.
 *
 * (2) and (3) were once conflated, which silently hid ~12 of the 16 rules from
 * every admin's inbox, dashboard card and nav badges — because those rules target
 * 'office'. Not being pushed something must never mean not being shown it.
 */
export async function getWorklist(
  supabase: SupabaseClient,
  options: {
    userId: string;
    role: string | null;
    limit?: number;
    includeSnoozed?: boolean;
    /** Pass to avoid a re-fetch; omitted → loaded here. */
    prefs?: NotificationPrefs;
  }
): Promise<WorklistItem[]> {
  const { userId, role } = options;
  const limit = options.limit ?? 500;
  const roles = visibleAudienceRoles(role);

  // Visible to me = assigned to me, OR an UNASSIGNED reminder I created (so a
  // reminder I made FOR someone else is theirs, not mine), OR a system reminder
  // aimed at one of my role buckets.
  const visibility = [
    `assigned_to.eq.${userId}`,
    `and(assigned_to.is.null,created_by.eq.${userId})`,
    // Empty for a worker — an `in.()` with no values is invalid PostgREST and
    // would match nothing useful anyway.
    ...(roles.length > 0 ? [`audience_role.in.(${roles.join(",")})`] : []),
  ].join(",");

  const { data, error } = await supabase
    .from("reminders")
    .select(SELECT)
    .eq("status", "pending")
    .or(visibility)
    .order("remind_at", { ascending: true })
    .range(0, limit - 1);

  if (error || !data) return [];
  // Hide currently-snoozed items (done in JS to keep a single .or() filter).
  const nowMs = Date.now();
  const rows = options.includeSnoozed
    ? (data as unknown as Row[])
    : (data as unknown as Row[]).filter((r) => {
        const snoozed = str(r, "snoozed_until");
        if (!snoozed) return true;
        const t = new Date(snoozed).getTime();
        return Number.isNaN(t) || t <= nowMs;
      });

  // enrichRows (reads `rows`) and the prefs lookup (reads `userId`) don't depend
  // on each other's output — run them concurrently rather than one after another.
  // The one visibility choice the USER owns: topics they've muted are hidden
  // everywhere they'd otherwise appear (inbox, dashboard, badges, page bars).
  // Default is nothing muted → you see everything your role permits.
  const [items, prefs] = await Promise.all([
    enrichRows(supabase, rows),
    options.prefs ? Promise.resolve(options.prefs) : loadPrefs(supabase, userId),
  ]);
  const visible = prefs.muted.length
    ? items.filter((i) => !prefs.muted.includes(inboxBucket(i)))
    : items;

  return visible.sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) return s;
    return a.remindAt.localeCompare(b.remindAt);
  });
}

/** The viewer's prefs, fetched once per read model (tolerant of a missing column). */
async function loadPrefs(supabase: SupabaseClient, userId: string): Promise<NotificationPrefs> {
  try {
    const { data } = await supabase.from("users").select("notification_prefs").eq("id", userId).maybeSingle();
    return sanitizeNotificationPrefs((data as { notification_prefs?: unknown } | null)?.notification_prefs);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

// Shared enrichment: resolve customer / task / assignee display info and map raw
// `reminders` rows to WorklistItem[]. Used by every reminder read model here.
async function enrichRows(supabase: SupabaseClient, rows: Row[]): Promise<WorklistItem[]> {
  const customerIds = [...new Set(rows.map((r) => str(r, "customer_id")).filter((v): v is string => Boolean(v)))];
  const taskIds = [...new Set(rows.map((r) => str(r, "task_id")).filter((v): v is string => Boolean(v)))];
  const assigneeIds = [...new Set(rows.map((r) => str(r, "assigned_to")).filter((v): v is string => Boolean(v)))];

  const [customersRes, tasksRes, usersRes] = await Promise.all([
    customerIds.length ? supabase.from("customers").select("id,name,phone").in("id", customerIds) : Promise.resolve({ data: [] as Row[] }),
    taskIds.length ? supabase.from("tasks").select("id,subject").in("id", taskIds) : Promise.resolve({ data: [] as Row[] }),
    assigneeIds.length ? supabase.from("users").select("id,full_name,email").in("id", assigneeIds) : Promise.resolve({ data: [] as Row[] }),
  ]);

  const customerById = new Map<string, { name: string | null; phone: string | null }>();
  for (const r of (customersRes.data ?? []) as unknown as Row[]) {
    const id = str(r, "id");
    if (id) customerById.set(id, { name: str(r, "name"), phone: str(r, "phone") });
  }
  const taskById = new Map<string, string>();
  for (const r of (tasksRes.data ?? []) as unknown as Row[]) {
    const id = str(r, "id");
    if (id) taskById.set(id, str(r, "subject") ?? "משימה");
  }
  const userById = new Map<string, string>();
  for (const r of (usersRes.data ?? []) as unknown as Row[]) {
    const id = str(r, "id");
    if (id) userById.set(id, str(r, "full_name") ?? str(r, "email") ?? id.slice(0, 8));
  }

  return rows.map((r) => {
    const source = str(r, "source") === "system" ? "system" : "manual";
    const behavior = (str(r, "behavior") ?? "ping_once") as WorklistItem["behavior"];
    const severity = (str(r, "severity") ?? "info") as WorklistSeverity;
    const cust = customerById.get(str(r, "customer_id") ?? "");
    const taskSubject = taskById.get(str(r, "task_id") ?? "") ?? null;
    const title = source === "system" ? str(r, "title") ?? "התראה" : manualTitle(r, cust?.name ?? null, taskSubject);
    const url = source === "system" ? str(r, "url") ?? "/inbox" : manualUrl(r);
    return {
      id: str(r, "id") ?? "",
      source,
      severity,
      behavior,
      isSummary: source === "system" && behavior === "silent",
      title,
      content: str(r, "content"),
      url,
      category: str(r, "category") ?? "collection",
      remindAt: str(r, "remind_at") ?? "",
      snoozedUntil: str(r, "snoozed_until"),
      nextPingAt: str(r, "next_ping_at"),
      notifiedAt: str(r, "notified_at"),
      assignedTo: str(r, "assigned_to"),
      audienceRole: str(r, "audience_role"),
      createdBy: str(r, "created_by"),
      customerId: str(r, "customer_id"),
      customerName: cust?.name ?? null,
      customerPhone: cust?.phone ?? null,
      taskId: str(r, "task_id"),
      taskSubject,
      assignedToName: userById.get(str(r, "assigned_to") ?? "") ?? null,
      dedupeKey: str(r, "dedupe_key"),
    };
  });
}

/**
 * Manual reminders I created but assigned to SOMEONE ELSE. My own worklist only
 * shows reminders assigned to me (a reminder I made FOR someone else is theirs),
 * so without this a reminder I set for another person would vanish from my view.
 * This read model surfaces them back to the creator (tracking, not action).
 */
export async function getCreatedByMeReminders(
  supabase: SupabaseClient,
  options: { userId: string }
): Promise<WorklistItem[]> {
  const { userId } = options;
  const { data, error } = await supabase
    .from("reminders")
    .select(SELECT)
    .eq("status", "pending")
    .eq("source", "manual")
    .eq("created_by", userId)
    .not("assigned_to", "is", null)
    .neq("assigned_to", userId)
    .order("remind_at", { ascending: true })
    .range(0, 199);
  if (error || !data) return [];
  const nowMs = Date.now();
  const rows = (data as unknown as Row[]).filter((r) => {
    const snoozed = str(r, "snoozed_until");
    if (!snoozed) return true;
    const t = new Date(snoozed).getTime();
    return Number.isNaN(t) || t <= nowMs;
  });
  const items = await enrichRows(supabase, rows);
  return items.sort((a, b) => a.remindAt.localeCompare(b.remindAt));
}

// --- Sectioned view (for the "מה דורש טיפול" worklist page) -----------------
//
// The worklist is a TRIAGE surface, not a second copy of every workspace. So:
//   * things with their own page (collections, invoices, vehicles, payroll,
//     inventory) collapse to a single summary line that links out;
//   * discrete one-off actions (my reminders, tasks, a check to deposit, a
//     payment to collect, a project nudge) are listed individually.

export type WorklistSummary = {
  id: string;
  title: string;
  href: string;
  severity: WorklistSeverity;
  /** The system rule behind the line — a summary's `id` can't be parsed for it
   *  (count-in-title rows carry a reminder id, collapsed rows carry `sum-<rule>`). */
  ruleKey: string;
  /** How many underlying items this line stands for. */
  count: number;
};
const RANK_TO_SEVERITY: WorklistSeverity[] = ["danger", "warning", "info"];

// Per-item rules that collapse to ONE summary line (they own a workspace page).
const COLLAPSE_META: Record<string, { label: string; href: string }> = {
  collection_overdue: { label: "חובות באיחור לגבייה", href: "/collections?view=debtors&filter=overdue" },
  invoice_unpaid: { label: "חשבוניות לא משולמות", href: "/invoices" },
  vehicle_expiry: { label: "רכבים — טסט/ביטוח/רישוי", href: "/vehicles" },
  wage_overdue: { label: "שכר עובדים לתשלום", href: "/payroll" },
  payment_outflow_due: { label: "תשלומים לתשלום", href: "/financial/payments-calendar" },
};

function ruleKeyOf(item: WorklistItem): string {
  if (item.source !== "system") return "reminders";
  return (item.dedupeKey ?? "").split(":")[0] || "system";
}

// --- Inbox read model (the ONE list — replaces the sectioned worklist) -------
//
// Redesign §3.2: one inbox, filtered by ORIGIN rather than split across six
// life-area sections. "שלי" = a reminder a human set. "אוטומטי" = the system
// noticed something. Own-a-workspace rules still collapse to a single line so
// the list stays scannable (17 debts = 1 row, not 17).

export type InboxOrigin = "mine" | "auto";

export type InboxView = {
  /** Flat, sorted, non-snoozed, non-collapsed items. */
  items: WorklistItem[];
  /** Collapsed own-a-page rules + silent count-in-title rows. Always origin=auto. */
  summaries: WorklistSummary[];
  /** Deferred items — shown last, never counted. */
  snoozed: WorklistItem[];
  counts: { all: number; mine: number; auto: number; new: number };
  /** Open items per notification bucket (money/tasks/…), for the filter chips. */
  byBucket: Record<string, number>;
};

/** A reminder a human set vs. something the engine found. */
export function inboxOrigin(item: WorklistItem): InboxOrigin {
  return item.source === "manual" ? "mine" : "auto";
}

/** Which notification bucket an item belongs to (money / tasks / projects / …). */
export function inboxBucket(item: WorklistItem): string {
  return reminderBucket({ source: item.source, category: item.category, dedupeKey: item.dedupeKey });
}

/** The whole inbox for one viewer: one list, origin-tagged, summaries collapsed. */
export async function getInboxView(
  supabase: SupabaseClient,
  options: { userId: string; role: string | null; seenAt?: string | null }
): Promise<InboxView> {
  const all = await getWorklist(supabase, { ...options, includeSnoozed: true });
  const nowMs = Date.now();
  const isSnoozed = (i: WorklistItem) => Boolean(i.snoozedUntil && new Date(i.snoozedUntil).getTime() > nowMs);

  const snoozed: WorklistItem[] = [];
  const active: WorklistItem[] = [];
  for (const i of all) (isSnoozed(i) ? snoozed : active).push(i);

  const items: WorklistItem[] = [];
  const summaries: WorklistSummary[] = [];
  const collapse = new Map<string, { count: number; rank: number }>();

  for (const item of active) {
    const rk = ruleKeyOf(item);
    if (COLLAPSE_META[rk]) {
      const agg = collapse.get(rk) ?? { count: 0, rank: 99 };
      agg.count += 1;
      agg.rank = Math.min(agg.rank, SEVERITY_RANK[item.severity]);
      collapse.set(rk, agg);
    } else if (item.isSummary) {
      // A count-in-title row ("מלאי נמוך: 3 פריטים") is ONE reminder that already
      // counted itself, so it stands for one row here.
      summaries.push({ id: item.id, title: item.title, href: item.url, severity: item.severity, ruleKey: rk, count: 1 });
    } else {
      items.push(item);
    }
  }
  for (const [rk, agg] of collapse) {
    summaries.push({
      id: `sum-${rk}`,
      title: `${COLLAPSE_META[rk].label}: ${agg.count}`,
      href: COLLAPSE_META[rk].href,
      severity: RANK_TO_SEVERITY[agg.rank] ?? "info",
      ruleKey: rk,
      count: agg.count,
    });
  }

  // "New" = arrived since the viewer last opened the inbox (users.inbox_seen_at).
  // Reminders have no per-user read flag — one timestamp per user answers "have I
  // looked at this yet" without a row per user per item.
  const seenMs = options.seenAt ? new Date(options.seenAt).getTime() : NaN;
  const isNew = (i: WorklistItem) => {
    if (Number.isNaN(seenMs)) return true; // never opened → everything is new
    const t = new Date(i.remindAt).getTime();
    return Number.isNaN(t) ? false : t > seenMs;
  };
  for (const i of items) i.isNew = isNew(i);

  const byBucket: Record<string, number> = {};
  for (const i of active) {
    const b = inboxBucket(i);
    byBucket[b] = (byBucket[b] ?? 0) + 1;
  }

  return {
    items,
    summaries,
    snoozed,
    counts: {
      all: active.length,
      mine: active.filter((i) => inboxOrigin(i) === "mine").length,
      auto: active.filter((i) => inboxOrigin(i) === "auto").length,
      new: items.filter(isNew).length,
    },
    byBucket,
  };
}

// --- The dashboard's "היום" slice -------------------------------------------
//
// Which system rules may appear on the dashboard's TODAY card. The test is
// whether a rule is DATED — it becomes true on the day the thing falls due and
// goes away once that day's work is done — as opposed to a BACKLOG, which stays
// true until someone works it off (overdue debts, low stock, an unbilled
// project, wages owed). A backlog on a card headed "היום" is what turned that
// card into a second copy of the inbox; backlogs belong in the inbox, where
// they can actually be worked through.
//
// Deliberately absent even though they ARE dated: task_overdue, task_due_soon,
// project_starting, project_deadline. The card lists today's tasks and projects
// straight from the calendar feed, so these rules would print the same row twice.
//
// A rule not listed here defaults to BACKLOG (inbox only) — the safe side: a new
// rule can't quietly start filling up the dashboard.
//
// Each rule gets its OWN label + href here rather than reusing COLLAPSE_META,
// because these two surfaces want opposite things: the inbox lists five cheques
// as five rows you tick off one by one, while the dashboard wants ONE line that
// says "five cheques are waiting". Adding them to COLLAPSE_META would collapse
// them in the inbox too, which would take away the ticking.
const TODAY_RULES: Record<string, { label: string; href: string }> = {
  check_deposit_due: { label: "צ׳קים להפקדה", href: "/checks" },
  payment_due_today: { label: "תשלומים לגבייה היום", href: "/collections" },
  payment_outflow_due: { label: "תשלומים לתשלום", href: "/financial/payments-calendar" },
};

/** One grouped line per dated rule — "צ׳קים להפקדה: 5", never five cheque rows. */
export type TodayAlert = {
  id: string;
  title: string;
  href: string;
  severity: WorklistSeverity;
  count: number;
};

/**
 * The dated slice of the inbox, GROUPED — what the dashboard's "היום" card shows
 * below the day's actual schedule.
 *
 * Grouped because the card answers "what do I have to do today", and a list of
 * five near-identical "צ׳ק לפירעון" rows reads as a heavy day when it's really
 * one errand at the bank. The user's words: "technically I barely have anything
 * to do today but I see a whole huge list."
 *
 * `rest` = open inbox rows this card does NOT stand for, for the quiet tail link.
 */
export function todaySlice(inbox: InboxView): { alerts: TodayAlert[]; rest: number } {
  const agg = new Map<string, { count: number; rank: number }>();
  let foldedRows = 0;

  const add = (ruleKey: string, count: number, severity: WorklistSeverity) => {
    if (!TODAY_RULES[ruleKey]) return false;
    const cur = agg.get(ruleKey) ?? { count: 0, rank: 99 };
    cur.count += count;
    cur.rank = Math.min(cur.rank, SEVERITY_RANK[severity]);
    agg.set(ruleKey, cur);
    return true;
  };

  for (const item of inbox.items) {
    if (add(ruleKeyOf(item), 1, item.severity)) foldedRows += 1;
  }
  // Rules the inbox ALREADY collapsed (payment_outflow_due) arrive as one row
  // standing for `count` bills — take the count so the number matches the
  // payments calendar, but only one inbox row has been folded away.
  for (const summary of inbox.summaries) {
    if (add(summary.ruleKey, summary.count, summary.severity)) foldedRows += 1;
  }

  const alerts = [...agg]
    .map(([ruleKey, a]) => ({
      id: `today-${ruleKey}`,
      title: `${TODAY_RULES[ruleKey].label}: ${a.count}`,
      href: TODAY_RULES[ruleKey].href,
      severity: RANK_TO_SEVERITY[a.rank] ?? "info",
      count: a.count,
    }))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  return {
    alerts,
    rest: Math.max(inbox.items.length + inbox.summaries.length - foldedRows, 0),
  };
}

// Which sidebar entry each RULE badges. Per-rule (not per-section) so nested
// routes light up too — a section-level map could only ever badge one destination
// per area, so /checks, /financial and /sales silently never badged.
// A rule with no single home is simply absent → no misleading badge.
const RULE_NAV_URL: Record<string, string> = {
  // tasks
  task_overdue: "/tasks",
  task_due_soon: "/tasks",
  // money — each to the page that actually resolves it
  collection_overdue: "/collections",
  payment_due_today: "/collections",
  promise_broken: "/collections",
  check_deposit_due: "/checks",
  payment_outflow_due: "/financial/payments-calendar",
  recurring_payment_reminder: "/financial/payments-calendar",
  recurring_expense_confirm: "/financial",
  unprocessed_items: "/financial/statements",
  // projects
  project_deadline: "/projects",
  project_starting: "/projects",
  stale_quote: "/projects",
  project_closed_unbilled: "/projects",
  // payroll
  wage_overdue: "/payroll",
  // ops
  low_stock: "/sales",
  vehicle_expiry: "/vehicles",
};

export type NavCountSeverity = "danger" | "warning" | "info";
export type NavCount = { count: number; severity: NavCountSeverity };

/**
 * Open-worklist counts keyed by nav URL, for sidebar badges. Counts the same
 * actionable items the worklist shows me (my visibility), skipping silent
 * summaries. Severity = the most urgent item feeding that nav entry.
 */
export async function getWorklistNavCounts(
  supabase: SupabaseClient,
  options: { userId: string; role: string | null }
): Promise<Record<string, NavCount>> {
  const items = await getWorklist(supabase, options);
  const out: Record<string, NavCount> = {};
  for (const item of items) {
    const ruleKey = item.source === "system" ? (item.dedupeKey ?? "").split(":")[0] : "reminders";
    // Skip true count-in-title summaries (low_stock: "N items") — counting them
    // as 1 would undercount. But COLLAPSE_META rules (collection_overdue, …) are
    // real per-item reminders shown collapsed, so count them per item — that's
    // what keeps the badge equal to the inbox's "N" line.
    if (item.isSummary && !COLLAPSE_META[ruleKey]) continue;
    // Manual reminders have no single nav home (they live in the inbox) → not badged.
    const url = item.source === "manual" ? undefined : RULE_NAV_URL[ruleKey];
    if (!url) continue;
    const cur = out[url] ?? { count: 0, severity: "info" as NavCountSeverity };
    cur.count += 1;
    if (SEVERITY_RANK[item.severity] < SEVERITY_RANK[cur.severity]) cur.severity = item.severity as NavCountSeverity;
    out[url] = cur;
  }
  return out;
}

export type PageAlert = { id: string; title: string; href: string; severity: WorklistSeverity };

/**
 * The subset of the viewer's worklist relevant to a specific page, for a
 * contextual banner at the top of that page (e.g. low_stock on /sales). Same
 * collapse rules as the worklist so a bar reads "חובות באיחור: 17", not 17 bars.
 */
export async function getPageAlerts(
  supabase: SupabaseClient,
  options: { userId: string; role: string | null; keys: string[] }
): Promise<PageAlert[]> {
  const wanted = new Set(options.keys);
  if (wanted.size === 0) return [];
  const items = await getWorklist(supabase, { userId: options.userId, role: options.role });
  const out: PageAlert[] = [];
  const collapse = new Map<string, { count: number; rank: number }>();
  for (const item of items) {
    const rk = item.source === "system" ? (item.dedupeKey ?? "").split(":")[0] : "reminders";
    if (!wanted.has(rk)) continue;
    if (COLLAPSE_META[rk]) {
      const agg = collapse.get(rk) ?? { count: 0, rank: 99 };
      agg.count += 1;
      agg.rank = Math.min(agg.rank, SEVERITY_RANK[item.severity]);
      collapse.set(rk, agg);
    } else {
      out.push({ id: item.id, title: item.title, href: item.url, severity: item.severity });
    }
  }
  for (const [rk, agg] of collapse) {
    out.push({
      id: `sum-${rk}`,
      title: `${COLLAPSE_META[rk].label}: ${agg.count}`,
      href: COLLAPSE_META[rk].href,
      severity: RANK_TO_SEVERITY[agg.rank] ?? "info",
    });
  }
  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
