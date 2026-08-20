
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAuditEvent } from "@/lib/audit";
import {
  computeSourceCollection,
  fetchOrderDueDates,
  fetchProjectDueDates,
  getPaymentsDueToday,
  isOpenOrderStatus,
} from "@/lib/collections";
import { addWorkingDays, subtractWorkingDays, toDateOnly } from "@/lib/dashboard/week";
import { getRuleSettings, getDunningStages } from "@/lib/notifications/alert-config";
import { loadProjectedRecurringExpenses } from "@/lib/payables";

// ---------------------------------------------------------------------------
// Reminders/Alerts unification — Phase 2: the system-rule engine.
//
// Each rule inspects the live data and returns the set of "problems that
// currently exist" as SystemReminderItem[]. The engine (syncSystemReminders)
// reconciles that set against the open system reminders in the DB:
//   * a new problem  -> insert a system reminder (source='system')
//   * a gone problem -> auto-close the reminder (status='auto_resolved')
//   * a still-open problem whose text/severity changed -> refresh it
//
// Delivery (pushing these) is intentionally NOT done here — rows are created
// with next_ping_at = NULL and the Phase 3 deliver cron schedules the actual
// pings (respecting quiet hours / repeat cadence). Silent rules never ping.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Severity = "info" | "warning" | "danger";
type Behavior = "silent" | "ping_once" | "ping_repeat";
type AudienceRole = "admin" | "office" | "all";

export type SystemReminderItem = {
  /** Unique within the rule; combined with the rule key to form dedupe_key. */
  key: string;
  title: string;
  content?: string;
  url: string;
  severity: Severity;
  behavior: Behavior;
  repeatRule?: string | null;
  maxPings?: number | null;
  /** Target a specific user OR a role bucket (exactly one is expected). */
  assignedTo?: string | null;
  audienceRole?: AudienceRole | null;
  links?: {
    customer_id?: string | null;
    order_id?: string | null;
    project_id?: string | null;
    property_id?: string | null;
    payment_id?: string | null;
    task_id?: string | null;
    invoice_id?: string | null;
    vehicle_id?: string | null;
    expense_id?: string | null;
  };
};

type RuleContext = {
  todayIso: string;
  nowIso: string;
  today: Date;
  /** today + 3 working days, for deadline horizons. */
  nearHorizonIso: string;
};

type SystemRule = {
  key: string;
  label: string;
  /**
   * Return the problems that currently exist. MUST throw on a real read error
   * (so the engine skips reconcile and never mass-auto-closes on a transient
   * failure). Return [] only when there genuinely are no problems.
   */
  evaluate: (supabase: SupabaseClient, ctx: RuleContext) => Promise<SystemReminderItem[]>;
};

// --- small helpers ---------------------------------------------------------

function getString(row: Row | null | undefined, key: string) {
  const v = row?.[key];
  return typeof v === "string" ? v : null;
}
function getNumber(row: Row | null | undefined, key: string) {
  const v = row?.[key];
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const p = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(p) ? p : null;
  }
  return null;
}
function getBoolean(row: Row | null | undefined, key: string) {
  const v = row?.[key];
  return typeof v === "boolean" ? v : null;
}
function ils(n: number) {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(n);
}
function throwIf(error: unknown, label: string) {
  if (error) throw new Error(`${label}: ${(error as { message?: string })?.message ?? "query failed"}`);
}

// ---------------------------------------------------------------------------
// The rules — one per condition (originally ported from the retired lib/alerts.ts), at per-item
// granularity where the thing is individually actionable, summary where it's a
// pure metric. Two old alerts are intentionally dropped:
//   * collection-reminders-due  -> those already ARE reminders
//   * customers-awaiting-followup -> redundant with collection_overdue
// ---------------------------------------------------------------------------

const taskOverdueRule: SystemRule = {
  key: "task_overdue",
  label: "משימות באיחור",
  async evaluate(supabase, ctx) {
    const { data, error } = await supabase
      .from("tasks")
      .select("id,subject,due_date,status,assigned_user_id,project_id")
      .in("status", ["todo", "in_progress", "blocked"])
      .not("due_date", "is", null)
      .lt("due_date", ctx.todayIso)
      .not("assigned_user_id", "is", null)
      .range(0, 1999);
    throwIf(error, "tasks");
    return ((data ?? []) as Row[]).map((t) => {
      const id = getString(t, "id") ?? "";
      const subject = getString(t, "subject") ?? "משימה";
      return {
        key: id,
        title: `משימה באיחור: ${subject}`,
        content: "משימה שחלף מועד היעד שלה וטרם הושלמה.",
        url: `/tasks/${id}`,
        severity: "danger" as Severity,
        behavior: "ping_once" as Behavior,
        assignedTo: getString(t, "assigned_user_id"),
        links: { task_id: id, project_id: getString(t, "project_id") },
      };
    });
  },
};

const projectDeadlineRule: SystemRule = {
  key: "project_deadline",
  label: "פרויקטים לקראת דדליין",
  async evaluate(supabase, ctx) {
    const { data, error } = await supabase
      .from("projects")
      .select("id,name,end_date,status,project_manager_id,customer_id")
      .in("status", ["active", "in_progress"])
      .not("end_date", "is", null)
      .gte("end_date", ctx.todayIso)
      .lte("end_date", ctx.nearHorizonIso)
      .range(0, 999);
    throwIf(error, "projects");
    return ((data ?? []) as Row[]).map((p) => {
      const id = getString(p, "id") ?? "";
      const name = getString(p, "name") ?? "פרויקט";
      const manager = getString(p, "project_manager_id");
      return {
        key: id,
        title: `פרויקט לקראת דדליין: ${name}`,
        content: "צפוי להסתיים תוך 3 ימי עבודה.",
        url: `/projects/${id}`,
        severity: "warning" as Severity,
        behavior: "ping_once" as Behavior,
        // owned by its PM if set, otherwise a back-office concern
        assignedTo: manager,
        audienceRole: manager ? null : ("office" as AudienceRole),
        links: { project_id: id, customer_id: getString(p, "customer_id") },
      };
    });
  },
};

