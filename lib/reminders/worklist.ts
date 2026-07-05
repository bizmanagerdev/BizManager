import type { SupabaseClient } from "@supabase/supabase-js";

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
};

const SELECT =
  "id,source,severity,behavior,title,content,url,category,remind_at,snoozed_until,next_ping_at,notified_at,dedupe_key," +
  "assigned_to,audience_role,created_by,customer_id,project_id,order_id,payment_id,task_id,vehicle_id,invoice_id,action_type";

const SEVERITY_RANK: Record<WorklistSeverity, number> = { danger: 0, warning: 1, info: 2 };

function str(row: Row, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.trim() ? v : null;
}

/** Which audience_role buckets a viewer of the given role can see. */
export function visibleAudienceRoles(role: string | null | undefined): string[] {
  if (role === "admin") return ["all", "office", "admin"];
  if (role === "office") return ["all", "office"];
  return ["all"];
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
  return "/alerts";
}

export async function getWorklist(
  supabase: SupabaseClient,
  options: { userId: string; role: string | null; limit?: number; includeSnoozed?: boolean }
): Promise<WorklistItem[]> {
  const { userId, role } = options;
  const limit = options.limit ?? 500;
  const roles = visibleAudienceRoles(role);

  // Visible to me = assigned to me, OR an UNASSIGNED reminder I created (so a
  // reminder I made FOR someone else is theirs, not mine), OR a system reminder
  // aimed at one of my role buckets.
  const visibility =
    `assigned_to.eq.${userId},and(assigned_to.is.null,created_by.eq.${userId}),audience_role.in.(${roles.join(",")})`;

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

  // Enrich manual rows with customer / task / assignee display info.
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

  const items: WorklistItem[] = rows.map((r) => {
    const source = str(r, "source") === "system" ? "system" : "manual";
    const behavior = (str(r, "behavior") ?? "ping_once") as WorklistItem["behavior"];
    const severity = (str(r, "severity") ?? "info") as WorklistSeverity;
    const cust = customerById.get(str(r, "customer_id") ?? "");
    const taskSubject = taskById.get(str(r, "task_id") ?? "") ?? null;
    const title = source === "system" ? str(r, "title") ?? "התראה" : manualTitle(r, cust?.name ?? null, taskSubject);
    const url = source === "system" ? str(r, "url") ?? "/alerts" : manualUrl(r);
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

  return items.sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) return s;
    return a.remindAt.localeCompare(b.remindAt);
  });
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
};
export type WorklistSectionView = {
  key: string;
  title: string;
  items: WorklistItem[];
  summaries: WorklistSummary[];
};

const RANK_TO_SEVERITY: WorklistSeverity[] = ["danger", "warning", "info"];

// The user-customizable sections (toggle + reorder), in default order. The
// "snoozed" section is deliberately NOT here — it's system behavior, always
// shown last and never hidden.
export const WORKLIST_SECTIONS: Array<{ id: string; label: string }> = [
  { id: "reminders", label: "תזכורות שלי" },
  { id: "tasks", label: "משימות" },
  { id: "money", label: "כסף להיום" },
  { id: "hours", label: "שכר ושעות עבודה" },
  { id: "projects", label: "פרויקטים" },
  { id: "ops", label: "מלאי ותפעול" },
];
const SNOOZED_SECTION = { key: "snoozed", title: "נדחו לזמן מאוחר" };
const SECTION_TITLE = new Map<string, string>([
  ...WORKLIST_SECTIONS.map((s) => [s.id, s.label] as [string, string]),
  [SNOOZED_SECTION.key, SNOOZED_SECTION.title],
]);

export type WorklistPrefs = { order: string[]; hidden: string[] };

const KNOWN_SECTION_IDS = new Set(WORKLIST_SECTIONS.map((s) => s.id));
const isSectionId = (v: unknown): v is string => typeof v === "string" && KNOWN_SECTION_IDS.has(v);

/** Coerce arbitrary JSON (DB / request body) into clean WorklistPrefs, or null. */
export function sanitizeWorklistPrefs(value: unknown): WorklistPrefs | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { order?: unknown; hidden?: unknown };
  const order = Array.isArray(raw.order) ? raw.order.filter(isSectionId) : [];
  const seen = new Set<string>();
  const dedupedOrder = order.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
  const hidden = Array.isArray(raw.hidden) ? [...new Set(raw.hidden.filter(isSectionId))] : [];
  return { order: dedupedOrder, hidden };
}

