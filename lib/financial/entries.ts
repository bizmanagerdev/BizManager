import { getBusinessDomainLabel } from "@/lib/expenses";
import { paymentMethodLabel } from "@/lib/orders/paymentStatus";
import type { ExpenseBusinessDomain } from "@/lib/expenses";
import type { Loan } from "@/lib/loans";
import type {
  AttendanceSessionFinanceRow,
  ExpenseRow,
  FinancialDomainGroup,
  FinancialEntry,
  FinancialEntryStage,
  FinancialEntryType,
  FinancialSummary,
  ForecastChangePoint,
  MonthlyTrendPoint,
  OrderFinancialRow,
  OrderRow,
  PaymentRow,
  ProfitLossCategoryRow,
  ProfitLossDomainRow,
  ProjectFinancialRow,
  ProjectRow,
  PropertyRow,
  WorkerDebtItemRow,
  WorkerPaymentAllocationRow,
  WorkerPaymentRow,
} from "./types";
import {
  isFutureEntry,
  nextMonthDueDate,
  normalizeDate,
  normalizePaymentMethod,
  normalizePaymentStatus,
  normalizeStatusValue,
  normalizeDomain,
  todayIso,
  toNumber,
} from "./utils";

// ─── Customer filter ───────────────────────────────────────────────────────────

export function matchesCustomerFilter(args: {
  customerId: string | null;
  customerProjectIds: Set<string>;
  projectId: string | null;
  orderCustomerId: string | null;
  propertyCustomerIds: Set<string> | null;
  projectCustomerId: string | null;
}) {
  const { customerId, customerProjectIds, projectId, orderCustomerId, propertyCustomerIds, projectCustomerId } = args;
  if (!customerId) return true;
  if (projectId) return projectCustomerId === customerId || customerProjectIds.has(projectId);
  if (orderCustomerId) return orderCustomerId === customerId;
  if (propertyCustomerIds) return propertyCustomerIds.has(customerId);
  return false;
}

// ─── Flow meta builders ────────────────────────────────────────────────────────

export function buildPaymentFlowMeta(row: PaymentRow, referenceDate: string) {
  const paymentDate = normalizeDate(row.payment_date);
  const dueDate = normalizeDate(row.due_date);
  const method = normalizePaymentMethod(row.payment_method);
  const status = normalizePaymentStatus(row.payment_status);
  const isCheck = method === "check";
  // Expected (not-yet-collected) money: a check awaiting clearance, OR any payment
  // explicitly marked pending (e.g. שוטף+30 bank transfer). It flows on its
  // due_date — not the record date — and must never count as posted/actual income.
  const isExpected = status === "pending" || (isCheck && status !== "cleared");
  const flowDate = (isCheck || isExpected) && dueDate ? dueDate : paymentDate;
  if (!flowDate) return null;

  const stage: FinancialEntryStage = isExpected
    ? flowDate > referenceDate
      ? "scheduled"
      : "pending"
    : flowDate > referenceDate
      ? "scheduled"
      : "posted";

  return { flowDate, paymentDate, dueDate, stage, method, status };
}

export function buildExpenseFlowMeta(row: ExpenseRow, referenceDate: string) {
  const expenseDate = normalizeDate(row.expense_date);
  if (!expenseDate) return null;
  const paymentStatus = normalizePaymentStatus(row.payment_status);
  const paidDate = normalizeDate(row.paid_date);
  // A confirmed (paid) expense flows on the day the money actually left (paid_date)
  // when we have it — so paying early/late lands the cash-out on the real day —
  // while the original scheduled expense_date stays as the recorded date.
  const flowDate = paymentStatus === "paid" && paidDate ? paidDate : expenseDate;
  const isPast = flowDate <= referenceDate;
  const stage: FinancialEntryStage = !isPast
    ? "scheduled"
    : paymentStatus === "not_paid" || paymentStatus === "partial"
      ? "pending"
      : "posted";
  return { flowDate, recordedDate: expenseDate, stage };
}

export function buildWorkerPaymentFlowMeta(paymentDateValue: string | null | undefined, referenceDate: string) {
  const paymentDate = normalizeDate(paymentDateValue);
  if (!paymentDate) return null;
  return {
    flowDate: paymentDate,
    recordedDate: paymentDate,
    stage: paymentDate > referenceDate ? ("scheduled" as const) : ("posted" as const),
  };
}

export function buildWorkerOwedFlowMeta(clockInValue: string | null | undefined) {
  const recordedDate = normalizeDate(clockInValue);
  return {
    flowDate: recordedDate || todayIso(),
    dueDate: recordedDate,
    recordedDate,
    stage: "pending" as const,
  };
}

export function buildMonthlyWorkerOwedFlowMeta(clockInValue: string | null | undefined, referenceDate: string) {
  const recordedDate = normalizeDate(clockInValue);
  const dueDate = nextMonthDueDate(recordedDate, 10);
  const flowDate = dueDate ?? recordedDate ?? todayIso();
  return {
    flowDate,
    dueDate,
    recordedDate,
    stage: flowDate > referenceDate ? ("scheduled" as const) : ("pending" as const),
  };
}

export function buildWorkerDebtItemFlowMeta(args: {
  sourceDate: string | null | undefined;
  dueDate: string | null | undefined;
  sourceType: string | null | undefined;
  referenceDate: string;
}) {
  const sourceDate = normalizeDate(args.sourceDate);
  const explicitDueDate = normalizeDate(args.dueDate);
  const monthlyMeta =
    args.sourceType?.trim().toLowerCase() === "payslip"
      ? buildMonthlyWorkerOwedFlowMeta(sourceDate, args.referenceDate)
      : null;
  const dueDate = explicitDueDate ?? monthlyMeta?.dueDate ?? sourceDate;
  const flowDate = explicitDueDate ?? monthlyMeta?.flowDate ?? sourceDate ?? todayIso();
  return {
    flowDate,
    dueDate,
    recordedDate: sourceDate,
    stage: flowDate > args.referenceDate ? ("scheduled" as const) : ("pending" as const),
  };
}

export function buildReceivableFlowMeta(recordedDateValue: string | null | undefined, referenceDate: string) {
  const recordedDate = normalizeDate(recordedDateValue);
  return {
    flowDate: recordedDate || referenceDate,
    dueDate: recordedDate,
    recordedDate,
    stage: "pending" as const,
  };
}