const collectionOverdueRule: SystemRule = {
  key: "collection_overdue",
  label: "גבייה באיחור",
  async evaluate(supabase, ctx) {
    const { data, error } = await supabase
      .from("collections_view")
      .select(
        "source_type,source_id,customer_id,customer_name,total_amount,collected_amount,pending_amount,overdue_amount,outstanding_amount,next_due_date,reference_date"
      )
      .range(0, 999);
    throwIf(error, "collections_view");
    const rows = (data ?? []) as Row[];
    const [orderDue, projectDue] = await Promise.all([
      fetchOrderDueDates(
        supabase,
        rows.filter((r) => getString(r, "source_type") !== "project").map((r) => getString(r, "source_id") ?? "")
      ),
      fetchProjectDueDates(
        supabase,
        rows.filter((r) => getString(r, "source_type") === "project").map((r) => getString(r, "source_id") ?? "")
      ),
    ]);
    const stages = await getDunningStages(supabase);
    const items: SystemReminderItem[] = [];
    for (const row of rows) {
      const isProject = getString(row, "source_type") === "project";
      const sourceId = getString(row, "source_id") ?? "";
      const sm = computeSourceCollection({
        total: getNumber(row, "total_amount") ?? 0,
        collected: getNumber(row, "collected_amount") ?? 0,
        pending: getNumber(row, "pending_amount") ?? 0,
        overdue: getNumber(row, "overdue_amount") ?? 0,
        outstanding: getNumber(row, "outstanding_amount") ?? 0,
        nextDueDate: getString(row, "next_due_date"),
        referenceDate: getString(row, "reference_date"),
        dueDate: (isProject ? projectDue.get(sourceId)?.dueDate : orderDue.get(sourceId)?.dueDate) ?? null,
        blockOverdue: !isProject && isOpenOrderStatus(orderDue.get(sourceId)?.status),
        today: ctx.todayIso,
      });
      if (sm.late <= 0.009) continue;
      const who = getString(row, "customer_name");
      const customerId = getString(row, "customer_id");
      const daysLate = sm.daysLate ?? 0;
      // Current dunning stage = the last stage the debt has reached (highest
      // offset ≤ days overdue). Advancing to the next stage swaps the dedupe key,
      // so the old reminder closes and the new (escalated) one opens + pushes.
      const stage = [...stages].reverse().find((s) => s.offset <= daysLate) ?? stages[0];
      items.push({
        key: `${getString(row, "source_type")}:${sourceId}:${stage.offset}`,
        title: who ? `${stage.label}: ${who}` : stage.label,
        content: `${ils(sm.late)} באיחור${daysLate ? ` (${daysLate} ימים)` : ""}.`,
        url: "/collections?view=debtors&filter=overdue",
        severity: stage.severity as Severity,
        // Worklist-only, no per-debt push. Overdue collections are a daily
        // desk workflow (the debtors page + the collector's own reminders) —
        // 18 phone pings, one per debt, is pure noise. The dunning stage still
        // drives severity/aging; it just doesn't interrupt anymore. The whole
        // rule collapses to ONE "N חובות באיחור" worklist line.
        behavior: "silent" as Behavior,
        audienceRole: "office" as AudienceRole,
        links: {
          customer_id: customerId,
          order_id: isProject ? null : sourceId,
          project_id: isProject ? sourceId : null,
        },
      });
    }
    return items;
  },
};

const wageOverdueRule: SystemRule = {
  key: "wage_overdue",
  label: "שכר עובדים באיחור",
  async evaluate(supabase, ctx) {
    const { data, error } = await supabase
      .from("worker_debt_items_view")
      .select("user_id,source_date,due_date,owed_amount,source_type")
      .eq("source_type", "payslip")
      .gt("owed_amount", 0.009)
      .range(0, 1999);
    // due_date column may not exist on older views — fall back without it.
    let rows = (data ?? []) as Row[];
    if (error) {
      if ((error.message ?? "").toLowerCase().includes("due_date")) {
        const retry = await supabase
          .from("worker_debt_items_view")
          .select("user_id,source_date,owed_amount,source_type")
          .eq("source_type", "payslip")
          .gt("owed_amount", 0.009)
          .range(0, 1999);
        throwIf(retry.error, "worker_debt_items_view");
        rows = (retry.data ?? []) as Row[];
      } else {
        throwIf(error, "worker_debt_items_view");
      }
    }
    const nextMonthDue = (periodEndIso: string) => {
      const [y, m] = periodEndIso.split("-").map(Number);
      if (!Number.isFinite(y) || !Number.isFinite(m)) return "";
      const nm = m === 12 ? 1 : m + 1;
      const ny = m === 12 ? y + 1 : y;
      return `${ny}-${String(nm).padStart(2, "0")}-10`;
    };
    // Resolve worker names for the titles.
    const userIds = [...new Set(rows.map((r) => getString(r, "user_id")).filter((v): v is string => Boolean(v)))];
    const nameById = new Map<string, string>();
    if (userIds.length) {
      const { data: users } = await supabase.from("users").select("id,full_name").in("id", userIds);
      for (const u of (users ?? []) as Row[]) nameById.set(getString(u, "id") ?? "", getString(u, "full_name") ?? "עובד");
    }
    const items: SystemReminderItem[] = [];
    for (const row of rows) {
      const userId = getString(row, "user_id") ?? "";
      const sourceDate = getString(row, "source_date") ?? "";
      const owed = getNumber(row, "owed_amount") ?? 0;
      if (!userId || !sourceDate || owed <= 0.009) continue;
      const dueIso = getString(row, "due_date") || nextMonthDue(sourceDate);
      if (!dueIso || ctx.todayIso <= dueIso) continue; // not overdue yet
      items.push({
        key: `${userId}:${sourceDate}`,
        title: `שכר באיחור: ${nameById.get(userId) ?? "עובד"}`,
        content: `${ils(owed)} שטרם שולמו (תלוש ${sourceDate}).`,
        url: "/payroll",
        severity: "danger" as Severity,
        behavior: "ping_repeat" as Behavior,
        repeatRule: "daily",
        // Nudge a few mornings, then stop pinging — it stays in the worklist until
        // paid, but daily forever just trains the admin to ignore it.
        maxPings: 3,
        audienceRole: "admin" as AudienceRole,
      });
    }
    return items;
  },
};

