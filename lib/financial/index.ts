import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveUserDisplayNamesForValues } from "@/lib/audit";
import { getBusinessDomainLabel, type ExpenseBusinessDomain } from "@/lib/expenses";
import {
  fetchOrderFinancialsByIds,
  fetchOrdersByIds,
  fetchProjectExpenseLinksByExpenseIds,
  fetchProjectFinancialsByIds,
  fetchProjectsByIds,
  fetchPropertyCustomerLinks,
  fetchPropertiesByIds,
  fetchWorkerPaymentAllocationsByPaymentIds,
  resolveCustomerProjectIds,
  scanAttendanceSessionRows,
  scanWorkerDebtItemRows,
  scanExpenseRows,
  scanOrderRows,
  scanPaymentRows,
  scanProjectRows,
  scanWorkerPaymentRows,
} from "./db";
import {
  buildDomainGroups,
  buildExpenseEntries,
  buildOrderReceivableEntries,
  buildPaymentEntries,
  buildProjectReceivableEntries,
  buildWorkerOwedEntries,
  buildWorkerPaymentEntries,
  matchesEntryFilters,
  paginateEntries,
  resolvePaymentLinks,
  sortEntries,
  summarizeEntries,
} from "./entries";
import {
  UPCOMING_PAGE_SIZE,
  type FinancialPageData,
  type FinancialPageFilters,
} from "./types";
import {
  addDaysToIso,
  domainToSourceKind,
  isFutureEntry,
  isPermissionDeniedError,
  normalizeCustomerId,
  normalizeDate,
  normalizeDomain,
  normalizePositiveInteger,
  normalizeText,
  todayIso,
  toNumber,
  uniqueStrings,
} from "./utils";
import { isCollectedPayment } from "@/lib/orders/paymentStatus";

// Re-export all public types so existing imports like:
//   import type { FinancialEntry, FinancialPageData } from "@/lib/financial"
// continue to work unchanged.
export type {
  FinancialDomainGroup,
  FinancialEntry,
  FinancialEntryOrigin,
  FinancialEntryStage,
  FinancialEntryType,
  FinancialPageData,
  FinancialPageFilters,
  FinancialSourceKind,
  FinancialSummary,
} from "./types";