export function buildPlannedReceivableFlowMeta(
  candidates: Array<string | null | undefined>,
  referenceDate: string
) {
  const dates = candidates
    .map(normalizeDate)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right));
  const recordedDate = dates[0] ?? null;
  const flowDate = recordedDate && recordedDate > referenceDate ? recordedDate : referenceDate;
  return { flowDate, dueDate: recordedDate, recordedDate, stage: "scheduled" as const };
}

// ─── Source + description builders ────────────────────────────────────────────

export function buildSource(args: {
  businessDomain: ExpenseBusinessDomain | null;
  projectId: string | null;
  orderId: string | null;
  propertyId: string | null;
  projectName: string | null;
  propertyAddress: string | null;
}) {
  const { businessDomain, projectId, orderId, propertyId, projectName, propertyAddress } = args;

  if (projectId) {
    return {
      kind: "project" as const,
      id: projectId,
      label: projectName || `פרויקט ${projectId.slice(0, 8)}`,
      href: `/projects/${projectId}`,
    };
  }
  if (propertyId) {
    return {
      kind: "property" as const,
      id: propertyId,
      label: propertyAddress || `נכס ${propertyId.slice(0, 8)}`,
      href: "/properties",
    };
  }
  if (orderId) {
    return {
      kind: "order" as const,
      id: orderId,
      label: `הזמנה ${orderId.slice(0, 8)}`,
      href: `/sales/orders/${orderId}`,
    };
  }
  if (businessDomain === "property_management") {
    return { kind: "general" as const, id: null, label: "פעילות נכסים שוטפת", href: null };
  }
  if (businessDomain === "sales") {
    return { kind: "general" as const, id: null, label: "פעילות מכירות שוטפת", href: null };
  }
  return { kind: "general" as const, id: null, label: "פעילות שוטפת", href: null };
}

export function resolvePaymentLinks(row: PaymentRow) {
  const targetType = typeof row.target_type === "string" ? row.target_type.trim() : "";
  const targetId = typeof row.target_id === "string" ? row.target_id.trim() : "";
  return {
    projectId: row.project_id?.trim() || (targetType === "project" && targetId ? targetId : null),
    orderId: row.order_id?.trim() || (targetType === "order" && targetId ? targetId : null),
    propertyId: row.property_id?.trim() || (targetType === "property" && targetId ? targetId : null),
  };
}

export function buildPaymentDescription(row: PaymentRow) {
  const notes = row.notes?.trim();
  if (notes) return notes;
  const referenceNumber = row.reference_number?.trim();
  if (referenceNumber) return referenceNumber;
  const method = row.payment_method?.trim();
  if (method) return paymentMethodLabel(method);
  return "תשלום";
}

export function buildExpenseDescription(row: ExpenseRow) {
  const description = row.description?.trim();
  if (description) return description;
  const notes = row.notes?.trim();
  if (notes) return notes;
  const category = row.category?.trim();
  if (category) return category;
  return "הוצאה";
}

export function buildWorkerPaymentDescription(workerName: string | null) {
  return workerName ? `שכר עובד — ${workerName}` : "שכר עובד";
}

// ─── Status helpers ───────────────────────────────────────────────────────────

export function isClosedProjectStatus(status: string | null | undefined) {
  return normalizeStatusValue(status) === "completed";
}

export function isExcludedProjectStatus(status: string | null | undefined) {
  const value = normalizeStatusValue(status);
  return value === "cancelled" || value === "canceled" || value === "quote";
}

export function isClosedOrderStatus(status: string | null | undefined) {
  const value = normalizeStatusValue(status);
  return value === "delivered" || value === "completed" || value === "closed";
}

export function isExcludedOrderStatus(status: string | null | undefined) {
  const value = normalizeStatusValue(status);
  return value === "cancelled" || value === "canceled";
}

// ─── Salary agreement helpers ─────────────────────────────────────────────────

// ─── Summary + grouping ────────────────────────────────────────────────────────

export function createEmptySummary(): FinancialSummary {
  return { inflow: 0, outflow: 0, net: 0, count: 0 };
}

export function summarizeEntries(entries: FinancialEntry[]): FinancialSummary {
  const summary = createEmptySummary();
  entries.forEach((entry) => {
    if (entry.type === "inflow") summary.inflow += entry.amount;
    if (entry.type === "outflow") summary.outflow += entry.amount;
    summary.net += entry.signedAmount;
    summary.count += 1;
  });
  return summary;
}

export function buildDomainGroups(entries: FinancialEntry[], referenceDate: string): FinancialDomainGroup[] {
  const groups = new Map<string, FinancialDomainGroup>();

  entries.forEach((entry) => {
    const key = entry.businessDomain ?? "__unassigned__";
    const current = groups.get(key) ?? {
      domain: entry.businessDomain,
      domainName: entry.domainName,
      actual: createEmptySummary(),
      future: createEmptySummary(),
      total: createEmptySummary(),
    };

    const bucket = entry.flowDate > referenceDate || entry.stage !== "posted" ? current.future : current.actual;
    if (entry.type === "inflow") {
      bucket.inflow += entry.amount;
      current.total.inflow += entry.amount;
    } else {
      bucket.outflow += entry.amount;
      current.total.outflow += entry.amount;
    }
    bucket.net += entry.signedAmount;
    bucket.count += 1;
    current.total.net += entry.signedAmount;
    current.total.count += 1;
    groups.set(key, current);
  });

  return Array.from(groups.values()).sort(
    (left, right) =>
      Math.abs(right.total.net) - Math.abs(left.total.net) || right.total.count - left.total.count
  );
}

// Domains that are personal rather than business activity. The P&L excludes them
// by default (the UI offers a toggle to include them).
const PERSONAL_DOMAINS: ReadonlySet<string> = new Set(["home", "charity"]);

export function isPersonalDomain(domain: string | null | undefined): boolean {
  return domain != null && PERSONAL_DOMAINS.has(domain);
}

/**
 * Pure per-domain profit & loss aggregation over the entries whose `flowDate`
 * falls within [from, to]. Both bases are computed in one pass:
 *  - cash (בפועל):     posted income vs posted expenses/wages (+ paid portion of partial expenses).
 *  - accrual (כולל פתוחים): cash + open receivables (earned) and open liabilities (incurred).
 * Scheduled/future entries are excluded from both (forecast, not realized/earned).
 * Returns every domain with activity, sorted by accrual net (revenue - expense) desc.
 */