const vehicleExpiryRule: SystemRule = {
  key: "vehicle_expiry",
  label: "רכבים — טסט/ביטוח/רישוי",
  async evaluate(supabase, ctx) {
    const horizon = new Date(ctx.today);
    horizon.setDate(horizon.getDate() + 30);
    const horizonIso = horizon.toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("vehicles")
      .select("id,tag_id,license_plate,make_model,test_due_date,insurance_due_date,license_due_date")
      .or(`test_due_date.lte.${horizonIso},insurance_due_date.lte.${horizonIso},license_due_date.lte.${horizonIso}`);
    if (error) {
      if ((error.message ?? "").includes("public.vehicles")) return [];
      throwIf(error, "vehicles");
    }
    const kinds: Array<{ col: string; label: string }> = [
      { col: "test_due_date", label: "טסט" },
      { col: "insurance_due_date", label: "ביטוח" },
      { col: "license_due_date", label: "רישוי" },
    ];
    const items: SystemReminderItem[] = [];
    for (const v of (data ?? []) as Row[]) {
      // tag_id is the vehicle's canonical identity everywhere (routes, entity_tags),
      // so link + navigate by it — consistent with the manual reminder button.
      const tagId = getString(v, "tag_id") ?? getString(v, "id") ?? "";
      const label = getString(v, "license_plate") || getString(v, "make_model") || "רכב";
      for (const k of kinds) {
        const d = getString(v, k.col);
        if (!d || d > horizonIso) continue;
        const overdue = d < ctx.todayIso;
        items.push({
          key: `${tagId}:${k.col}`,
          title: `${k.label} לרכב ${label}`,
          content: overdue ? `${k.label} פג בתאריך ${d}.` : `${k.label} יפוג בתאריך ${d}.`,
          url: tagId ? `/vehicles/${tagId}` : "/vehicles",
          severity: (overdue ? "danger" : "warning") as Severity,
          behavior: "ping_once" as Behavior,
          audienceRole: "office" as AudienceRole,
          links: { vehicle_id: tagId },
        });
      }
    }
    return items;
  },
};

const leaseExpiryRule: SystemRule = {
  key: "lease_expiry",
  label: "חוזי שכירות — סיום קרוב",
  async evaluate(supabase, ctx) {
    const horizon = new Date(ctx.today);
    horizon.setDate(horizon.getDate() + 30);
    const horizonIso = horizon.toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("lease_agreements")
      .select(
        "id,property_id,customer_id,end_date,status,property:properties(name,address),customer:customers(name)"
      )
      .eq("status", "active")
      .not("end_date", "is", null)
      .lte("end_date", horizonIso);
    if (error) {
      if ((error.message ?? "").includes("public.lease_agreements")) return [];
      throwIf(error, "lease_agreements");
    }
    const items: SystemReminderItem[] = [];
    for (const row of (data ?? []) as Row[]) {
      const id = getString(row, "id");
      const endDate = getString(row, "end_date");
      if (!id || !endDate) continue;
      const propertyId = getString(row, "property_id");
      const propertyRow = (Array.isArray(row.property) ? row.property[0] : row.property) as Row | undefined;
      const customerRow = (Array.isArray(row.customer) ? row.customer[0] : row.customer) as Row | undefined;
      const label = getString(propertyRow, "name") || getString(propertyRow, "address") || "נכס";
      const tenant = getString(customerRow, "name");
      const overdue = endDate < ctx.todayIso;
      items.push({
        key: id,
        title: `חוזה שכירות מסתיים — ${label}`,
        content: `חוזה השכירות${tenant ? ` עם ${tenant}` : ""} ${overdue ? "הסתיים" : "יסתיים"} בתאריך ${endDate}.`,
        url: propertyId ? `/properties/${propertyId}` : "/properties",
        severity: (overdue ? "danger" : "warning") as Severity,
        behavior: "ping_once" as Behavior,
        audienceRole: "office" as AudienceRole,
        links: { property_id: propertyId, customer_id: getString(row, "customer_id") },
      });
    }
    return items;
  },
};

// --- Phase 5 coverage: payments & checks ----------------------------------

const checkDepositDueRule: SystemRule = {
  key: "check_deposit_due",
  label: "צ׳קים לפירעון",
  async evaluate(supabase, ctx) {
    // Checks are payments (payment_method='check'). A pending check whose deposit
    // date (due_date) has arrived should be deposited. Post-dated checks (future
    // due_date) don't alert yet.
    const { data, error } = await supabase
      .from("payments")
      .select("id,check_number,amount_total,due_date,payment_status,order_id,project_id")
      .eq("payment_method", "check")
      .eq("payment_status", "pending")
      .not("due_date", "is", null)
      .lte("due_date", ctx.todayIso)
      .range(0, 999);
    throwIf(error, "payments(checks)");
    return ((data ?? []) as Row[]).map((p) => {
      const id = getString(p, "id") ?? "";
      const due = getString(p, "due_date") ?? "";
      const num = getString(p, "check_number");
      const amount = getNumber(p, "amount_total") ?? 0;
      // Well past its deposit date → escalate.
      const overdueDays = due ? Math.floor((new Date(ctx.todayIso).getTime() - new Date(due).getTime()) / 86_400_000) : 0;
      return {
        key: id,
        title: num ? `צ׳ק לפירעון #${num}` : "צ׳ק לפירעון",
        content: `${ils(amount)} — מועד הפקדה ${due}${overdueDays > 0 ? ` (לפני ${overdueDays} ימים)` : ""}.`,
        url: "/checks",
        severity: (overdueDays > 7 ? "danger" : "warning") as Severity,
        behavior: "ping_once" as Behavior,
        audienceRole: "office" as AudienceRole,
        links: { payment_id: id, order_id: getString(p, "order_id"), project_id: getString(p, "project_id") },
      };
    });
  },
};

const paymentDueTodayRule: SystemRule = {
  key: "payment_due_today",
  label: "תשלומים לגבייה היום",
  async evaluate(supabase, ctx) {
    // Scheduled payments due today. Checks are excluded — they have their own
    // deposit rule — so this doesn't double up on the same money.
    const due = await getPaymentsDueToday(supabase, ctx.todayIso);
    return due
      .filter((p) => p.payment_method !== "check")
      .map((p) => ({
        key: p.id,
        title: p.customer_name ? `תשלום לגבייה: ${p.customer_name}` : "תשלום לגבייה היום",
        content: `${ils(p.amount)} מתוכנן להיום${p.customer_phone ? ` · ${p.customer_phone}` : ""}.`,
        url: "/collections?view=today",
        severity: "warning" as Severity,
        behavior: "ping_once" as Behavior,
        audienceRole: "office" as AudienceRole,
        links: {
          payment_id: p.id,
          customer_id: p.customer_id,
          order_id: p.source_type === "order" ? p.source_id : null,
          project_id: p.source_type === "project" ? p.source_id : null,
        },
      }));
  },
};

