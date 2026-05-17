import { getBusinessDomainLabel } from "@/lib/expenses";
import { paymentMethodLabel } from "@/lib/orders/paymentStatus";
import type { ExpenseBusinessDomain } from "@/lib/expenses";
import type {
  AttendanceSessionFinanceRow,
  ExpenseRow,
  FinancialDomainGroup,
  FinancialEntry,
  FinancialEntryOrigin,
  FinancialEntryStage,
  FinancialEntryType,
  FinancialSourceKind,
  FinancialSummary,
  OrderFinancialRow,
  OrderRow,
  PaymentRow,
  ProjectFinancialRow,
  ProjectRow,
  PropertyRow,
  SalaryAgreementLiteRow,
  WorkerPaymentAllocationRow,
  WorkerPaymentRow,
  WorkerUserRow,
} from "./types";
import {
  isFutureEntry,
  monthKeyFromIso,
  nextMonthDueDate,
  normalizeDate,
  normalizePaymentMethod,
  normalizePaymentStatus,
  normalizeStatusValue,
  normalizeDomain,
  recurringExpenseClampedDate,
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
  const flowDate = isCheck && dueDate ? dueDate : paymentDate;
  if (!flowDate) return null;

  const stage: FinancialEntryStage =
    isCheck && status !== "cleared"
      ? flowDate > referenceDate ? "scheduled" : "pending"
      : flowDate > referenceDate ? "scheduled" : "posted";

  return { flowDate, paymentDate, dueDate, stage, method, status };
}

export function buildExpenseFlowMeta(row: ExpenseRow, referenceDate: string) {
  const expenseDate = normalizeDate(row.expense_date);
  if (!expenseDate) return null;
  return {
    flowDate: expenseDate,
    recordedDate: expenseDate,
    stage: expenseDate > referenceDate ? ("scheduled" as const) : ("posted" as const),
  };
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
    return { kind: "general" as const, id: null, label: "פעילות נכסים כללית", href: null };
  }
  if (businessDomain === "sales") {
    return { kind: "general" as const, id: null, label: "פעילות מכירות כללית", href: null };
  }
  return { kind: "general" as const, id: null, label: "פעילות כללית", href: null };
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

function isAgreementActiveOnDate(
  agreement: SalaryAgreementLiteRow,
  referenceDateValue: string | null | undefined
) {
  const userId = agreement.user_id?.trim();
  const validFrom = normalizeDate(agreement.valid_from);
  if (!userId || !validFrom) return false;
  const point = normalizeDate(referenceDateValue) ?? todayIso();
  if (validFrom > point) return false;
  const validTo = normalizeDate(agreement.valid_to);
  if (validTo && validTo < point) return false;
  return true;
}