export function aggregateProfitLoss(
  entries: FinancialEntry[],
  options: { from?: string | null; to?: string | null } = {}
): ProfitLossDomainRow[] {
  const from = options.from || null;
  const to = options.to || null;
  const rows = new Map<string, ProfitLossDomainRow>();

  for (const entry of entries) {
    if (from && entry.flowDate < from) continue;
    if (to && entry.flowDate > to) continue;

    const key = entry.businessDomain ?? "__unassigned__";
    let row = rows.get(key);
    if (!row) {
      const domain = entry.businessDomain;
      row = {
        domain,
        domainName: entry.domainName || getBusinessDomainLabel(domain),
        isPersonal: domain != null && PERSONAL_DOMAINS.has(domain),
        cashRevenue: 0,
        cashExpense: 0,
        accrualRevenue: 0,
        accrualExpense: 0,
      };
      rows.set(key, row);
    }

    const { type, stage, origin, amount } = entry;
    const partialPaid =
      entry.expensePaidAmount != null && entry.expensePaidAmount > 0 ? entry.expensePaidAmount : 0;

    if (type === "inflow") {
      if (origin === "payment" && stage === "posted") {
        row.cashRevenue += amount;
        row.accrualRevenue += amount;
      } else if (
        (origin === "project_receivable" || origin === "order_receivable") &&
        stage === "pending"
      ) {
        // Earned but not yet collected — accrual only.
        row.accrualRevenue += amount;
      }
    } else if (type === "outflow") {
      if (origin === "payment") {
        // A refund (negative payment) is CONTRA-REVENUE, not an expense — it
        // reduces revenue, mirroring the inflow side (posted → cash + accrual).
        if (stage === "posted") {
          row.cashRevenue -= amount;
          row.accrualRevenue -= amount;
        } else {
          row.accrualRevenue -= amount;
        }
      } else if (origin === "expense") {
        if (stage === "posted") {
          row.cashExpense += amount;
          row.accrualExpense += amount;
        } else if (stage === "pending") {
          // Incurred but unpaid (not_paid / partial): full amount accrues; only
          // the already-paid portion counts as cash out.
          row.accrualExpense += amount;
          row.cashExpense += partialPaid;
        }
      } else if (origin === "worker_payment" && stage === "posted") {
        row.cashExpense += amount;
        row.accrualExpense += amount;
      } else if (origin === "worker_owed" && stage === "pending") {
        // Wages incurred but unpaid — accrual only.
        row.accrualExpense += amount;
      }
    }
  }

  return Array.from(rows.values())
    .filter(
      (row) =>
        row.cashRevenue !== 0 ||
        row.cashExpense !== 0 ||
        row.accrualRevenue !== 0 ||
        row.accrualExpense !== 0
    )
    .sort(
      (left, right) =>
        right.accrualRevenue - right.accrualExpense - (left.accrualRevenue - left.accrualExpense)
    );
}

const WAGES_CATEGORY = "שכר עובדים";
const UNCATEGORIZED = "ללא קטגוריה";

/**
 * Expense line items by category over [from, to] — the classic P&L expense
 * breakdown. Worker pay (paid + owed) collapses into a single "שכר עובדים" line.
 * Both bases mirror aggregateProfitLoss's expense rules so the UI basis toggle
 * keeps the category table consistent with the totals.
 */
export function aggregateExpenseCategories(
  entries: FinancialEntry[],
  options: { from?: string | null; to?: string | null } = {}
): ProfitLossCategoryRow[] {
  const from = options.from || null;
  const to = options.to || null;
  const rows = new Map<string, ProfitLossCategoryRow>();

  const add = (category: string, cash: number, accrual: number) => {
    let row = rows.get(category);
    if (!row) {
      row = { category, cashExpense: 0, accrualExpense: 0 };
      rows.set(category, row);
    }
    row.cashExpense += cash;
    row.accrualExpense += accrual;
  };

  for (const entry of entries) {
    if (entry.type !== "outflow") continue;
    if (from && entry.flowDate < from) continue;
    if (to && entry.flowDate > to) continue;

    const { stage, origin, amount } = entry;
    const partialPaid =
      entry.expensePaidAmount != null && entry.expensePaidAmount > 0 ? entry.expensePaidAmount : 0;

    if (origin === "expense") {
      const category = entry.expenseCategory?.trim() || UNCATEGORIZED;
      if (stage === "posted") add(category, amount, amount);
      else if (stage === "pending") add(category, partialPaid, amount);
    } else if (origin === "worker_payment" && stage === "posted") {
      add(WAGES_CATEGORY, amount, amount);
    } else if (origin === "worker_owed" && stage === "pending") {
      add(WAGES_CATEGORY, 0, amount);
    }
  }

  return Array.from(rows.values())
    .filter((row) => row.cashExpense !== 0 || row.accrualExpense !== 0)
    .sort((left, right) => right.accrualExpense - left.accrualExpense);
}

function monthKey(isoDate: string) {
  return isoDate.slice(0, 7); // YYYY-MM
}