const promiseBrokenRule: SystemRule = {
  key: "promise_broken",
  label: "הבטחות תשלום שהופרו",
  async evaluate(supabase, ctx) {
    // A promise still pending past its date → the customer didn't pay as promised.
    const { data, error } = await supabase
      .from("payment_promises")
      .select("id,customer_id,amount,promised_date,order_id,project_id")
      .eq("status", "pending")
      .lt("promised_date", ctx.todayIso)
      .range(0, 999);
    if (error) {
      if ((error.message ?? "").includes("payment_promises")) return []; // table not migrated yet
      throwIf(error, "payment_promises");
    }
    const rows = (data ?? []) as Row[];
    const customerIds = [...new Set(rows.map((r) => getString(r, "customer_id")).filter((v): v is string => Boolean(v)))];
    const nameById = new Map<string, string>();
    if (customerIds.length) {
      const { data: cs } = await supabase.from("customers").select("id,name").in("id", customerIds);
      for (const c of (cs ?? []) as Row[]) nameById.set(getString(c, "id") ?? "", getString(c, "name") ?? "לקוח");
    }
    return rows.map((r) => {
      const id = getString(r, "id") ?? "";
      const who = nameById.get(getString(r, "customer_id") ?? "") ?? null;
      const amount = getNumber(r, "amount") ?? 0;
      const date = getString(r, "promised_date") ?? "";
      return {
        key: id,
        title: who ? `הבטחת תשלום הופרה: ${who}` : "הבטחת תשלום הופרה",
        content: `הובטחו ${ils(amount)} עד ${date} — טרם שולם.`,
        url: "/collections?view=debtors",
        severity: "danger" as Severity,
        behavior: "ping_once" as Behavior,
        audienceRole: "office" as AudienceRole,
        links: { customer_id: getString(r, "customer_id"), order_id: getString(r, "order_id"), project_id: getString(r, "project_id") },
      };
    });
  },
};

// How many days ahead an unpaid outgoing bill starts showing as a heads-up
// (below this it's "מתקרבים"; on the day it's "להיום"; past it "באיחור").
const PAYMENT_HEADS_UP_DAYS = 3;

const paymentOutflowDueRule: SystemRule = {
  key: "payment_outflow_due",
  label: "תשלומים לתשלום",
  async evaluate(supabase, ctx) {
    // Money going OUT that we still owe: unpaid (or partly-paid) expenses whose pay
    // date has arrived (overdue / today) or is a few days off (heads-up). One
    // reminder per bill, but SILENT and COLLAPSE'd (see COLLAPSE_META) — so it drives
    // the payments-calendar nav badge + page bar with a real count and shows as ONE
    // "תשלומים לתשלום: N" worklist line, without a per-bill push flood. Covers every
    // bill in `expenses` (suppliers, rent, utilities, taxes, recurring bills,
    // installments, hand-added payments), matching the calendar's outflow so the
    // numbers agree; wages are on wage_overdue.
    const horizon = new Date(ctx.today);
    horizon.setDate(horizon.getDate() + PAYMENT_HEADS_UP_DAYS);
    const horizonIso = horizon.toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("expenses")
      .select("id,expense_date,amount,paid_amount,payment_status,description,category")
      .in("payment_status", ["not_paid", "partial"])
      .lte("expense_date", horizonIso)
      .range(0, 4999);
    throwIf(error, "expenses(payment_due)");
    const items: SystemReminderItem[] = [];
    for (const row of (data ?? []) as Row[]) {
      const id = getString(row, "id") ?? "";
      const date = (getString(row, "expense_date") ?? "").slice(0, 10);
      if (!id || !date) continue;
      const outstanding = Math.max(0, (getNumber(row, "amount") ?? 0) - (getNumber(row, "paid_amount") ?? 0));
      if (outstanding <= 0.009) continue;
      const label = getString(row, "description") || getString(row, "category") || "הוצאה";
      const overdue = date < ctx.todayIso;
      const dueToday = date === ctx.todayIso;
      const days = Math.round((new Date(date).getTime() - new Date(ctx.todayIso).getTime()) / 86_400_000);
      const when = overdue ? `באיחור ${Math.abs(days)} ימים` : dueToday ? "לתשלום היום" : `בעוד ${days} ימים`;
      items.push({
        key: id,
        title: `תשלום לתשלום: ${label}`,
        content: `${ils(outstanding)} · ${when}.`,
        url: "/financial/payments-calendar",
        // Worst bill in the group drives the collapsed line's colour.
        severity: (overdue ? "danger" : dueToday ? "warning" : "info") as Severity,
        behavior: "silent" as Behavior,
        audienceRole: "office" as AudienceRole,
        links: { expense_id: id },
      });
    }

    // Recurring bills that are DUE but were never generated into an expense row
    // (a lapsed prior month, or a template whose create-day hasn't fired). They
    // exist only as calendar FORECASTS, so the expenses query above can't see them.
    // Pull the SAME forecast the calendar draws and alert on occurrences within the
    // horizon — so the badge/bar match the red dots even for un-created recurrences.
    // (Already-generated occurrences are de-duped out by loadProjectedRecurringExpenses,
    // so they're only ever counted once — via the expenses branch above.)
    let forecasts: Awaited<ReturnType<typeof loadProjectedRecurringExpenses>> = [];
    try {
      forecasts = await loadProjectedRecurringExpenses(supabase, { referenceDate: ctx.todayIso });
    } catch {
      forecasts = [];
    }
    for (const f of forecasts) {
      if (f.date > horizonIso) continue; // only overdue / today / a few days out
      if (f.autoPaid) continue; // bank standing order — auto-paid, nothing to chase
      const overdue = f.date < ctx.todayIso;
      const dueToday = f.date === ctx.todayIso;
      const days = Math.round((new Date(f.date).getTime() - new Date(ctx.todayIso).getTime()) / 86_400_000);
      const when = overdue ? `באיחור ${Math.abs(days)} ימים` : dueToday ? "לתשלום היום" : `בעוד ${days} ימים`;
      const amountText = f.variableAmount ? "סכום משתנה" : ils(f.amount);
      items.push({
        key: `recur:${f.recurringTemplateId}:${f.recurrenceKey}`,
        title: `תשלום לתשלום: ${f.label}`,
        content: `${amountText} · ${when} · הוצאה קבועה שטרם נוצרה.`,
        url: "/financial/payments-calendar",
        severity: (overdue ? "danger" : dueToday ? "warning" : "info") as Severity,
        behavior: "silent" as Behavior,
        audienceRole: "office" as AudienceRole,
      });
    }
    return items;
  },
};

function isoOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The next occurrence date (on/after `today`) of a recurring template, honoring
// yearly / monthly / every-N-months (phased off start_date, else created_at).
function nextRecurringOccurrence(tpl: Row, today: Date): { date: Date; key: string } | null {
  const day = getNumber(tpl, "expense_day_of_month") ?? 1;
  const frequency = getString(tpl, "frequency");
  if (frequency === "yearly") {
    const month = (getNumber(tpl, "expense_month_of_year") ?? 1) - 1;
    for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
      const last = new Date(year, month + 1, 0).getDate();
      const d = new Date(year, month, Math.min(Math.max(1, day), last));
      if (d >= today) return { date: d, key: String(year) };
    }
    return null;
  }
  const interval = Math.max(1, getNumber(tpl, "interval_months") ?? 1);
  const anchorStr = getString(tpl, "start_date") || (getString(tpl, "created_at") ?? "").slice(0, 10) || null;
  const anchor = (anchorStr ? toDateOnly(anchorStr) : null) ?? today;
  const anchorIdx = anchor.getFullYear() * 12 + anchor.getMonth();
  for (let i = 0; i < 24; i++) {
    const base = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const diff = base.getFullYear() * 12 + base.getMonth() - anchorIdx;
    if (diff < 0 || diff % interval !== 0) continue;
    const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const d = new Date(base.getFullYear(), base.getMonth(), Math.min(Math.max(1, day), last));
    if (d >= today) return { date: d, key: isoOf(d).slice(0, 7) };
  }
  return null;
}

const recurringPaymentReminderRule: SystemRule = {
  key: "recurring_payment_reminder",
  label: "תזכורות לתשלומים קבועים",
  async evaluate(supabase, ctx) {
    // Per-bill monthly reminder: "remind me N WORK-days before this bill's date".
    // Each period we surface a heads-up from its remind-day up to the payment day.
    const { data, error } = await supabase
      .from("recurring_expense_templates")
      .select("id,template_name,category,amount,is_variable_amount,frequency,interval_months,expense_day_of_month,expense_month_of_year,start_date,created_at,reminder_work_days_before")
      .eq("is_active", true)
      .not("reminder_work_days_before", "is", null)
      .gt("reminder_work_days_before", 0)
      .range(0, 999);
    // Column may not exist pre-migration → treat as "no reminders".
    if (error) {
      if ((error.message ?? "").toLowerCase().includes("reminder_work_days_before")) return [];
      throwIf(error, "recurring_expense_templates(reminder)");
    }
    const items: SystemReminderItem[] = [];
    for (const t of (data ?? []) as Row[]) {
      const n = getNumber(t, "reminder_work_days_before") ?? 0;
      if (n <= 0) continue;
      const occ = nextRecurringOccurrence(t, ctx.today);
      if (!occ) continue;
      const remindIso = isoOf(subtractWorkingDays(occ.date, n));
      const occIso = isoOf(occ.date);
      if (ctx.todayIso < remindIso || ctx.todayIso > occIso) continue; // outside the heads-up window
      const id = getString(t, "id") ?? "";
      const name = getString(t, "template_name") || getString(t, "category") || "תשלום קבוע";
      const isVar = getBoolean(t, "is_variable_amount") === true;
      const amount = getNumber(t, "amount") ?? 0;
      const amountText = isVar ? (amount > 0 ? `~${ils(amount)}` : "סכום משתנה") : ils(amount);
      items.push({
        key: `${id}:${occ.key}`,
        title: `תשלום קרוב: ${name}`,
        content: `${amountText} · צפוי ב-${occIso}.`,
        url: "/financial/payments-calendar",
        severity: "warning" as Severity,
        behavior: "ping_once" as Behavior,
        audienceRole: "office" as AudienceRole,
        links: { expense_id: null },
      });
    }
    return items;
  },
};

const recurringExpenseConfirmRule: SystemRule = {
  key: "recurring_expense_confirm",
  label: "אישור תשלום הוצאות קבועות",
  async evaluate(supabase, ctx) {
    // Recurring-generated expenses start as not_paid and need a manual "שולם"
    // confirmation before they count as real cash. Nudge once the expense date passed.
    const { data, error } = await supabase
      .from("expenses")
      .select("id,expense_date,payment_status,recurring_expense_template_id")
      .not("recurring_expense_template_id", "is", null)
      .eq("payment_status", "not_paid")
      .lte("expense_date", ctx.nowIso)
      .range(0, 999);
    throwIf(error, "expenses(recurring)");
    return ((data ?? []) as Row[]).map((e) => {
      const id = getString(e, "id") ?? "";
      const when = (getString(e, "expense_date") ?? "").slice(0, 10);
      return {
        key: id,
        title: "אישור תשלום להוצאה קבועה",
        content: `הוצאה קבועה${when ? ` מ-${when}` : ""} ממתינה לאישור תשלום.`,
        url: "/financial",
        severity: "warning" as Severity,
        behavior: "ping_once" as Behavior,
        audienceRole: "office" as AudienceRole,
        links: { expense_id: id },
      };
    });
  },
};

// --- Phase 5 coverage: tasks & projects -----------------------------------

const taskDueSoonRule: SystemRule = {
  key: "task_due_soon",
  label: "משימות לביצוע בקרוב",
  async evaluate(supabase, ctx) {
    // Assigned tasks due today or tomorrow (not yet overdue — task_overdue owns those).
    const twoDays = new Date(ctx.today);
    twoDays.setDate(twoDays.getDate() + 2);
    const twoDaysIso = twoDays.toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("tasks")
      .select("id,subject,due_date,status,assigned_user_id,project_id")
      .in("status", ["todo", "in_progress", "blocked"])
      .not("assigned_user_id", "is", null)
      .gte("due_date", ctx.todayIso)
      .lt("due_date", twoDaysIso)
      .range(0, 1999);
    throwIf(error, "tasks(due_soon)");
    return ((data ?? []) as Row[]).map((t) => {
      const id = getString(t, "id") ?? "";
      const subject = getString(t, "subject") ?? "משימה";
      const due = getString(t, "due_date") ?? "";
      const isToday = due.slice(0, 10) === ctx.todayIso;
      return {
        key: id,
        title: `${isToday ? "משימה להיום" : "משימה למחר"}: ${subject}`,
        content: isToday ? "מועד היעד היום." : "מועד היעד מחר.",
        url: `/tasks/${id}`,
        severity: "info" as Severity,
        behavior: "ping_once" as Behavior,
        assignedTo: getString(t, "assigned_user_id"),
        links: { task_id: id, project_id: getString(t, "project_id") },
      };
    });
  },
};