/** The customizable sections reordered by saved prefs (nothing hidden) — for the customizer. */
export function orderedWorklistSections(prefs: WorklistPrefs | null): Array<{ id: string; label: string }> {
  const order = prefs?.order ?? [];
  const idx = new Map<string, number>();
  order.forEach((id, i) => idx.set(id, i));
  return [...WORKLIST_SECTIONS]
    .map((s, defaultIdx) => ({ s, defaultIdx }))
    .sort((a, b) => {
      const ai = idx.has(a.s.id) ? idx.get(a.s.id)! : Number.POSITIVE_INFINITY;
      const bi = idx.has(b.s.id) ? idx.get(b.s.id)! : Number.POSITIVE_INFINITY;
      return ai !== bi ? ai - bi : a.defaultIdx - b.defaultIdx;
    })
    .map((e) => e.s);
}

// The ordered list of section keys to actually render (customizable ones per
// prefs, minus hidden, then always the snoozed section last).
function resolvedSectionKeys(prefs: WorklistPrefs | null): string[] {
  const hidden = new Set(prefs?.hidden ?? []);
  const visible = orderedWorklistSections(prefs)
    .map((s) => s.id)
    .filter((id) => !hidden.has(id));
  return [...visible, SNOOZED_SECTION.key];
}

export async function getWorklistPrefs(supabase: SupabaseClient, userId: string): Promise<WorklistPrefs | null> {
  const { data, error } = await supabase.from("users").select("worklist_prefs").eq("id", userId).maybeSingle();
  if (error) return null; // column may not exist yet → defaults
  return sanitizeWorklistPrefs((data as { worklist_prefs?: unknown } | null)?.worklist_prefs);
}

// Which section each system rule belongs to (manual reminders → "reminders").
const RULE_SECTION: Record<string, string> = {
  task_overdue: "tasks",
  task_due_soon: "tasks",
  nightly_review: "tasks",
  check_deposit_due: "money",
  payment_due_today: "money",
  promise_broken: "money",
  collection_overdue: "money",
  invoice_unpaid: "money",
  wage_overdue: "hours",
  session_unallocated: "hours",
  project_deadline: "projects",
  project_starting: "projects",
  stale_quote: "projects",
  project_closed_unbilled: "projects",
  low_stock: "ops",
  unprocessed_items: "ops",
  vehicle_expiry: "ops",
  // active_projects intentionally omitted → excluded from the worklist
};

// Per-item rules that collapse to ONE summary line (they own a workspace page).
const COLLAPSE_META: Record<string, { label: string; href: string }> = {
  collection_overdue: { label: "חובות באיחור לגבייה", href: "/collections?view=debtors&filter=overdue" },
  invoice_unpaid: { label: "חשבוניות לא משולמות", href: "/invoices" },
  vehicle_expiry: { label: "רכבים — טסט/ביטוח/רישוי", href: "/vehicles" },
  wage_overdue: { label: "שכר עובדים לתשלום", href: "/payroll" },
};

function ruleKeyOf(item: WorklistItem): string {
  if (item.source !== "system") return "reminders";
  return (item.dedupeKey ?? "").split(":")[0] || "system";
}

/** The worklist grouped into sections, with own-a-workspace rules collapsed. */
export async function getWorklistView(
  supabase: SupabaseClient,
  options: { userId: string; role: string | null; prefs?: WorklistPrefs | null }
): Promise<WorklistSectionView[]> {
  // Include snoozed items — they stay visible in their own "נדחו" section so a
  // snoozed reminder never just disappears.
  const items = await getWorklist(supabase, { ...options, includeSnoozed: true });
  const nowMs = Date.now();
  const isSnoozed = (i: WorklistItem) => Boolean(i.snoozedUntil && new Date(i.snoozedUntil).getTime() > nowMs);

  type Bucket = { items: WorklistItem[]; summaries: WorklistSummary[]; collapse: Map<string, { count: number; rank: number }> };
  const buckets = new Map<string, Bucket>();
  const bucket = (key: string) => {
    let b = buckets.get(key);
    if (!b) {
      b = { items: [], summaries: [], collapse: new Map() };
      buckets.set(key, b);
    }
    return b;
  };

  for (const item of items) {
    // Snoozed items collect in their own section (never collapsed) so the user
    // can see them and when they return.
    if (isSnoozed(item)) {
      bucket("snoozed").items.push(item);
      continue;
    }
    const rk = ruleKeyOf(item);
    const section = item.source === "manual" ? "reminders" : RULE_SECTION[rk];
    if (!section) continue; // unmapped rule (e.g. active_projects) → not shown here
    const b = bucket(section);

    if (COLLAPSE_META[rk]) {
      // Own-a-page rules collapse to ONE "label: N" line — regardless of whether
      // they push or are silent (checked before isSummary so a silent collapsible
      // rule like collection_overdue doesn't explode into one row per item).
      const agg = b.collapse.get(rk) ?? { count: 0, rank: 99 };
      agg.count += 1;
      agg.rank = Math.min(agg.rank, SEVERITY_RANK[item.severity]);
      b.collapse.set(rk, agg);
    } else if (item.isSummary) {
      // Silent summary rows already carry their count in the title.
      b.summaries.push({ id: item.id, title: item.title, href: item.url, severity: item.severity });
    } else {
      b.items.push(item);
    }
  }

  // Materialize collapsed rules into summary lines.
  for (const b of buckets.values()) {
    for (const [rk, agg] of b.collapse) {
      b.summaries.push({
        id: `sum-${rk}`,
        title: `${COLLAPSE_META[rk].label}: ${agg.count}`,
        href: COLLAPSE_META[rk].href,
        severity: RANK_TO_SEVERITY[agg.rank] ?? "info",
      });
    }
  }

  // Order + filter sections per the user's saved prefs (snoozed always last).
  return resolvedSectionKeys(options.prefs ?? null)
    .map((key) => {
      const b = buckets.get(key);
      return { key, title: SECTION_TITLE.get(key) ?? key, items: b?.items ?? [], summaries: b?.summaries ?? [] };
    })
    .filter((s) => s.items.length > 0 || s.summaries.length > 0);
}