export function shouldAggregateWorkerDebt(args: {
  worker: WorkerUserRow | null;
  agreements: SalaryAgreementLiteRow[];
  sessionDate: string | null | undefined;
}) {
  const trackingMode = args.worker?.pay_tracking_mode?.trim().toLowerCase() ?? "";
  if (trackingMode === "payslip") return true;
  return args.agreements.some(
    (agreement) =>
      agreement.salary_type?.trim().toLowerCase() === "hourly" &&
      isAgreementActiveOnDate(agreement, args.sessionDate)
  );
}

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

    const amount = Math.abs(toNumber(row.amount_total));
    const source = buildSource({
      businessDomain, projectId: links.projectId, orderId: links.orderId, propertyId: links.propertyId,
      projectName: linkedProject?.name?.trim() || null, propertyAddress: linkedProperty?.address?.trim() || null,
    });
    const description = buildPaymentDescription(row);
    const reference = row.reference_number?.trim() || null;
    const paymentMethodValue = row.payment_method?.trim() || null;

    return [{
      id: `payment:${row.id}`,
      type: "inflow" as const,
      amount,
      signedAmount: amount,
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
    const paymentMethodValue = row.payment_method?.trim() || null;

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
      paymentMethod: paymentMethodValue,
      paymentMethodLabel: paymentMethodValue ? paymentMethodLabel(paymentMethodValue) : null,
      paymentStatus: null,
      recordedByName: typeof row.recorded_by === "string" ? recordedByNames[row.recorded_by] ?? null : null,
      customerId: linkedOrder?.customer_id ?? linkedProject?.customer_id ?? null,
      searchText: [description, source.label, reference ?? "", row.notes ?? "", row.payment_method ?? "",
        row.category ?? "", getBusinessDomainLabel(businessDomain),
        typeof row.recorded_by === "string" ? recordedByNames[row.recorded_by] ?? "" : ""]
        .join(" ").toLowerCase(),
      expenseId: row.id,
      expenseCategory: row.category?.trim() || null,
      expenseDescriptionRaw: row.description?.trim() || null,
      expenseNotes: row.notes?.trim() || null,
      expensePaymentMethod: paymentMethodValue,
      expenseProjectId: resolvedProjectId,
      expenseOrderId: row.order_id,
      expensePropertyId: row.property_id,
    }];
  });
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
  attendanceSessionRows: AttendanceSessionFinanceRow[];
  sessionsById: Map<string, AttendanceSessionFinanceRow>;
  allocations: WorkerPaymentAllocationRow[];
  workerUsersById: Map<string, WorkerUserRow>;
  salaryAgreementsByUserId: Map<string, SalaryAgreementLiteRow[]>;
  projectsById: Map<string, ProjectRow>;
  propertiesById: Map<string, PropertyRow>;
  propertyCustomersById: Map<string, Set<string>>;
  recordedByNames: Record<string, string>;
  customerId: string | null;
  customerProjectSet: Set<string>;
  referenceDate: string;
}): FinancialEntry[] {
  const { attendanceSessionRows, sessionsById, allocations, workerUsersById, salaryAgreementsByUserId, projectsById, propertiesById, propertyCustomersById, recordedByNames, customerId, customerProjectSet, referenceDate } = args;

  const paidWorkerAmountBySessionId = allocations.reduce((map, allocation) => {
    if (allocation.source_type !== "session" || !allocation.attendance_session_id) return map;
    const amount = Math.abs(toNumber(allocation.amount));
    if (!(amount > 0)) return map;
    map.set(allocation.attendance_session_id, (map.get(allocation.attendance_session_id) ?? 0) + amount);
    return map;
  }, new Map<string, number>());

  const rawEntries = attendanceSessionRows.flatMap((session) => {
    if (!session.id) return [];

    const businessDomain = session.business_domain ? normalizeDomain(session.business_domain) : "general_business";
    const linkedProject = session.project_id ? projectsById.get(session.project_id) ?? null : null;
    const linkedProperty = session.property_id ? propertiesById.get(session.property_id) ?? null : null;
    const propertyCustomers = session.property_id ? propertyCustomersById.get(session.property_id) ?? null : null;

    if (!matchesCustomerFilter({
      customerId, customerProjectIds: customerProjectSet,
      projectId: session.project_id ?? null, orderCustomerId: null,
      propertyCustomerIds: propertyCustomers, projectCustomerId: linkedProject?.customer_id ?? null,
    })) return [];

    const laborCost = Math.max(0, toNumber(session.labor_cost));
    const explicitPaidAmount = Math.max(0, toNumber(session.paid_amount));
    const allocatedPaidAmount = paidWorkerAmountBySessionId.get(session.id) ?? 0;
    const effectivePaidAmount = Math.max(explicitPaidAmount, allocatedPaidAmount);
    const explicitOwedAmount = Math.max(0, toNumber(session.owed_amount));
    const computedOwedAmount = laborCost > 0 ? Math.max(laborCost - effectivePaidAmount, 0) : 0;
    const amount =
      laborCost > 0 && effectivePaidAmount + 0.009 >= laborCost ? 0
        : explicitOwedAmount > 0 ? explicitOwedAmount
        : computedOwedAmount;

    if (!(amount > 0)) return [];

    const flowMeta = buildWorkerOwedFlowMeta(session.clock_in);
    const source = buildSource({
      businessDomain, projectId: session.project_id ?? null, orderId: null, propertyId: session.property_id ?? null,
      projectName: linkedProject?.name?.trim() || null, propertyAddress: linkedProperty?.address?.trim() || null,
    });
    const workerName = session.user_id ? recordedByNames[session.user_id] ?? null : null;
    const description = buildWorkerPaymentDescription(workerName);

    return [{
      id: `worker-owed-session:${session.id}`,
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
      reference: "יתרה לתשלום",
      paymentMethod: null,
      paymentMethodLabel: null,
      paymentStatus: normalizePaymentStatus(session.payment_status),
      recordedByName: null,
      customerId: linkedProject?.customer_id ?? null,
      searchText: [description, source.label, "יתרה לתשלום", workerName ?? "", getBusinessDomainLabel(businessDomain)]
        .join(" ").toLowerCase(),
    } as FinancialEntry];
  });

  const aggregatedMap = new Map<string, FinancialEntry>();
  const directEntries: FinancialEntry[] = rawEntries.flatMap((entry) => {
    const sessionId = entry.id.replace("worker-owed-session:", "");
    const session = sessionsById.get(sessionId) ?? null;
    const workerId = session?.user_id?.trim() ?? "";
    const worker = workerId ? workerUsersById.get(workerId) ?? null : null;
    const agreements = workerId ? salaryAgreementsByUserId.get(workerId) ?? [] : [];
    const shouldAggregate = shouldAggregateWorkerDebt({ worker, agreements, sessionDate: session?.clock_in ?? null });

    if (!shouldAggregate || !workerId) return [entry];

    const workerName = recordedByNames[workerId] ?? null;
    const monthKey = monthKeyFromIso(session?.clock_in ?? null);
    const monthlyFlowMeta = buildMonthlyWorkerOwedFlowMeta(session?.clock_in ?? null, referenceDate);
    const key = `worker-owed-user:${workerId}:${monthKey || "unknown"}`;
    const existing = aggregatedMap.get(key);

    if (!existing) {
      aggregatedMap.set(key, {
        ...entry,
        id: key,
        flowDate: monthlyFlowMeta.flowDate,
        dueDate: monthlyFlowMeta.dueDate,
        stage: monthlyFlowMeta.stage,
        sourceKind: "general",
        sourceId: null,
        sourceLabel: "שכר עובדים",
        sourceHref: null,
        description: monthKey
          ? `${buildWorkerPaymentDescription(workerName)} • ${monthKey}`
          : buildWorkerPaymentDescription(workerName),
        searchText: [
          monthKey ? `${buildWorkerPaymentDescription(workerName)} ${monthKey}` : buildWorkerPaymentDescription(workerName),
          "יתרה לתשלום", "שכר עובדים", workerName ?? "", entry.domainName,
        ].join(" ").toLowerCase(),
      });
      return [];
    }

    existing.amount += entry.amount;
    existing.signedAmount -= entry.amount;
    existing.recordedDate =
      existing.recordedDate && entry.recordedDate
        ? entry.recordedDate < existing.recordedDate ? entry.recordedDate : existing.recordedDate
        : existing.recordedDate ?? entry.recordedDate;
    return [];
  });

  return [...directEntries, ...aggregatedMap.values()];
}

export function buildProjectReceivableEntries(args: {
  projectRows: ProjectRow[];
  projectsById: Map<string, ProjectRow>;
  projectFinancialsById: Map<string, ProjectFinancialRow>;
  paidByProjectId: Map<string, number>;
  customerId: string | null;
  customerProjectSet: Set<string>;
  referenceDate: string;
}): FinancialEntry[] {
  const { projectRows, projectsById, projectFinancialsById, paidByProjectId, customerId, customerProjectSet, referenceDate } = args;

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
    const amount = Math.max(customerTotalPrice - paidAmount, 0);
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
  customerId: string | null;
  customerProjectSet: Set<string>;
  referenceDate: string;
}): FinancialEntry[] {
  const { orderRows, ordersById, orderFinancialsById, paidByOrderId, customerId, customerProjectSet, referenceDate } = args;

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
    if (!(remainingBalance > 0)) return [];

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
      amount: remainingBalance,
      signedAmount: remainingBalance,
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