const projectStartingRule: SystemRule = {
  key: "project_starting",
  label: "פרויקטים שמתחילים בקרוב",
  async evaluate(supabase, ctx) {
    const horizon = new Date(ctx.today);
    horizon.setDate(horizon.getDate() + 7);
    const horizonIso = horizon.toISOString().slice(0, 10);
    // Include scheduled ("planned") projects, not just ongoing ones — a fixed
    // future job on the calendar is exactly what we want to flag as it approaches.
    const { data, error } = await supabase
      .from("projects")
      .select("id,name,start_date,status,project_manager_id,customer_id")
      .in("status", ["planned", "active", "in_progress"])
      .not("start_date", "is", null)
      .gte("start_date", ctx.todayIso)
      .lte("start_date", horizonIso)
      .range(0, 999);
    throwIf(error, "projects(starting)");
    return ((data ?? []) as Row[]).map((p) => {
      const id = getString(p, "id") ?? "";
      const name = getString(p, "name") ?? "פרויקט";
      const start = getString(p, "start_date") ?? "";
      const manager = getString(p, "project_manager_id");
      const isToday = start === ctx.todayIso;
      return {
        key: id,
        title: `פרויקט מתחיל ${isToday ? "היום" : "בקרוב"}: ${name}`,
        content: `מועד התחלה ${start}.`,
        url: `/projects/${id}`,
        severity: "info" as Severity,
        behavior: "ping_once" as Behavior,
        assignedTo: manager,
        audienceRole: manager ? null : ("office" as AudienceRole),
        links: { project_id: id, customer_id: getString(p, "customer_id") },
      };
    });
  },
};