export async function getFinancialPageData(
  supabase: SupabaseClient,
  filters: FinancialPageFilters = {}
): Promise<FinancialPageData> {
  const customerId = normalizeCustomerId(filters.customerId);
  const referenceDate = todayIso();
  const from = normalizeDate(filters.from);
  const to = normalizeDate(filters.to);
  // Default scan window: when no explicit from-filter, only scan the last 13 months.
  // This avoids reading all-time data on every page load.
  const scanSince: string = from ?? (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 13);
    return d.toISOString().slice(0, 10);
  })();
  const domain = normalizeDomain(filters.domain);
  const sourceId = normalizeCustomerId(filters.sourceId);
  const type = filters.type === "inflow" || filters.type === "outflow" ? filters.type : null;
  const stage =
    filters.stage === "actual" || filters.stage === "future" || filters.stage === "pending"
      ? filters.stage
      : null;
  const query = normalizeText(filters.q);
  const upcomingPage = normalizePositiveInteger(filters.upcomingPage, 1);
  const customerProjectIds = await resolveCustomerProjectIds(supabase, customerId);
  const customerProjectSet = new Set(customerProjectIds);

  const [paymentRows, expenseRows, workerPaymentsResult, projectRows, orderRows] = await Promise.all([
    scanPaymentRows(supabase, scanSince),
    scanExpenseRows(supabase, scanSince),
    (async () => {
      try {
        const [workerPaymentRows, attendanceSessionRows, workerDebtItemRows] = await Promise.all([
          scanWorkerPaymentRows(supabase, scanSince),
          scanAttendanceSessionRows(supabase, scanSince),
          scanWorkerDebtItemRows(supabase, scanSince),
        ]);
        const workerPaymentIds = workerPaymentRows.map((row) => row.id);
        const allocations = await fetchWorkerPaymentAllocationsByPaymentIds(supabase, workerPaymentIds);
        const sessionsById = new Map(
          attendanceSessionRows
            .filter((row) => row.id)
            .map((row) => [row.id, row] as const)
        );
        return { workerPaymentRows, allocations, attendanceSessionRows, workerDebtItemRows, sessionsById };
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          return {
            workerPaymentRows: [],
            allocations: [],
            attendanceSessionRows: [],
            workerDebtItemRows: [],
            sessionsById: new Map(),
          };
        }
        throw error;
      }
    })(),
    scanProjectRows(supabase, scanSince),
    scanOrderRows(supabase, scanSince),
  ]);

  const paymentLinks = paymentRows.map(resolvePaymentLinks);
  const projectExpenseLinksByExpenseId = await fetchProjectExpenseLinksByExpenseIds(
    supabase,
    expenseRows.map((row) => row.id)
  );
  const workerPaymentById = new Map(
    workerPaymentsResult.workerPaymentRows
      .filter((row) => row.id)
      .map((row) => [row.id, row] as const)
  );
  const projectIds = uniqueStrings([
    ...projectRows.map((row) => row.id),
    ...paymentLinks.map((row) => row.projectId),
    ...expenseRows.map((row) => row.project_id || projectExpenseLinksByExpenseId.get(row.id) || null),
    ...workerPaymentsResult.attendanceSessionRows.map((row) => row.project_id),
    ...workerPaymentsResult.workerDebtItemRows.map((row) => row.project_id),
  ]);
  const orderIds = uniqueStrings([
    ...orderRows.map((row) => row.id),
    ...paymentLinks.map((row) => row.orderId),
    ...expenseRows.map((row) => row.order_id),
  ]);
  const propertyIds = uniqueStrings([
    ...paymentLinks.map((row) => row.propertyId),
    ...expenseRows.map((row) => row.property_id),
    ...workerPaymentsResult.attendanceSessionRows.map((row) => row.property_id),
  ]);
  const recordedByValues = uniqueStrings([
    ...paymentRows.map((row) => row.recorded_by),
    ...expenseRows.map((row) => row.recorded_by),
    ...workerPaymentsResult.workerPaymentRows.map((row) => row.recorded_by),
    ...workerPaymentsResult.workerPaymentRows.map((row) => row.user_id),
    ...workerPaymentsResult.attendanceSessionRows.map((row) => row.user_id),
    ...workerPaymentsResult.workerDebtItemRows.map((row) => row.user_id),
  ]);

  const [
    projectsById,
    projectFinancialsById,
    ordersById,
    orderFinancialsById,
    propertiesById,
    propertyCustomersById,
    recordedByNames,
  ] = await Promise.all([
    fetchProjectsByIds(supabase, projectIds),
    fetchProjectFinancialsByIds(supabase, projectIds),
    fetchOrdersByIds(supabase, orderIds),
    fetchOrderFinancialsByIds(supabase, orderIds),
    fetchPropertiesByIds(supabase, propertyIds),
    fetchPropertyCustomerLinks(supabase, propertyIds),
    resolveUserDisplayNamesForValues(supabase, recordedByValues),
  ]);

  const paidByProjectId = paymentRows.reduce((map, row) => {
    const links = resolvePaymentLinks(row);
    if (!links.projectId) return map;
    if (!isCollectedPayment(row.payment_status)) return map;
    map.set(links.projectId, (map.get(links.projectId) ?? 0) + Math.abs(toNumber(row.amount_total)));
    return map;
  }, new Map<string, number>());

  const paidByOrderId = paymentRows.reduce((map, row) => {
    const links = resolvePaymentLinks(row);
    if (!links.orderId) return map;
    if (!isCollectedPayment(row.payment_status)) return map;
    map.set(links.orderId, (map.get(links.orderId) ?? 0) + Math.abs(toNumber(row.amount_total)));
    return map;
  }, new Map<string, number>());

  // Pending (future-dated / uncleared) payments are emitted as their own scheduled
  // payment entries, so the receivable balance must exclude them to avoid counting
  // the same money twice (as both an open debt and a planned check/transfer).
  const isPendingPayment = (status: unknown) =>
    typeof status === "string" && status.trim().toLowerCase() === "pending";
  const pendingByProjectId = paymentRows.reduce((map, row) => {
    const links = resolvePaymentLinks(row);
    if (!links.projectId || !isPendingPayment(row.payment_status)) return map;
    map.set(links.projectId, (map.get(links.projectId) ?? 0) + Math.abs(toNumber(row.amount_total)));
    return map;
  }, new Map<string, number>());
  const pendingByOrderId = paymentRows.reduce((map, row) => {
    const links = resolvePaymentLinks(row);
    if (!links.orderId || !isPendingPayment(row.payment_status)) return map;
    map.set(links.orderId, (map.get(links.orderId) ?? 0) + Math.abs(toNumber(row.amount_total)));
    return map;
  }, new Map<string, number>());

  const sharedArgs = { customerId, customerProjectSet, referenceDate, projectsById, propertiesById, propertyCustomersById, recordedByNames };

  const payments = buildPaymentEntries({ paymentRows, ordersById, ...sharedArgs });
  const expenses = buildExpenseEntries({ expenseRows, ordersById, projectExpenseLinksByExpenseId, ...sharedArgs });
  const workerPaymentEntries = buildWorkerPaymentEntries({
    allocations: workerPaymentsResult.allocations,
    workerPaymentById,
    sessionsById: workerPaymentsResult.sessionsById,
    ...sharedArgs,
  });
  const workerOwedEntries = buildWorkerOwedEntries({
    debtItems: workerPaymentsResult.workerDebtItemRows,
    sessionsById: workerPaymentsResult.sessionsById,
    ...sharedArgs,
  });
  const projectReceivableEntries = buildProjectReceivableEntries({
    projectRows, projectsById, projectFinancialsById, paidByProjectId, pendingByProjectId, customerId, customerProjectSet, referenceDate,
  });
  const orderReceivableEntries = buildOrderReceivableEntries({
    orderRows, ordersById, orderFinancialsById, paidByOrderId, pendingByOrderId, customerId, customerProjectSet, referenceDate,
  });

  const entries = sortEntries([
    ...payments,
    ...expenses,
    ...workerPaymentEntries,
    ...workerOwedEntries,
    ...projectReceivableEntries,
    ...orderReceivableEntries,
  ]);

  const domainOptions = Array.from(
    new Set(entries.map((entry) => entry.businessDomain).filter((value): value is ExpenseBusinessDomain => Boolean(value)))
  ).sort((left, right) => getBusinessDomainLabel(left).localeCompare(getBusinessDomainLabel(right), "he"));

  const sourceKind = domainToSourceKind(domain);
  const sourceOptions = sourceKind
    ? Array.from(
        entries.reduce((map, entry) => {
          if (entry.sourceKind !== sourceKind || !entry.sourceId) return map;
          if (domain && entry.businessDomain !== domain) return map;
          map.set(entry.sourceId, { id: entry.sourceId, label: entry.sourceLabel });
          return map;
        }, new Map<string, { id: string; label: string }>())
      ).map(([, value]) => value)
    : [];
  sourceOptions.sort((left, right) => left.label.localeCompare(right.label, "he"));

  const filteredEntries = entries.filter((entry) =>
    matchesEntryFilters(entry, { from, to, domain, sourceId, type, stage, query, referenceDate })
  );
  const actualEntries = filteredEntries.filter((entry) => !isFutureEntry(entry, referenceDate));
  const futureEntries = filteredEntries.filter((entry) => isFutureEntry(entry, referenceDate));
  const forecastEndIso = to || addDaysToIso(referenceDate, 30);
  const forecastEntries = filteredEntries.filter((entry) => entry.flowDate <= forecastEndIso);
  const openReceivableEntries = filteredEntries.filter(
    (entry) => entry.type === "inflow" && entry.stage === "pending" &&
      (entry.origin === "project_receivable" || entry.origin === "order_receivable")
  );
  const plannedReceivableEntries = filteredEntries.filter(
    (entry) =>
      entry.type === "inflow" &&
      ((entry.origin === "payment" && entry.stage !== "posted") ||
        ((entry.origin === "project_receivable" || entry.origin === "order_receivable") && entry.stage === "scheduled"))
  );
  const openLiabilityEntries = filteredEntries.filter((entry) => entry.type === "outflow" && entry.stage === "pending");
  const scheduledLiabilityEntries = filteredEntries.filter((entry) => entry.type === "outflow" && entry.stage === "scheduled");
  const sourceCount = new Set(filteredEntries.map((entry) => entry.sourceId).filter((value): value is string => Boolean(value))).size;

  // Return the full sorted ledger (capped) so the client can infinite-scroll it
  // without re-running this heavy build on every page change.
  const LEDGER_MAX = 1500;
  const sortedLedger = sortEntries(filteredEntries);
  const ledgerVisibleEntries = sortedLedger.slice(0, LEDGER_MAX);
  const upcomingSortedEntries = [...futureEntries].sort(
    (left, right) =>
      left.flowDate.localeCompare(right.flowDate) ||
      (left.recordedDate ?? "").localeCompare(right.recordedDate ?? "") ||
      left.id.localeCompare(right.id)
  );
  const upcomingPagination = paginateEntries(upcomingSortedEntries, upcomingPage, UPCOMING_PAGE_SIZE);

  return {
    todayIso: referenceDate,
    actualSummary: summarizeEntries(actualEntries),
    futureSummary: summarizeEntries(futureEntries),
    totalSummary: summarizeEntries(filteredEntries),
    forecastSummary: summarizeEntries(forecastEntries),
    forecastEndIso,
    openReceivablesSummary: summarizeEntries(openReceivableEntries),
    plannedReceivablesSummary: summarizeEntries(plannedReceivableEntries),
    openLiabilitiesSummary: summarizeEntries(openLiabilityEntries),
    scheduledLiabilitiesSummary: summarizeEntries(scheduledLiabilityEntries),
    domainGroups: buildDomainGroups(filteredEntries, referenceDate),
    domainOptions,
    sourceKind,
    sourceOptions,
    sourceCount,
    ledgerEntries: ledgerVisibleEntries,
    ledgerTotalCount: filteredEntries.length,
    ledgerPage: 1,
    ledgerTotalPages: 1,
    upcomingEntries: upcomingPagination.entries,
    upcomingTotalCount: upcomingPagination.totalCount,
    upcomingPage: upcomingPagination.page,
    upcomingTotalPages: upcomingPagination.totalPages,
  };
}
