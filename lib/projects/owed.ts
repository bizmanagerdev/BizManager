import type { SupabaseClient } from "@supabase/supabase-js";
import { expenseOpenAmount, expensePaidSoFar, normalizeExpensePaymentState } from "@/lib/financial/expenseOpen";
import { fetchAllPagedResult } from "@/lib/supabase/paginate";

// "אנחנו חייבים" for a project: what WE still owe on it — the project's
// expenses that aren't fully paid (a supplier invoice, a container bill…) plus
// the wages still owed to workers for it. The mirror of what the customer owes
// us, shown on every row of the projects list and broken down on the project.
//
// Expenses use the one "still owed" rule (expenseOpenAmount); wages come from
// project_worker_balance_view — the "יתרה לעובדים" the project page already
// showed. Linked through project_expenses, the same link the project's profit
// is computed from, so the two can never disagree about which costs belong.

export type ProjectOwedExpense = {
  expenseId: string;
  label: string;
  /** expense_date — when it was due. */
  date: string | null;
  total: number;
  paid: number;
  open: number;
  status: "not_paid" | "partial";
};

export type ProjectOwed = {
  /** expensesOpen + workersOwed. */
  total: number;
  expensesOpen: number;
  workersOwed: number;
  /** Already paid to workers for this project (context for the wages line). */
  workersPaid: number;
  /** The open expenses, oldest first. */
  expenses: ProjectOwedExpense[];
};

type Row = Record<string, unknown>;