function addMonthsToMonthKey(monthKeyValue: string, delta: number) {
  const [year, month] = monthKeyValue.split("-").map(Number);
  const base = new Date(Date.UTC(year, (month - 1) + delta, 1));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Realized (posted) cash movement per calendar month within [from, to], for the
 * monthly income-vs-expense-vs-net trend. Posted-only = the cash reality, matching
 * the cash-flow tab. Empty months in the range are filled with zeros so the chart
 * shows a continuous timeline.
 */
export function buildMonthlyTrend(
  entries: FinancialEntry[],
  options: { from?: string | null; to?: string | null } = {}
): MonthlyTrendPoint[] {
  const from = options.from || null;
  const to = options.to || null;
  const grouped = new Map<string, MonthlyTrendPoint>();

  for (const entry of entries) {
    if (entry.stage !== "posted") continue;
    if (from && entry.flowDate < from) continue;
    if (to && entry.flowDate > to) continue;

    const key = monthKey(entry.flowDate);
    let point = grouped.get(key);
    if (!point) {
      point = { month: key, inflow: 0, outflow: 0, net: 0 };
      grouped.set(key, point);
    }
    if (entry.type === "inflow") point.inflow += entry.amount;
    else point.outflow += entry.amount;
    point.net = point.inflow - point.outflow;
  }

  // Fill gaps between the first and last observed month so the timeline is continuous.
  const keys = [...grouped.keys()].sort();
  if (keys.length === 0) return [];
  const result: MonthlyTrendPoint[] = [];
  for (let key = keys[0]; key <= keys[keys.length - 1]; key = addMonthsToMonthKey(key, 1)) {
    result.push(grouped.get(key) ?? { month: key, inflow: 0, outflow: 0, net: 0 });
  }
  return result;
}

/**
 * Expected net cash change for each of the next `months` calendar months, from
 * not-yet-realized items (scheduled future income/expenses + pending checks/debts).
 * Overdue pending items (flowDate before the current month) are folded into the
 * first month so they aren't lost. The running projected balance is computed by
 * the caller, starting from the current actual balance.
 */
export function buildForecastMonthly(
  entries: FinancialEntry[],
  options: { referenceDate: string; months?: number }
): ForecastChangePoint[] {
  const months = options.months ?? 6;
  const currentMonth = monthKey(options.referenceDate);
  const horizon: string[] = [];
  for (let index = 0; index < months; index += 1) {
    horizon.push(addMonthsToMonthKey(currentMonth, index));
  }
  const lastMonth = horizon[horizon.length - 1];
  const changeByMonth = new Map<string, number>(horizon.map((month) => [month, 0]));

  for (const entry of entries) {
    if (entry.stage === "posted") continue; // only not-yet-realized money
    const entryMonth = monthKey(entry.flowDate);
    // Fold overdue/pending (before this month) into the current month; ignore
    // anything beyond the horizon.
    const bucket = entryMonth < currentMonth ? currentMonth : entryMonth;
    if (bucket > lastMonth) continue;
    changeByMonth.set(bucket, (changeByMonth.get(bucket) ?? 0) + entry.signedAmount);
  }

  return horizon.map((month) => ({ month, change: changeByMonth.get(month) ?? 0 }));
}

export function matchesEntryFilters(
  entry: FinancialEntry,
  filters: {
    from: string | null;
    to: string | null;
    domain: ExpenseBusinessDomain | null;
    sourceId: string | null;
    type: FinancialEntryType | null;
    stage: "actual" | "future" | "pending" | null;
    query: string;
    referenceDate: string;
  }
) {
  if (filters.from && entry.flowDate < filters.from) return false;
  if (filters.to && entry.flowDate > filters.to) return false;
  if (filters.domain && entry.businessDomain !== filters.domain) return false;
  if (filters.sourceId && entry.sourceId !== filters.sourceId) return false;
  if (filters.type && entry.type !== filters.type) return false;
  if (filters.stage === "actual" && isFutureEntry(entry, filters.referenceDate)) return false;
  if (filters.stage === "future" && !isFutureEntry(entry, filters.referenceDate)) return false;
  if (filters.stage === "pending" && entry.stage !== "pending") return false;
  if (!filters.query) return true;
  return entry.searchText.includes(filters.query);
}

export function paginateEntries(entries: FinancialEntry[], page: number, pageSize: number) {
  const totalCount = entries.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * pageSize;
  return { entries: entries.slice(start, start + pageSize), totalCount, page: currentPage, totalPages };
}

export function sortEntries(entries: FinancialEntry[]) {
  return [...entries].sort((left, right) => {
    const dateCompare = right.flowDate.localeCompare(left.flowDate);
    if (dateCompare !== 0) return dateCompare;
    return right.id.localeCompare(left.id);
  });
}

// ─── Per-origin entry builders ────────────────────────────────────────────────

export function buildPaymentEntries(args: {
  paymentRows: PaymentRow[];
  projectsById: Map<string, ProjectRow>;
  ordersById: Map<string, OrderRow>;
  propertiesById: Map<string, PropertyRow>;
  propertyCustomersById: Map<string, Set<string>>;
  recordedByNames: Record<string, string>;
  customerId: string | null;
  customerProjectSet: Set<string>;
  referenceDate: string;
}): FinancialEntry[] {
  const { paymentRows, projectsById, ordersById, propertiesById, propertyCustomersById, recordedByNames, customerId, customerProjectSet, referenceDate } = args;

  return paymentRows.flatMap((row) => {
    const flowMeta = buildPaymentFlowMeta(row, referenceDate);
    if (!row.id || !flowMeta) return [];

    const links = resolvePaymentLinks(row);
    const businessDomain = normalizeDomain(row.business_domain);
    const linkedProject = links.projectId ? projectsById.get(links.projectId) ?? null : null;
    const linkedOrder = links.orderId ? ordersById.get(links.orderId) ?? null : null;
    const linkedProperty = links.propertyId ? propertiesById.get(links.propertyId) ?? null : null;
    const propertyCustomers = links.propertyId ? propertyCustomersById.get(links.propertyId) ?? null : null;

    if (!matchesCustomerFilter({
      customerId, customerProjectIds: customerProjectSet,
      projectId: links.projectId, orderCustomerId: linkedOrder?.customer_id ?? null,
      propertyCustomerIds: propertyCustomers, projectCustomerId: linkedProject?.customer_id ?? null,
    })) return [];

    // A payment with a negative amount_total is a REFUND — money leaving the
    // business. It must read as an outflow (and as contra-revenue in the P&L,
    // see aggregateProfitLoss), never as positive income.
    const signedTotal = toNumber(row.amount_total);
    const isRefund = signedTotal < 0;
    const amount = Math.abs(signedTotal);
    const source = buildSource({
      businessDomain, projectId: links.projectId, orderId: links.orderId, propertyId: links.propertyId,
      projectName: linkedProject?.name?.trim() || null, propertyAddress: linkedProperty?.address?.trim() || null,
    });
    const description = buildPaymentDescription(row);
    const reference = row.reference_number?.trim() || null;
    const paymentMethodValue = row.payment_method?.trim() || null;

    return [{
      id: `payment:${row.id}`,
      type: isRefund ? ("outflow" as const) : ("inflow" as const),
      amount,
      signedAmount: isRefund ? -amount : amount,
      businessDomain,
      domainName: getBusinessDomainLabel(businessDomain),
      flowDate: flowMeta.flowDate,
      recordedDate: flowMeta.paymentDate,
      dueDate: flowMeta.dueDate,
      stage: flowMeta.stage,
      sourceKind: source.kind,
      sourceId: source.id,
      sourceLabel: source.label,
      sourceHref: source.href,
      description,
      origin: "payment" as const,
      reference,
      paymentMethod: paymentMethodValue,
      paymentMethodLabel: paymentMethodValue ? paymentMethodLabel(paymentMethodValue) : null,
      paymentStatus: flowMeta.status,
      recordedByName: typeof row.recorded_by === "string" ? recordedByNames[row.recorded_by] ?? null : null,
      customerId: linkedOrder?.customer_id ?? linkedProject?.customer_id ?? null,
      searchText: [description, source.label, reference ?? "", row.notes ?? "", row.payment_method ?? "",
        row.payment_status ?? "", getBusinessDomainLabel(businessDomain),
        typeof row.recorded_by === "string" ? recordedByNames[row.recorded_by] ?? "" : ""]
        .join(" ").toLowerCase(),
    }];
  });
}

export function buildExpenseEntries(args: {
  expenseRows: ExpenseRow[];
  projectsById: Map<string, ProjectRow>;
  ordersById: Map<string, OrderRow>;
  propertiesById: Map<string, PropertyRow>;
  propertyCustomersById: Map<string, Set<string>>;
  projectExpenseLinksByExpenseId: Map<string, string>;
  recordedByNames: Record<string, string>;
  customerId: string | null;
  customerProjectSet: Set<string>;
  referenceDate: string;
}): FinancialEntry[] {
  const { expenseRows, projectsById, ordersById, propertiesById, propertyCustomersById, projectExpenseLinksByExpenseId, recordedByNames, customerId, customerProjectSet, referenceDate } = args;

  return expenseRows.flatMap((row) => {
    const flowMeta = buildExpenseFlowMeta(row, referenceDate);
    if (!row.id || !flowMeta) return [];

    const businessDomain = normalizeDomain(row.business_domain);
    const resolvedProjectId = row.project_id || projectExpenseLinksByExpenseId.get(row.id) || null;
    const linkedProject = resolvedProjectId ? projectsById.get(resolvedProjectId) ?? null : null;
    const linkedOrder = row.order_id ? ordersById.get(row.order_id) ?? null : null;
    const linkedProperty = row.property_id ? propertiesById.get(row.property_id) ?? null : null;
    const propertyCustomers = row.property_id ? propertyCustomersById.get(row.property_id) ?? null : null;

    if (!matchesCustomerFilter({
      customerId, customerProjectIds: customerProjectSet,
      projectId: resolvedProjectId, orderCustomerId: linkedOrder?.customer_id ?? null,
      propertyCustomerIds: propertyCustomers, projectCustomerId: linkedProject?.customer_id ?? null,
    })) return [];

    const amount = Math.abs(toNumber(row.amount));
    const source = buildSource({
      businessDomain, projectId: resolvedProjectId, orderId: row.order_id, propertyId: row.property_id,
      projectName: linkedProject?.name?.trim() || null, propertyAddress: linkedProperty?.address?.trim() || null,
    });
    const description = buildExpenseDescription(row);
    const reference = row.category?.trim() || null;

    return [{
      id: `expense:${row.id}`,
      type: "outflow" as const,
      amount,
      signedAmount: -amount,
      businessDomain,
      domainName: getBusinessDomainLabel(businessDomain),
      flowDate: flowMeta.flowDate,
      recordedDate: flowMeta.recordedDate,
      dueDate: null,
      stage: flowMeta.stage,
      sourceKind: source.kind,
      sourceId: source.id,
      sourceLabel: source.label,
      sourceHref: source.href,
      description,
      origin: "expense" as const,
      reference,
      paymentMethod: null,
      paymentMethodLabel: null,
      paymentStatus: normalizePaymentStatus(row.payment_status),
      recordedByName: typeof row.recorded_by === "string" ? recordedByNames[row.recorded_by] ?? null : null,
      customerId: linkedOrder?.customer_id ?? linkedProject?.customer_id ?? null,
      searchText: [description, source.label, reference ?? "", row.notes ?? "",
        row.category ?? "", getBusinessDomainLabel(businessDomain),
        typeof row.recorded_by === "string" ? recordedByNames[row.recorded_by] ?? "" : ""]
        .join(" ").toLowerCase(),
      expenseId: row.id,
      expenseCategory: row.category?.trim() || null,
      expenseDescriptionRaw: row.description?.trim() || null,
      expenseNotes: row.notes?.trim() || null,
      expenseProjectId: resolvedProjectId,
      expenseOrderId: row.order_id,
      expensePropertyId: row.property_id,
      expensePaidAmount: row.paid_amount != null ? Math.abs(toNumber(row.paid_amount)) : null,
      expensePaymentMethod: typeof row.payment_method === "string" ? row.payment_method.trim() || null : null,
      expensePaidDate: normalizeDate(row.paid_date),
      expenseAccountId: typeof row.account_id === "string" ? row.account_id : null,
    }];
  });
}

/**
 * Loan cash movements → financial entries. Principal (received / repaid) carries
 * cash but NOT P&L (origin "loan" is ignored by aggregateProfitLoss). The interest
 * portion of each repayment is emitted separately as an expense (loan taken) or
 * income (loan given) so it — and only it — flows into the P&L.
 *
 *   taken  : principal received = inflow;  repayment = outflow; interest = expense
 *   given  : principal lent     = outflow; repayment = inflow;  interest = income
 */
export function buildLoanEntries(loans: Loan[], referenceDate: string): FinancialEntry[] {
  const entries: FinancialEntry[] = [];

  const stageFor = (flowDate: string): FinancialEntryStage =>
    flowDate <= referenceDate ? "posted" : "scheduled";

  for (const loan of loans) {
    if (!loan.id) continue;
    const businessDomain = normalizeDomain(loan.business_domain);
    const domainName = getBusinessDomainLabel(businessDomain);
    const taken = loan.direction === "taken";
    const counterparty = (taken ? loan.lender : loan.borrower)?.trim() || null;

    // ── Principal: the loan event itself ──
    if (loan.amount > 0 && loan.loan_date) {
      const type: FinancialEntryType = taken ? "inflow" : "outflow";
      const description = taken
        ? `הלוואה שהתקבלה${counterparty ? ` מ-${counterparty}` : ""}`
        : `הלוואה שניתנה${counterparty ? ` ל-${counterparty}` : ""}`;
      entries.push({
        id: `loan:${loan.id}`,
        type,
        amount: loan.amount,
        signedAmount: type === "inflow" ? loan.amount : -loan.amount,
        businessDomain,
        domainName,
        flowDate: loan.loan_date,
        recordedDate: loan.loan_date,
        dueDate: loan.due_date,
        stage: stageFor(loan.loan_date),
        sourceKind: "general",
        sourceId: loan.id,
        sourceLabel: description,
        sourceHref: "/financial/loans",
        description,
        origin: "loan",
        reference: null,
        paymentMethod: loan.loan_method,
        paymentMethodLabel: loan.loan_method ? paymentMethodLabel(loan.loan_method) : null,
        paymentStatus: null,
        recordedByName: null,
        customerId: loan.counterparty_customer_id,
        searchText: [description, counterparty ?? "", loan.notes ?? "", domainName]
          .join(" ")
          .toLowerCase(),
      });
    }

    // ── Repayments: principal (cash only) + interest (P&L) ──
    for (const repayment of loan.repayments) {
      if (!repayment.id || !repayment.repayment_date) continue;
      const principalPart = Math.max(repayment.amount - repayment.interest_amount, 0);
      const interestPart = Math.max(repayment.interest_amount, 0);
      const stage = stageFor(repayment.repayment_date);

      if (principalPart > 0) {
        const type: FinancialEntryType = taken ? "outflow" : "inflow";
        const description = `החזר הלוואה${counterparty ? ` (${counterparty})` : ""}`;
        entries.push({
          id: `loan_repay:${repayment.id}`,
          type,
          amount: principalPart,
          signedAmount: type === "inflow" ? principalPart : -principalPart,
          businessDomain,
          domainName,
          flowDate: repayment.repayment_date,
          recordedDate: repayment.repayment_date,
          dueDate: null,
          stage,
          sourceKind: "general",
          sourceId: loan.id,
          sourceLabel: description,
          sourceHref: "/financial/loans",
          description,
          origin: "loan",
          reference: null,
          paymentMethod: repayment.method,
          paymentMethodLabel: repayment.method ? paymentMethodLabel(repayment.method) : null,
          paymentStatus: null,
          recordedByName: null,
          customerId: loan.counterparty_customer_id,
          searchText: [description, counterparty ?? "", domainName].join(" ").toLowerCase(),
        });
      }

      if (interestPart > 0) {
        // Interest paid (taken) is an expense; interest received (given) is income.
        const type: FinancialEntryType = taken ? "outflow" : "inflow";
        const origin = taken ? "expense" : "payment";
        const description = `ריבית הלוואה${counterparty ? ` (${counterparty})` : ""}`;
        entries.push({
          id: `loan_interest:${repayment.id}`,
          type,
          amount: interestPart,
          signedAmount: type === "inflow" ? interestPart : -interestPart,
          businessDomain,
          domainName,
          flowDate: repayment.repayment_date,
          recordedDate: repayment.repayment_date,
          dueDate: null,
          stage,
          sourceKind: "general",
          sourceId: loan.id,
          sourceLabel: description,
          sourceHref: "/financial/loans",
          description,
          origin,
          reference: "ריבית",
          paymentMethod: repayment.method,
          paymentMethodLabel: repayment.method ? paymentMethodLabel(repayment.method) : null,
          paymentStatus: origin === "expense" ? "paid" : null,
          recordedByName: null,
          customerId: loan.counterparty_customer_id,
          searchText: [description, counterparty ?? "", domainName].join(" ").toLowerCase(),
          ...(origin === "expense"
            ? { expenseCategory: "ריבית הלוואה", expensePaidAmount: interestPart }
            : {}),
        });
      }
    }
  }

  return entries;
}

export function buildWorkerPaymentEntries(args: {
  allocations: WorkerPaymentAllocationRow[];
  workerPaymentById: Map<string, WorkerPaymentRow>;
  sessionsById: Map<string, AttendanceSessionFinanceRow>;
  projectsById: Map<string, ProjectRow>;
  propertiesById: Map<string, PropertyRow>;
  propertyCustomersById: Map<string, Set<string>>;
  recordedByNames: Record<string, string>;
  customerId: string | null;
  customerProjectSet: Set<string>;
  referenceDate: string;
}): FinancialEntry[] {
  const { allocations, workerPaymentById, sessionsById, projectsById, propertiesById, propertyCustomersById, recordedByNames, customerId, customerProjectSet, referenceDate } = args;

  return allocations.flatMap((allocation) => {
    if (!allocation.id || !allocation.worker_payment_id) return [];
    const workerPayment = workerPaymentById.get(allocation.worker_payment_id);
    if (!workerPayment?.id) return [];

    const flowMeta = buildWorkerPaymentFlowMeta(workerPayment.payment_date, referenceDate);
    if (!flowMeta) return [];

    const session =
      allocation.source_type === "session" && allocation.attendance_session_id
        ? sessionsById.get(allocation.attendance_session_id) ?? null
        : null;
    const businessDomain = session?.business_domain ? normalizeDomain(session.business_domain) : "general_business";
    const linkedProject = session?.project_id ? projectsById.get(session.project_id) ?? null : null;
    const linkedProperty = session?.property_id ? propertiesById.get(session.property_id) ?? null : null;
    const propertyCustomers = session?.property_id ? propertyCustomersById.get(session.property_id) ?? null : null;

    if (!matchesCustomerFilter({
      customerId, customerProjectIds: customerProjectSet,
      projectId: session?.project_id ?? null, orderCustomerId: null,
      propertyCustomerIds: propertyCustomers, projectCustomerId: linkedProject?.customer_id ?? null,
    })) return [];

    const amount = Math.abs(toNumber(allocation.amount));
    if (!(amount > 0)) return [];

    const source = buildSource({
      businessDomain, projectId: session?.project_id ?? null, orderId: null, propertyId: session?.property_id ?? null,
      projectName: linkedProject?.name?.trim() || null, propertyAddress: linkedProperty?.address?.trim() || null,
    });
    const workerName =
      (workerPayment.user_id && recordedByNames[workerPayment.user_id]) ||
      (session?.user_id && recordedByNames[session.user_id]) ||
      null;
    const description = buildWorkerPaymentDescription(workerName);
    const reference = workerPayment.reference_number?.trim() || null;
    const paymentMethodValue = workerPayment.payment_method?.trim() || null;

    return [{
      id: `worker-payment-allocation:${allocation.id}`,
      type: "outflow" as const,
      amount,
      signedAmount: -amount,
      businessDomain,
      domainName: getBusinessDomainLabel(businessDomain),
      flowDate: flowMeta.flowDate,
      recordedDate: flowMeta.recordedDate,
      dueDate: null,
      stage: flowMeta.stage,
      sourceKind: source.kind,
      sourceId: source.id,
      sourceLabel: source.label,
      sourceHref: source.href,
      description,
      origin: "worker_payment" as const,
      reference,
      paymentMethod: paymentMethodValue,
      paymentMethodLabel: paymentMethodValue ? paymentMethodLabel(paymentMethodValue) : null,
      paymentStatus: null,
      recordedByName: typeof workerPayment.recorded_by === "string" ? recordedByNames[workerPayment.recorded_by] ?? null : null,
      customerId: linkedProject?.customer_id ?? null,
      searchText: [description, source.label, reference ?? "", workerPayment.notes ?? "", paymentMethodValue ?? "",
        workerName ?? "", getBusinessDomainLabel(businessDomain),
        typeof workerPayment.recorded_by === "string" ? recordedByNames[workerPayment.recorded_by] ?? "" : ""]
        .join(" ").toLowerCase(),
    }];
  });
}

export function buildWorkerOwedEntries(args: {
  debtItems: WorkerDebtItemRow[];
  sessionsById: Map<string, AttendanceSessionFinanceRow>;
  projectsById: Map<string, ProjectRow>;
  propertiesById: Map<string, PropertyRow>;
  propertyCustomersById: Map<string, Set<string>>;
  recordedByNames: Record<string, string>;
  customerId: string | null;
  customerProjectSet: Set<string>;
  referenceDate: string;
}): FinancialEntry[] {
  const { debtItems, sessionsById, projectsById, propertiesById, propertyCustomersById, recordedByNames, customerId, customerProjectSet, referenceDate } = args;

  return debtItems.flatMap((item, index) => {
    const amount = Math.max(0, toNumber(item.owed_amount));
    if (!(amount > 0)) return [];

    const sourceType = item.source_type?.trim().toLowerCase() ?? "";
    const session =
      sourceType === "session" && item.source_id
        ? sessionsById.get(item.source_id) ?? null
        : null;
    const projectId = item.project_id ?? session?.project_id ?? null;
    const propertyId = session?.property_id ?? null;
    const businessDomain = session?.business_domain ? normalizeDomain(session.business_domain) : "general_business";
    const linkedProject = projectId ? projectsById.get(projectId) ?? null : null;
    const linkedProperty = propertyId ? propertiesById.get(propertyId) ?? null : null;
    const propertyCustomers = propertyId ? propertyCustomersById.get(propertyId) ?? null : null;

    if (!matchesCustomerFilter({
      customerId,
      customerProjectIds: customerProjectSet,
      projectId,
      orderCustomerId: null,
      propertyCustomerIds: propertyCustomers,
      projectCustomerId: linkedProject?.customer_id ?? null,
    })) return [];

    const flowMeta = buildWorkerDebtItemFlowMeta({
      sourceDate: item.source_date ?? session?.clock_in ?? null,
      dueDate: item.due_date,
      sourceType: item.source_type,
      referenceDate,
    });
    const source = buildSource({
      businessDomain,
      projectId,
      orderId: null,
      propertyId,
      projectName: linkedProject?.name?.trim() || null,
      propertyAddress: linkedProperty?.address?.trim() || null,
    });
    const workerId = item.user_id?.trim() || session?.user_id?.trim() || "";
    const workerName = workerId ? recordedByNames[workerId] ?? null : null;
    const description =
      sourceType === "payslip" && item.period_month
        ? `${buildWorkerPaymentDescription(workerName)} • ${item.period_month}`
        : buildWorkerPaymentDescription(workerName);
    const reference = sourceType === "payslip" ? "יתרה לתשלום • תלוש שכר" : "יתרה לתשלום";

    return [{
      id: `worker-owed:${sourceType || "unknown"}:${item.source_id || String(index)}`,
      type: "outflow" as const,
      amount,
      signedAmount: -amount,
      businessDomain,
      domainName: getBusinessDomainLabel(businessDomain),
      flowDate: flowMeta.flowDate,
      recordedDate: flowMeta.recordedDate,
      dueDate: flowMeta.dueDate,
      stage: flowMeta.stage,
      sourceKind: source.kind,
      sourceId: source.id,
      sourceLabel: source.label,
      sourceHref: source.href,
      description,
      origin: "worker_owed" as const,
      reference,
      paymentMethod: null,
      paymentMethodLabel: null,
      paymentStatus: normalizePaymentStatus(item.payment_status),
      recordedByName: null,
      customerId: linkedProject?.customer_id ?? null,
      searchText: [description, source.label, reference, workerName ?? "", getBusinessDomainLabel(businessDomain)]
        .join(" ").toLowerCase(),
    } as FinancialEntry];
  });
}

export function buildProjectReceivableEntries(args: {
  projectRows: ProjectRow[];
  projectsById: Map<string, ProjectRow>;
  projectFinancialsById: Map<string, ProjectFinancialRow>;
  paidByProjectId: Map<string, number>;
  pendingByProjectId: Map<string, number>;
  customerId: string | null;
  customerProjectSet: Set<string>;
  referenceDate: string;
}): FinancialEntry[] {
  const { projectRows, projectsById, projectFinancialsById, paidByProjectId, pendingByProjectId, customerId, customerProjectSet, referenceDate } = args;

  return projectRows.flatMap((project) => {
    if (!project.id) return [];
    if (isExcludedProjectStatus(project.status)) return [];

    const linkedProject = projectsById.get(project.id) ?? project;
    if (!matchesCustomerFilter({
      customerId, customerProjectIds: customerProjectSet,
      projectId: project.id, orderCustomerId: null,
      propertyCustomerIds: null, projectCustomerId: linkedProject.customer_id ?? null,
    })) return [];

    const financialRow = projectFinancialsById.get(project.id) ?? null;
    const actualPrice = toNumber(linkedProject.actual_price);
    const agreedBasePrice = toNumber(linkedProject.agreed_base_price);
    const expensesBilled = Math.max(0, toNumber(financialRow?.expenses_billed));
    const fallbackTotal = (actualPrice > 0 ? actualPrice : agreedBasePrice > 0 ? agreedBasePrice : 0) + expensesBilled;
    const customerTotalPrice = Math.max(toNumber(financialRow?.customer_total_price), fallbackTotal);
    const paidAmount = paidByProjectId.get(project.id) ?? 0;
    // Exclude money already represented by scheduled (pending) payment entries.
    const pendingAmount = pendingByProjectId.get(project.id) ?? 0;
    const amount = Math.max(customerTotalPrice - paidAmount - pendingAmount, 0);
    if (!(amount > 0)) return [];

    const isOpenDebt = isClosedProjectStatus(linkedProject.status);
    const flowMeta = isOpenDebt
      ? buildReceivableFlowMeta(linkedProject.end_date ?? linkedProject.created_at, referenceDate)
      : buildPlannedReceivableFlowMeta([linkedProject.end_date, linkedProject.start_date, linkedProject.created_at], referenceDate);
    const source = buildSource({
      businessDomain: "logistics_projects", projectId: project.id, orderId: null, propertyId: null,
      projectName: linkedProject.name?.trim() || null, propertyAddress: null,
    });
    const description = isOpenDebt ? "יתרת לקוח לתשלום" : "הכנסה מתוכננת מלקוח";

    return [{
      id: `project-receivable:${project.id}`,
      type: "inflow" as const,
      amount,
      signedAmount: amount,
      businessDomain: "logistics_projects" as const,
      domainName: getBusinessDomainLabel("logistics_projects"),
      flowDate: flowMeta.flowDate,
      recordedDate: flowMeta.recordedDate,
      dueDate: flowMeta.dueDate,
      stage: flowMeta.stage,
      sourceKind: source.kind,
      sourceId: source.id,
      sourceLabel: source.label,
      sourceHref: source.href,
      description,
      origin: "project_receivable" as const,
      reference: null,
      paymentMethod: null,
      paymentMethodLabel: null,
      paymentStatus: isOpenDebt ? "pending" : "scheduled",
      recordedByName: null,
      customerId: linkedProject.customer_id ?? null,
      searchText: [description, source.label, getBusinessDomainLabel("logistics_projects")].join(" ").toLowerCase(),
    }];
  });
}

export function buildOrderReceivableEntries(args: {
  orderRows: OrderRow[];
  ordersById: Map<string, OrderRow>;
  orderFinancialsById: Map<string, OrderFinancialRow>;
  paidByOrderId: Map<string, number>;
  pendingByOrderId: Map<string, number>;
  customerId: string | null;
  customerProjectSet: Set<string>;
  referenceDate: string;
}): FinancialEntry[] {
  const { orderRows, ordersById, orderFinancialsById, paidByOrderId, pendingByOrderId, customerId, customerProjectSet, referenceDate } = args;

  return orderRows.flatMap((order) => {
    if (!order.id) return [];
    if (isExcludedOrderStatus(order.status)) return [];

    const linkedOrder = ordersById.get(order.id) ?? order;
    if (!matchesCustomerFilter({
      customerId, customerProjectIds: customerProjectSet,
      projectId: null, orderCustomerId: linkedOrder.customer_id ?? null,
      propertyCustomerIds: null, projectCustomerId: null,
    })) return [];

    const financialRow = orderFinancialsById.get(order.id) ?? null;
    const totalAmount = Math.max(0, toNumber(financialRow?.total_amount) || toNumber(linkedOrder.total_amount));
    const totalPaid = Math.max(0, toNumber(financialRow?.total_paid), paidByOrderId.get(order.id) ?? 0);
    const normalizedOrderPaymentStatus = normalizePaymentStatus(financialRow?.payment_status ?? linkedOrder.payment_status);
    const hasExplicitRemaining = financialRow?.remaining_balance !== null && financialRow?.remaining_balance !== undefined;
    const explicitRemainingBalance = Math.max(0, toNumber(financialRow?.remaining_balance));
    const derivedRemainingBalance = totalAmount > 0 ? Math.max(totalAmount - totalPaid, 0) : 0;
    const remainingBalance =
      normalizedOrderPaymentStatus === "paid" || normalizedOrderPaymentStatus === "cleared"
        ? 0
        : hasExplicitRemaining ? explicitRemainingBalance : derivedRemainingBalance;
    // Exclude money already represented by scheduled (pending) payment entries.
    const pendingAmount = pendingByOrderId.get(order.id) ?? 0;
    const receivableAmount = Math.max(remainingBalance - pendingAmount, 0);
    if (!(receivableAmount > 0)) return [];

    const isOpenDebt = isClosedOrderStatus(linkedOrder.status);
    const flowMeta = isOpenDebt
      ? buildReceivableFlowMeta(linkedOrder.order_date, referenceDate)
      : buildPlannedReceivableFlowMeta([linkedOrder.order_date], referenceDate);
    const source = buildSource({
      businessDomain: "sales", projectId: null, orderId: order.id, propertyId: null,
      projectName: null, propertyAddress: null,
    });
    const description = isOpenDebt ? "יתרת לקוח לתשלום" : "הכנסה מתוכננת מלקוח";

    return [{
      id: `order-receivable:${order.id}`,
      type: "inflow" as const,
      amount: receivableAmount,
      signedAmount: receivableAmount,
      businessDomain: "sales" as const,
      domainName: getBusinessDomainLabel("sales"),
      flowDate: flowMeta.flowDate,
      recordedDate: flowMeta.recordedDate,
      dueDate: flowMeta.dueDate,
      stage: flowMeta.stage,
      sourceKind: source.kind,
      sourceId: source.id,
      sourceLabel: source.label,
      sourceHref: source.href,
      description,
      origin: "order_receivable" as const,
      reference: null,
      paymentMethod: null,
      paymentMethodLabel: null,
      paymentStatus: isOpenDebt ? normalizedOrderPaymentStatus ?? "pending" : "scheduled",
      recordedByName: null,
      customerId: linkedOrder.customer_id ?? null,
      searchText: [description, source.label, getBusinessDomainLabel("sales")].join(" ").toLowerCase(),
    }];
  });
}