const staleQuoteRule: SystemRule = {
  key: "stale_quote",
  label: "הצעות מחיר ישנות למחיקה",
  async evaluate(supabase, ctx) {
    // A project still in 'quote' a week+ after it was created — the status never
    // progressed, so it's likely dead → nudge to delete (or push it forward).
    const weekAgo = new Date(ctx.today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoIso = weekAgo.toISOString();
    const { data, error } = await supabase
      .from("projects")
      .select("id,name,customer_id,created_at")
      .eq("status", "quote")
      .lte("created_at", weekAgoIso)
      .range(0, 999);
    throwIf(error, "projects(stale_quote)");
    return ((data ?? []) as Row[]).map((p) => {
      const id = getString(p, "id") ?? "";
      const name = getString(p, "name") ?? "הצעת מחיר";
      const created = (getString(p, "created_at") ?? "").slice(0, 10);
      return {
        key: id,
        title: `הצעת מחיר ישנה: ${name}`,
        content: `נפתחה ב-${created} וטרם השתנה הסטטוס — לשקול מחיקה או קידום.`,
        url: `/projects/${id}`,
        severity: "info" as Severity,
        behavior: "ping_once" as Behavior,
        audienceRole: "office" as AudienceRole,
        links: { project_id: id, customer_id: getString(p, "customer_id") },
      };
    });
  },
};

const projectClosedUnbilledRule: SystemRule = {
  key: "project_closed_unbilled",
  label: "פרויקטים סגורים ללא חיוב",
  async evaluate(supabase) {
    // A completed ("closed") project with NO price set produces no receivable,
    // so it never appears in collections — a silent revenue leak. "No price" =
    // agreed_base_price / actual_price both empty — the EXACT same `priceUnset`
    // test the projects list uses (baseProjectPrice <= 0), so the list's
    // "unpriced" projects and this alert always agree. (customer_total_price
    // from the view folds in billed expenses, so it can be >0 with no agreed
    // price — the wrong signal here.)
    // no_charge may not exist pre-migration → fall back without it (treated as
    // false) so the rule keeps working until the column lands.
    const primary = await supabase
      .from("projects")
      .select("id,name,customer_id,agreed_base_price,actual_price,no_charge")
      .eq("status", "completed")
      .range(0, 999);
    let rows = (primary.data ?? []) as Row[];
    if (primary.error) {
      if ((primary.error.message ?? "").toLowerCase().includes("no_charge")) {
        const retry = await supabase
          .from("projects")
          .select("id,name,customer_id,agreed_base_price,actual_price")
          .eq("status", "completed")
          .range(0, 999);
        throwIf(retry.error, "projects(closed_unbilled)");
        rows = (retry.data ?? []) as Row[];
      } else {
        throwIf(primary.error, "projects(closed_unbilled)");
      }
    }

    const items: SystemReminderItem[] = [];
    for (const p of rows) {
      // Intentionally free (donation / favor / internal) → not a billing gap.
      if (getBoolean(p, "no_charge") === true) continue;
      const base = getNumber(p, "agreed_base_price") ?? getNumber(p, "actual_price") ?? 0;
      if (base > 0.009) continue; // has an agreed price → visible in collections
      const id = getString(p, "id") ?? "";
      const name = getString(p, "name") ?? "פרויקט";
      items.push({
        key: id,
        title: `פרויקט סגור ללא חיוב: ${name}`,
        content: "הפרויקט הושלם אך לא הוזן מחיר — לתמחר ולחייב.",
        url: `/projects/${id}`,
        severity: "warning" as Severity,
        behavior: "ping_once" as Behavior,
        audienceRole: "office" as AudienceRole,
        links: { project_id: id, customer_id: getString(p, "customer_id") },
      });
    }
    return items;
  },
};

// --- summary (silent) rules — one row carrying a count, no push ------------

const lowStockRule: SystemRule = {
  key: "low_stock",
  label: "מלאי נמוך",
  async evaluate(supabase) {
    const productsRes = await supabase.from("products").select("id,active,low_stock_threshold");
    let products = productsRes;
    if ((productsRes.error as { code?: string } | null)?.code === "42703") {
      products = await supabase.from("products").select("id,active");
    }
    throwIf(products.error, "products");
    const invRes = await supabase.from("inventory").select("product_id,quantity_on_hand,quantity_reserved");
    throwIf(invRes.error, "inventory");
    const invByProduct = new Map<string, { onHand: number; reserved: number }>();
    for (const r of (invRes.data ?? []) as Row[]) {
      const pid = getString(r, "product_id");
      if (!pid) continue;
      invByProduct.set(pid, { onHand: getNumber(r, "quantity_on_hand") ?? 0, reserved: getNumber(r, "quantity_reserved") ?? 0 });
    }
    const count = ((products.data ?? []) as Row[]).reduce((acc, row) => {
      const id = getString(row, "id");
      if (!id || getBoolean(row, "active") === false) return acc;
      const threshold = getNumber(row, "low_stock_threshold") ?? 5;
      const inv = invByProduct.get(id);
      const available = (inv?.onHand ?? 0) - (inv?.reserved ?? 0);
      return available <= threshold ? acc + 1 : acc;
    }, 0);
    if (count <= 0) return [];
    return [
      {
        key: "summary",
        title: `מלאי נמוך: ${count} פריטים`,
        content: "פריטים מתחת לסף המלאי המוגדר.",
        url: "/inventory",
        severity: "warning",
        behavior: "silent",
        audienceRole: "office",
      },
    ];
  },
};

const unprocessedItemsRule: SystemRule = {
  key: "unprocessed_items",
  label: "הוצאות לא מעובדות",
  async evaluate(supabase) {
    const [statementsRes, pendingRowsRes, unclassifiedRes] = await Promise.all([
      supabase.from("card_statements").select("id,marked_done").range(0, 999).then((r) => r, () => ({ data: [] as Row[], error: null })),
      supabase
        .from("card_statement_rows")
        .select("statement_id")
        .eq("include", true)
        .is("expense_id", null)
        .range(0, 9999)
        .then((r) => r, () => ({ data: [] as Row[], error: null })),
      supabase
        .from("expenses")
        .select("id", { count: "estimated", head: true })
        .or("category.is.null,business_domain.is.null")
        .then((r) => r, () => ({ count: 0 })),
    ]);
    const unclassified =
      typeof (unclassifiedRes as { count?: number | null }).count === "number" ? (unclassifiedRes as { count: number }).count : 0;
    const doneIds = new Set(
      ((statementsRes.data ?? []) as Row[]).filter((r) => getBoolean(r, "marked_done") === true).map((r) => getString(r, "id")).filter(Boolean)
    );
    const pendingStatements = new Set<string>();
    for (const r of (pendingRowsRes.data ?? []) as Row[]) {
      const sid = getString(r, "statement_id");
      if (sid && !doneIds.has(sid)) pendingStatements.add(sid);
    }
    const count = pendingStatements.size + unclassified;
    if (count <= 0) return [];
    return [
      {
        key: "summary",
        title: `${count} פריטים ממתינים לסיווג`,
        content: "הוצאות ודפי אשראי הממתינים לעיבוד ואישור.",
        url: "/financial/statements",
        severity: "warning",
        behavior: "silent",
        audienceRole: "office",
      },
    ];
  },
};

// session_unallocated ("שעות עבודה לשיוך") was REMOVED 2026-08-16 — it could not
// be made accurate. It counted completed sessions on `general_business` with no
// project/property and called them "unassigned", but attendance_sessions.
// business_domain is NOT NULL DEFAULT 'general_business' and the enum has no
// "unchosen" value: שוטף is a legitimate domain AND the default, so the query
// cannot tell "nobody picked one" from "this really was general work".
//
// In the live data it matched 36 shifts, none of them from the approval queue
// (approving forces a domain) — they were שוטף shifts entered via הוספת משמרת,
// several with explicit notes like "סידור מחסן תובל". Worse, the alert could
// never reach zero: re-assigning such a shift to שוטף still matches.
//
// Reviving it needs a real signal — e.g. a column recording that a domain was
// deliberately chosen — not another heuristic over the same columns.

/**
 * Rule keys that USED to exist. Reconciled against an empty set on every sync so
 * their leftover reminders auto-close instead of sitting in the inbox and the nav
 * badges forever — the engine only ever closes reminders for rules it still
 * evaluates, so simply deleting a rule would strand its rows.
 *
 * Cheap to leave here: once the last one is closed each entry is a no-op query.
 */
const RETIRED_RULE_KEYS = ["session_unallocated"] as const;

export const SYSTEM_RULES: SystemRule[] = [
  // Ported from the old alerts (Phase 2)
  taskOverdueRule,
  projectDeadlineRule,
  // invoice_unpaid dropped — it double-nagged with collection_overdue (same money)
  // and keyed off an invoices table that isn't part of this install. AR is chased
  // via the dunning ladder in collection_overdue.
  collectionOverdueRule,
  wageOverdueRule,
  vehicleExpiryRule,
  leaseExpiryRule,
  // New coverage (Phase 5): payments & checks
  checkDepositDueRule,
  paymentDueTodayRule,
  paymentOutflowDueRule,
  recurringPaymentReminderRule,
  promiseBrokenRule,
  recurringExpenseConfirmRule,
  // New coverage (Phase 5): tasks & projects
  taskDueSoonRule,
  projectStartingRule,
  staleQuoteRule,
  projectClosedUnbilledRule,
  // Silent summaries
  lowStockRule,
  unprocessedItemsRule,
];

// --- the reconcile engine --------------------------------------------------

function buildContext(now: Date): RuleContext {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return {
    today,
    nowIso: now.toISOString(),
    todayIso: today.toISOString().slice(0, 10),
    nearHorizonIso: addWorkingDays(today, 3).toISOString().slice(0, 10),
  };
}

function toInsertRow(rule: SystemRule, item: SystemReminderItem, nowIso: string) {
  return {
    source: "system",
    dedupe_key: `${rule.key}:${item.key}`,
    title: item.title,
    content: item.content ?? "",
    url: item.url,
    severity: item.severity,
    behavior: item.behavior,
    repeat_rule: item.behavior === "ping_repeat" ? item.repeatRule ?? "daily" : null,
    max_pings: item.maxPings ?? null,
    // Delivery scheduling is Phase 3's job — leave unscheduled for now so nothing
    // pushes at an inappropriate hour before quiet-hours logic exists.
    next_ping_at: null,
    remind_at: nowIso,
    action_type: null,
    category: "system",
    status: "pending",
    assigned_to: item.assignedTo ?? null,
    audience_role: item.audienceRole ?? null,
    customer_id: item.links?.customer_id ?? null,
    order_id: item.links?.order_id ?? null,
    project_id: item.links?.project_id ?? null,
    property_id: item.links?.property_id ?? null,
    payment_id: item.links?.payment_id ?? null,
    task_id: item.links?.task_id ?? null,
    invoice_id: item.links?.invoice_id ?? null,
    vehicle_id: item.links?.vehicle_id ?? null,
    expense_id: item.links?.expense_id ?? null,
  };
}

export type RuleSyncResult = {
  rule: string;
  active: number;
  inserted: number;
  resolved: number;
  refreshed: number;
  error?: string;
};

async function reconcileRule(
  supabase: SupabaseClient,
  rule: SystemRule,
  items: SystemReminderItem[],
  nowIso: string
): Promise<RuleSyncResult> {
  const { data: existing, error } = await supabase
    .from("reminders")
    .select("id,dedupe_key,severity,title,content,behavior")
    .eq("source", "system")
    .eq("status", "pending")
    .like("dedupe_key", `${rule.key}:%`)
    .range(0, 9999);
  throwIf(error, `${rule.key}:read-existing`);

  const existingByKey = new Map<string, Row>();
  for (const r of (existing ?? []) as Row[]) {
    const dk = getString(r, "dedupe_key");
    if (dk) existingByKey.set(dk, r);
  }
  const activeKeys = new Set(items.map((i) => `${rule.key}:${i.key}`));

  // Insert brand-new problems.
  const toInsert = items.filter((i) => !existingByKey.has(`${rule.key}:${i.key}`)).map((i) => toInsertRow(rule, i, nowIso));
  if (toInsert.length) {
    const { error: insErr } = await supabase.from("reminders").insert(toInsert);
    throwIf(insErr, `${rule.key}:insert`);
  }

  // Refresh still-open problems whose text/severity/behavior moved. Behavior is
  // included so a rule flipped to 'silent' in code (e.g. collection_overdue)
  // actually stops pushing its ALREADY-open reminders — otherwise the old
  // per-item pings keep firing until each row happens to be recreated.
  let refreshed = 0;
  for (const i of items) {
    const dk = `${rule.key}:${i.key}`;
    const ex = existingByKey.get(dk);
    if (!ex) continue;
    const behaviorChanged = getString(ex, "behavior") !== i.behavior;
    if (
      getString(ex, "severity") !== i.severity ||
      getString(ex, "title") !== i.title ||
      getString(ex, "content") !== (i.content ?? "") ||
      behaviorChanged
    ) {
      const patch: Record<string, unknown> = { severity: i.severity, title: i.title, content: i.content ?? "", updated_at: nowIso };
      if (behaviorChanged) {
        patch.behavior = i.behavior;
        patch.repeat_rule = i.behavior === "ping_repeat" ? i.repeatRule ?? "daily" : null;
        // Newly-silent → cancel any scheduled ping so it never interrupts again.
        if (i.behavior === "silent") patch.next_ping_at = null;
      }
      const { error: updErr } = await supabase.from("reminders").update(patch).eq("id", getString(ex, "id"));
      if (!updErr) refreshed += 1;
    }
  }

  // Auto-close problems that no longer exist.
  const staleIds = ((existing ?? []) as Row[])
    .filter((r) => !activeKeys.has(getString(r, "dedupe_key") ?? ""))
    .map((r) => getString(r, "id"))
    .filter((id): id is string => Boolean(id));
  if (staleIds.length) {
    const { error: closeErr } = await supabase
      .from("reminders")
      .update({ status: "auto_resolved", resolved_at: nowIso })
      .in("id", staleIds);
    throwIf(closeErr, `${rule.key}:auto-close`);
  }

  return { rule: rule.key, active: items.length, inserted: toInsert.length, resolved: staleIds.length, refreshed };
}

/**
 * Evaluate every rule and reconcile the resulting system reminders. Safe to run
 * repeatedly (idempotent). A rule that throws is skipped WITHOUT auto-closing
 * its existing reminders, so a transient read error can't wipe the worklist.
 */
export async function syncSystemReminders(supabase: SupabaseClient, now: Date): Promise<RuleSyncResult[]> {
  const ctx = buildContext(now);
  // Each rule's on/off + audience come from the unified alert registry (tolerant
  // of pre-migration → empty map = all rules on with their built-in audience).
  const settings = await getRuleSettings(supabase);
  const results: RuleSyncResult[] = [];
  for (const rule of SYSTEM_RULES) {
    try {
      const cfg = settings.get(rule.key);
      // Disabled in settings → reconcile with an empty set so its existing
      // worklist items auto-close (turning a rule off clears it).
      if (cfg && !cfg.enabled) {
        results.push(await reconcileRule(supabase, rule, [], ctx.nowIso));
        continue;
      }
      const items = await rule.evaluate(supabase, ctx);
      let adjusted: SystemReminderItem[];
      if (cfg?.recipientUserIds?.length) {
        // Specific-people routing: fan each problem out to one per-user reminder
        // (its own read/snooze state); the per-user dedupe suffix keeps reconcile
        // + auto-close working per user. For OWNER-routed items (a task's
        // assignee, a project's PM) the recipients are ADDITIVE — the owner still
        // gets their own alert; recipients only REPLACE a role-bucket target.
        adjusted = items.flatMap((i) => {
          const targets = new Set(cfg.recipientUserIds);
          if (i.assignedTo) targets.add(i.assignedTo);
          return [...targets].map((uid) => ({ ...i, key: `${i.key}:u:${uid}`, assignedTo: uid, audienceRole: null }));
        });
      } else if (cfg?.audienceRole) {
        // Config can override the audience of role-targeted items.
        adjusted = items.map((i) => (i.audienceRole ? { ...i, audienceRole: cfg.audienceRole as SystemReminderItem["audienceRole"] } : i));
      } else {
        adjusted = items;
      }
      results.push(await reconcileRule(supabase, rule, adjusted, ctx.nowIso));
    } catch (err) {
      results.push({ rule: rule.key, active: 0, inserted: 0, resolved: 0, refreshed: 0, error: (err as Error)?.message ?? "failed" });
    }
  }

  // Close out anything left behind by a rule that no longer exists.
  for (const key of RETIRED_RULE_KEYS) {
    try {
      results.push(await reconcileRule(supabase, { key, label: key, evaluate: async () => [] }, [], ctx.nowIso));
    } catch (err) {
      results.push({ rule: key, active: 0, inserted: 0, resolved: 0, refreshed: 0, error: (err as Error)?.message ?? "failed" });
    }
  }

  // Reminders are no longer audited row-by-row (trg_audit_reminders was dropped
  // in migration 20260724040000 — it flooded the activity feed). Instead, when a
  // sync batch actually changed something, log ONE summary row. Renders in the
  // feed as "המערכת עדכנה N תזכורות".
  const totals = results.reduce(
    (acc, r) => {
      acc.inserted += r.inserted;
      acc.refreshed += r.refreshed;
      acc.resolved += r.resolved;
      return acc;
    },
    { inserted: 0, refreshed: 0, resolved: 0 }
  );
  const changed = totals.inserted + totals.refreshed + totals.resolved;
  if (changed > 0) {
    await logAuditEvent({
      supabase,
      tableName: "system",
      recordId: "00000000-0000-0000-0000-000000000000",
      action: "reminders_synced",
      changedBy: null,
      userRole: null,
      newData: {
        count: changed,
        inserted: totals.inserted,
        refreshed: totals.refreshed,
        resolved: totals.resolved,
      },
    });
  }

  return results;
}