function toNum(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function emptyProjectOwed(): ProjectOwed {
  return { total: 0, expensesOpen: 0, workersOwed: 0, workersPaid: 0, expenses: [] };
}

/** Sets the wages part from an already-loaded project_worker_balance_view row. */
export function withWorkerBalance(owed: ProjectOwed, workerOwed: number, workerPaid: number): ProjectOwed {
  const workersOwed = round2(Math.max(workerOwed, 0));
  return {
    ...owed,
    workersOwed,
    workersPaid: round2(Math.max(workerPaid, 0)),
    total: round2(owed.expensesOpen + workersOwed),
  };
}

/**
 * Combine the raw reads into one ProjectOwed per project. `links` are
 * project_expenses rows with their expense embedded (as `expenses`, an object
 * or a one-element array — PostgREST returns either); `workers` are
 * project_worker_balance_view rows. Pure, so it's tested without a database.
 */
export function combineProjectOwed(links: Row[], workers: Row[]): Map<string, ProjectOwed> {
  const byProject = new Map<string, ProjectOwed>();
  const get = (projectId: string) => {
    let owed = byProject.get(projectId);
    if (!owed) {
      owed = emptyProjectOwed();
      byProject.set(projectId, owed);
    }
    return owed;
  };

  for (const link of links) {
    const projectId = typeof link.project_id === "string" ? link.project_id : null;
    const embedded = Array.isArray(link.expenses) ? (link.expenses[0] as Row | undefined) : (link.expenses as Row | null | undefined);
    if (!projectId || !embedded || typeof embedded.id !== "string") continue;
    const status = normalizeExpensePaymentState(typeof embedded.payment_status === "string" ? embedded.payment_status : null);
    if (status !== "not_paid" && status !== "partial") continue;
    const input = { amount: toNum(embedded.amount), paid_amount: toNum(embedded.paid_amount), payment_status: status };
    const open = expenseOpenAmount(input);
    if (open <= 0.009) continue;
    const description = typeof embedded.description === "string" ? embedded.description.trim() : "";
    const category = typeof embedded.category === "string" ? embedded.category.trim() : "";
    const date = typeof embedded.expense_date === "string" ? embedded.expense_date.slice(0, 10) : null;
    const owed = get(projectId);
    owed.expenses.push({
      expenseId: embedded.id,
      label: description || category || "הוצאה",
      date,
      total: round2(Math.max(toNum(embedded.amount), 0)),
      paid: expensePaidSoFar(input),
      open,
      status,
    });
    owed.expensesOpen = round2(owed.expensesOpen + open);
  }

  for (const row of workers) {
    const projectId = typeof row.project_id === "string" ? row.project_id : null;
    if (!projectId) continue;
    // An overpaid project (negative balance) owes nothing — never subtract it
    // from what the project's expenses still owe.
    const owedToWorkers = round2(Math.max(toNum(row.owed_amount), 0));
    const paidToWorkers = round2(Math.max(toNum(row.paid_amount), 0));
    if (owedToWorkers <= 0.009 && paidToWorkers <= 0.009) continue;
    const owed = get(projectId);
    owed.workersOwed = owedToWorkers;
    owed.workersPaid = paidToWorkers;
  }

  for (const owed of byProject.values()) {
    owed.expenses.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
    owed.total = round2(owed.expensesOpen + owed.workersOwed);
  }
  return byProject;
}

const OWED_EXPENSE_SELECT = "project_id,expenses!inner(id,amount,paid_amount,payment_status,expense_date,category,description)";

/**
 * What we owe on each of these projects. Two small reads, side by side — only
 * UNPAID expenses are fetched, so it stays cheap.
 *
 * `projectIds: null` reads every project that owes anything — for the projects
 * list, which can then start this BEFORE its own query returns the page's ids
 * (alongside it, not after it). That is a handful of rows: the open project
 * expenses and the projects with wages still owed.
 *
 * A failed read counts as nothing owed rather than failing the page (the figure
 * is extra information on the row, not the row itself).
 */
export async function loadProjectOwed(
  supabase: SupabaseClient,
  projectIds: string[] | null,
  // The project page already reads project_worker_balance_view for its own
  // wage figures — it passes false and merges those in (withWorkerBalance).
  { includeWorkers = true }: { includeWorkers?: boolean } = {}
): Promise<Map<string, ProjectOwed>> {
  const empty = { data: [] as Row[], error: null };
  if (projectIds === null) {
    const [linksResult, workersResult] = await Promise.all([
      fetchAllPagedResult<Row>((from, to) =>
        supabase
          .from("project_expenses")
          .select(OWED_EXPENSE_SELECT)
          .in("expenses.payment_status", ["not_paid", "partial"])
          .order("id", { ascending: true })
          .range(from, to)
      ),
      includeWorkers
        ? fetchAllPagedResult<Row>((from, to) =>
            supabase
              .from("project_worker_balance_view")
              .select("project_id,owed_amount,paid_amount")
              .gt("owed_amount", 0.009)
              .order("project_id", { ascending: true })
              .range(from, to)
          )
        : Promise.resolve(empty),
    ]);
    return combineProjectOwed(
      linksResult.error ? [] : linksResult.data ?? [],
      workersResult.error ? [] : workersResult.data ?? []
    );
  }

  const ids = Array.from(new Set(projectIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const [linksResult, workersResult] = await Promise.all([
    supabase
      .from("project_expenses")
      .select(OWED_EXPENSE_SELECT)
      .in("project_id", ids)
      .in("expenses.payment_status", ["not_paid", "partial"]),
    includeWorkers
      ? supabase.from("project_worker_balance_view").select("project_id,owed_amount,paid_amount").in("project_id", ids)
      : Promise.resolve(empty),
  ]);
  return combineProjectOwed(
    linksResult.error ? [] : ((linksResult.data ?? []) as Row[]),
    workersResult.error ? [] : ((workersResult.data ?? []) as Row[])
  );
}

/**
 * The projects list's fields for "אנחנו חייבים": `we_owe_amount` (the one
 * number on the row) and its two parts. Every row gets them — 0 when nothing
 * is owed — so a row never shows a stale figure from before a payment.
 */
export function attachOwedToRows<T extends Record<string, unknown>>(rows: T[], owedByProject: Map<string, ProjectOwed>) {
  return rows.map((row) => {
    const owed = typeof row.id === "string" ? owedByProject.get(row.id) : undefined;
    return {
      ...row,
      we_owe_amount: owed?.total ?? 0,
      we_owe_expenses: owed?.expensesOpen ?? 0,
      we_owe_workers: owed?.workersOwed ?? 0,
    };
  });
}