// --- Grouped summary (for the dashboard "מרכז התראות" widget) ---------------

export type WorklistGroup = {
  id: string;
  title: string;
  description: string;
  href: string;
  count: number;
  severity: WorklistSeverity;
};

// Per rule key: the group label + canonical destination. Silent-summary rules
// (low_stock/unprocessed_items/active_projects) are deliberately absent — the
// dashboard has dedicated widgets for those, and their count lives in the row
// text, not the row count.
const GROUP_META: Record<string, { label: string; href: string }> = {
  task_overdue: { label: "משימות באיחור", href: "/tasks?status=overdue&scope=mine" },
  task_due_soon: { label: "משימות לביצוע בקרוב", href: "/tasks" },
  project_deadline: { label: "פרויקטים לקראת דדליין", href: "/projects" },
  project_starting: { label: "פרויקטים שמתחילים בקרוב", href: "/projects" },
  project_closed_unbilled: { label: "פרויקטים סגורים ללא חיוב", href: "/projects" },
  invoice_unpaid: { label: "חשבוניות לא משולמות", href: "/invoices" },
  collection_overdue: { label: "גבייה באיחור", href: "/collections?view=debtors&filter=overdue" },
  wage_overdue: { label: "שכר עובדים לתשלום", href: "/payroll" },
  vehicle_expiry: { label: "רכבים — טסט/ביטוח/רישוי", href: "/vehicles" },
  check_deposit_due: { label: "צ׳קים לפירעון", href: "/checks" },
  payment_due_today: { label: "תשלומים לגבייה היום", href: "/collections?view=today" },
  recurring_expense_confirm: { label: "אישור הוצאות קבועות", href: "/financial" },
  reminders: { label: "תזכורות", href: "/alerts" },
};

/** The worklist rolled up into per-kind counts, for the dashboard alert center. */
export async function getWorklistGroups(
  supabase: SupabaseClient,
  options: { userId: string; role: string | null }
): Promise<WorklistGroup[]> {
  const items = await getWorklist(supabase, options);
  const groups = new Map<string, { count: number; rank: number }>();

  for (const item of items) {
    if (item.isSummary) continue; // silent summaries have their count in the text
    const ruleKey = item.source === "system" ? (item.dedupeKey ?? "").split(":")[0] || "system" : "reminders";
    if (!GROUP_META[ruleKey]) continue; // e.g. active_projects — excluded
    const existing = groups.get(ruleKey) ?? { count: 0, rank: 99 };
    existing.count += 1;
    existing.rank = Math.min(existing.rank, SEVERITY_RANK[item.severity]);
    groups.set(ruleKey, existing);
  }

  const rankToSeverity: WorklistSeverity[] = ["danger", "warning", "info"];
  return [...groups.entries()]
    .map(([id, g]) => ({
      id,
      title: GROUP_META[id].label,
      description: "",
      href: GROUP_META[id].href,
      count: g.count,
      severity: rankToSeverity[g.rank] ?? "info",
    }))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

// Worklist section → the nav destination whose sidebar item we badge. Sections
// without a single home (ops spans inventory+vehicles; reminders has no nav item)
// are intentionally absent — no misleading badge.
const SECTION_NAV_URL: Record<string, string> = {
  tasks: "/tasks",
  money: "/collections",
  projects: "/projects",
  hours: "/payroll",
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
    // what keeps the badge equal to the worklist's "N" line.
    if (item.isSummary && !COLLAPSE_META[ruleKey]) continue;
    const section = item.source === "manual" ? "reminders" : RULE_SECTION[ruleKey];
    const url = section ? SECTION_NAV_URL[section] : undefined;
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
