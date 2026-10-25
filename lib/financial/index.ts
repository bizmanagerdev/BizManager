import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveUserDisplayNamesForValues } from "@/lib/audit";
import { getBusinessDomainLabel, type ExpenseBusinessDomain } from "@/lib/expenses";
import { cardScanSince, loadSettlementConfirmations } from "@/lib/card-settlements";
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
  fetchRecurringTemplateMeta,
} from "./db";
import { buildPayslipDomainShares } from "./laborSplit";
import {
  expandByDomain,
  aggregateLoanFlows,
  aggregateProfitLoss,
  aggregateProfitLossProof,
  aggregateExpenseCategories,
  buildDomainGroups,
  buildForecastMonthly,
  buildMonthlyTrend,
  buildExpenseEntries,
  buildLoanEntries,
  buildOrderReceivableEntries,
  buildPaymentEntries,
  buildProjectReceivableEntries,
  buildRentReceivableEntries,
  buildWorkerOwedEntries,
  buildWorkerPaymentEntries,
  matchesEntryFilters,
  resolvePaymentLinks,
  sortEntries,
  summarizeEntries,
} from "./entries";
import { fetchLoans, summarizeLoans, type Loan, type LoansSummary } from "@/lib/loans";
import { loadRentRoll, propertyDisplayName, type RentRollData } from "@/lib/properties";
import { rentDebtByLease, rentPaymentsByLease } from "@/lib/rent-roll";
import { rentPeriodLabel } from "@/lib/rent-periods";
import { openLiabilityEntries, withOpenAmount } from "@/lib/financial/expenseOpen";
import { ledgerSearchRecord } from "@/lib/financial/search";
import { listVocabulary, prepareListSearch } from "@/lib/search/listSearch";
import { parseGlobalQuery } from "@/lib/search/global-query";
import { clampFromToBooksStart } from "@/lib/settings/booksStartDate";
import {
  type FinancialEntry,
  type FinancialPageData,
  type FinancialPageFilters,
} from "./types";
import {
  addDaysToIso,
  addMonthsToIso,
  domainToSourceKind,
  isFutureEntry,
  isPermissionDeniedError,
  normalizeCustomerId,
  normalizeDate,
  normalizeDomain,
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

// Per-domain profit & loss row (cash/accrual) — see aggregateProfitLoss in ./entries.ts.
// Monthly trend + forecast points — see buildMonthlyTrend / buildForecastMonthly.
export type {
  ProfitLossDomainRow,
  ProfitLossCategoryRow,
  ProfitLossProofItem,
  ProfitLossProofMap,
  LoanFlowItem,
  LoanFlows,
  MonthlyTrendPoint,
  ForecastChangePoint,
} from "./types";

/**
 * Scans every money source and builds the full, sorted `FinancialEntry[]` for the
 * business (all 6 origins). This is the heavy half of `getFinancialPageData`,
 * extracted so other consumers (e.g. the P&L report) can reuse the exact same
 * entry pipeline instead of re-querying. No filtering/pagination happens here —
 * callers filter the returned entries themselves.
 *
 * `from` widens the scan window (when omitted, only the last 13 months are read).
 */
export async function loadFinancialEntries(
  supabase: SupabaseClient,
  options: { from?: string | null; customerId?: string | null } = {}
): Promise<{ entries: FinancialEntry[]; referenceDate: string; loansSummary: LoansSummary }> {
  const customerId = normalizeCustomerId(options.customerId);
  const referenceDate = todayIso();
  const from = normalizeDate(options.from);
  // Default scan window: when no explicit from-filter, only scan the last 13 months.
  // This avoids reading all-time data on every page load.
  const scanSince: string = from ?? (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 13);
    return d.toISOString().slice(0, 10);
  })();
  const customerProjectIds = await resolveCustomerProjectIds(supabase, customerId);
  const customerProjectSet = new Set(customerProjectIds);

  // Loans are business-wide (not customer-scoped) and have no dependency on any
  // id resolved below — kicked off here so its round trips overlap the whole
  // scan instead of adding their own latency at the very end (it used to be
  // `await`ed after everything else had already resolved).
  const loansPromise = customerId ? Promise.resolve([] as Loan[]) : fetchLoans(supabase);

  const [paymentRows, expenseScan, workerPaymentsResult, projectRows, orderRows, templateMetaById, settlementConfirmations] = await Promise.all([
    // Reaches back one more month: last month's card payments are money on the
    // 10th of this one, so a window starting now still has to read them.
    scanPaymentRows(supabase, cardScanSince(scanSince)),
    // Which project each expense belongs to (project_expenses) needs only the
    // expense ids, so it's looked up the moment they arrive — alongside the
    // other scans, not in a round trip of its own after all of them.
    scanExpenseRows(supabase, scanSince).then(async (rows) => ({
      rows,
      projectLinks: await fetchProjectExpenseLinksByExpenseIds(supabase, rows.map((row) => row.id)),
    })),
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
    fetchRecurringTemplateMeta(supabase),
    loadSettlementConfirmations(supabase),
  ]);
  // Rent, by the rent page's own rule (owner, 2026-10-25): each lease's months still owed and whose each rent
  // payment is. Best-effort — without it, rent is counted as before (its payments alone).
  const rentData: RentRollData | null = await loadRentRoll(supabase).catch(() => null);

  const paymentLinks = paymentRows.map(resolvePaymentLinks);
  const { rows: expenseRows, projectLinks: projectExpenseLinksByExpenseId } = expenseScan;
  const workerPaymentById = new Map(
    workerPaymentsResult.workerPaymentRows
      .filter((row) => row.id)
      .map((row) => [row.id, row] as const)
  );
  // Payslip (monthly-salary) domain/project/property, keyed by payslip id (= the
  // debt view's source_id for payslip rows). Lets worker-payment entries attribute
  // a salaried worker's pay to the project/domain on their salary agreement.
  const payslipMetaById = new Map<string, { businessDomain: string | null; projectId: string | null; propertyId: string | null }>();
  for (const row of workerPaymentsResult.workerDebtItemRows) {
    if ((row.source_type ?? "").toLowerCase() !== "payslip" || !row.source_id) continue;
    payslipMetaById.set(row.source_id, {
      businessDomain: row.business_domain ?? null,
      projectId: row.project_id ?? null,
      propertyId: row.property_id ?? null,
    });
  }
  // An hourly payslip worked in several areas: what's paid or owed on it divides
  // by its shifts, so the areas carry their own wages (lib/financial/laborSplit).
  const payslipDomainShares = buildPayslipDomainShares(
    workerPaymentsResult.workerDebtItemRows,
    workerPaymentsResult.attendanceSessionRows
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
    ...workerPaymentsResult.workerDebtItemRows.map((row) => row.property_id ?? null),
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

  // Use the SIGNED amount so refunds (negative payments) reduce the collected
  // total rather than inflating it (a refund is money returned to the customer).
  const paidByProjectId = paymentRows.reduce((map, row) => {
    const links = resolvePaymentLinks(row);
    if (!links.projectId) return map;
    if (!isCollectedPayment(row.payment_status)) return map;
    map.set(links.projectId, (map.get(links.projectId) ?? 0) + toNumber(row.amount_total));
    return map;
  }, new Map<string, number>());

  const paidByOrderId = paymentRows.reduce((map, row) => {
    const links = resolvePaymentLinks(row);
    if (!links.orderId) return map;
    if (!isCollectedPayment(row.payment_status)) return map;
    map.set(links.orderId, (map.get(links.orderId) ?? 0) + toNumber(row.amount_total));
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

  // A rent payment's tenant: the lease it was for.
  const tenantByPaymentId = new Map<string, string>();
  if (rentData) {
    const leaseById = new Map(rentData.leases.map((lease) => [lease.id, lease]));
    for (const [leaseId, leasePayments] of rentPaymentsByLease(rentData)) {
      const tenant = leaseById.get(leaseId)?.customerId;
      if (tenant) for (const payment of leasePayments) tenantByPaymentId.set(payment.id, tenant);
    }
  }

  const payments = buildPaymentEntries({ paymentRows, ordersById, settlementConfirmations, tenantByPaymentId, ...sharedArgs });
  const expenses = buildExpenseEntries({ expenseRows, ordersById, projectExpenseLinksByExpenseId, templateMetaById, ...sharedArgs });
  const workerPaymentEntries = buildWorkerPaymentEntries({
    allocations: workerPaymentsResult.allocations,
    workerPaymentById,
    sessionsById: workerPaymentsResult.sessionsById,
    payslipMetaById,
    payslipDomainShares,
    ...sharedArgs,
  });
  const workerOwedEntries = buildWorkerOwedEntries({
    debtItems: workerPaymentsResult.workerDebtItemRows,
    sessionsById: workerPaymentsResult.sessionsById,
    payslipDomainShares,
    ...sharedArgs,
  });
  const projectReceivableEntries = buildProjectReceivableEntries({
    projectRows, projectsById, projectFinancialsById, paidByProjectId, pendingByProjectId, customerId, customerProjectSet, referenceDate,
  });
  const orderReceivableEntries = buildOrderReceivableEntries({
    orderRows, ordersById, orderFinancialsById, paidByOrderId, pendingByOrderId, customerId, customerProjectSet, referenceDate,
  });
  const rentReceivableEntries = rentData
    ? (() => {
        const leaseById = new Map(rentData.leases.map((lease) => [lease.id, lease]));
        return buildRentReceivableEntries({
          leases: rentData.leases,
          debts: rentDebtByLease(rentData, referenceDate),
          propertyNameById: new Map(rentData.properties.map((p) => [p.id, propertyDisplayName(p)])),
          periodLabel: (leaseId, period) => {
            const lease = leaseById.get(leaseId);
            return lease ? rentPeriodLabel(lease, period) : period;
          },
          customerId,
          referenceDate,
        });
      })()
    : [];

  const loans = await loansPromise;
  const loanEntries = buildLoanEntries(loans, referenceDate);

  const entries = sortEntries([
    ...payments,
    ...expenses,
    ...workerPaymentEntries,
    ...workerOwedEntries,
    ...projectReceivableEntries,
    ...orderReceivableEntries,
    ...rentReceivableEntries,
    ...loanEntries,
  ]);

  return { entries, referenceDate, loansSummary: summarizeLoans(loans) };
}

export type DomainCashPoint = {
  domain: ExpenseBusinessDomain | null;
  domainName: string;
  inflow: number;
  outflow: number;
  net: number;
};

/**
 * Per-domain ACTUAL cash in/out for a date window, derived from the one financial
 * engine. "Actual" = posted only — pending (unpaid expenses, uncleared checks) and
 * scheduled (future) entries are excluded, so this agrees with the financial page
 * instead of the old dashboard scan that counted every recorded expense as cash out.
 * Powers the dashboard's per-domain chart.
 *
 * `preloadedEntries` lets a caller that already scanned a wider (or equal)
 * window — e.g. the dashboard computing this month AND last month's bars from
 * one shared scan — skip a second full `loadFinancialEntries` round trip.
 * Omitted, this scans `from` itself exactly like before.
 */
export async function loadDomainCashBreakdown(
  supabase: SupabaseClient,
  { from, to }: { from: string; to: string },
  preloadedEntries?: FinancialEntry[]
): Promise<DomainCashPoint[]> {
  const entries = preloadedEntries ?? (await loadFinancialEntries(supabase, { from })).entries;
  const byDomain = new Map<string, DomainCashPoint>();
  // Wages split by area where the payslip was worked in several (expandByDomain).
  for (const entry of expandByDomain(entries)) {
    if (entry.stage !== "posted") continue; // real cash only
    if (entry.flowDate < from || entry.flowDate > to) continue;
    // Loan principal/repayments are financing cash, not business income or
    // expense — they rarely carry their own domain, so they'd otherwise fall
    // into the borrower's business_domain (usually general_business / "שוטף")
    // and read as a spike in ordinary income. They're tracked on /financial/loans
    // instead; the interest portion (origin "expense"/"payment") is real P&L
    // and stays on its normal domain here.
    if (entry.origin === "loan") continue;
    const key = entry.businessDomain ?? "__unassigned__";
    const point =
      byDomain.get(key) ??
      { domain: entry.businessDomain, domainName: entry.domainName, inflow: 0, outflow: 0, net: 0 };
    if (entry.type === "inflow") point.inflow += entry.amount;
    else point.outflow += entry.amount;
    point.net = point.inflow - point.outflow;
    byDomain.set(key, point);
  }
  return Array.from(byDomain.values()).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}

export async function getFinancialPageData(
  supabase: SupabaseClient,
  filters: FinancialPageFilters = {},
  // May be a promise, so the caller can load the projections while the entries
  // scan runs; it's only awaited once the entries are in.
  injected: { projectedOutflowEntries?: FinancialEntry[] | Promise<FinancialEntry[]> } = {}
): Promise<FinancialPageData> {
  // Books start date: nothing before it counts, so an earlier (or empty) `from` is raised to it.
  const notBefore = normalizeDate(filters.notBefore);
  const from = clampFromToBooksStart(normalizeDate(filters.from), notBefore);
  const to = normalizeDate(filters.to);
  // When an explicit period is selected, also cover the immediately-preceding
  // equal-length period so the P&L can show a period-over-period comparison —
  // unless that period reaches before the books start (its numbers aren't real).
  const previousPeriod =
    from && to && from <= to
      ? (() => {
          const lengthDays =
            Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
          const period = { from: addDaysToIso(from, -lengthDays), to: addDaysToIso(from, -1) };
          return notBefore && period.from < notBefore ? null : period;
        })()
      : null;
  const { entries, referenceDate, loansSummary } = await loadFinancialEntries(supabase, {
    from: previousPeriod ? previousPeriod.from : from,
    customerId: filters.customerId,
  });
  const domain = normalizeDomain(filters.domain);
  const sourceId = normalizeCustomerId(filters.sourceId);
  const type = filters.type === "inflow" || filters.type === "outflow" ? filters.type : null;
  const stage =
    filters.stage === "actual" || filters.stage === "future" || filters.stage === "pending"
      ? filters.stage
      : null;
  const query = normalizeText(filters.q);
  // Entries scoped by the domain filter only — used by the P&L / trend / forecast
  // reports, which (unlike the ledger) must keep both inflow+outflow and all stages.
  // With a domain chosen, a wage payment worked in several areas counts only its
  // share in that area (expandByDomain); with none, every entry stays whole.
  const domainScopedBase = domain ? expandByDomain(entries) : entries;
  const domainEntries = domain ? domainScopedBase.filter((entry) => entry.businessDomain === domain) : entries;

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

  // The search read once, with close spellings from the whole ledger's words.
  const search = query
    ? prepareListSearch(query, {
        today: referenceDate,
        vocabulary: parseGlobalQuery(query).words.some((word) => word.length >= 3)
          ? listVocabulary(entries.map(ledgerSearchRecord))
          : undefined,
      })
    : null;
  const filteredEntries = domainScopedBase.filter((entry) =>
    matchesEntryFilters(entry, { from, to, domain, sourceId, type, stage, query, referenceDate, search })
  );
  const forecastEndIso = to || addDaysToIso(referenceDate, 30);

  // ── Expected OUTFLOW forecasts (projected salaries + recurring bills) ─────────
  // Injected into the FUTURE-facing views ONLY — the near-future ledger, the
  // future/forecast summaries, per-domain future, and the forecast tab — so
  // "what's leaving" shows next to expected income (receivables). They are NEVER
  // added to actual, the P&L/trend, or the full journal, which stay real-only
  // (the golden reconciliation numbers can't move). Every projection is stage
  // scheduled/pending, so it also never counts as actual cash by construction.
  // Bounded to the caller's horizon. Projected salaries drop any month that
  // already has a real wage entry; recurring self-de-dupes against materialized rows.
  const realWageMonths = new Set<string>();
  for (const entry of entries) {
    if ((entry.origin === "worker_owed" || entry.origin === "worker_payment") && entry.workerUserId) {
      realWageMonths.add(`${entry.workerUserId}:${entry.flowDate.slice(0, 7)}`);
    }
  }
  const projections = ((await injected.projectedOutflowEntries) ?? []).filter(
    (p) => !(p.origin === "worker_owed" && p.workerUserId && realWageMonths.has(`${p.workerUserId}:${p.flowDate.slice(0, 7)}`))
  );
  // Respect the ledger's active filters for the list/summaries; the P&L-style
  // forecast tab only honours the domain filter (like domainEntries).
  const projFiltered = projections.filter((p) =>
    matchesEntryFilters(p, { from, to, domain, sourceId, type, stage, query, referenceDate, search })
  );
  const projDomainEntries = projections.filter((p) => !domain || p.businessDomain === domain);

  const actualEntries = filteredEntries.filter((entry) => !isFutureEntry(entry, referenceDate));
  const futureEntries = [
    ...filteredEntries.filter((entry) => isFutureEntry(entry, referenceDate)),
    ...projFiltered,
  ];
  const forecastEntries = [
    ...filteredEntries.filter((entry) => entry.flowDate <= forecastEndIso),
    ...projFiltered.filter((p) => p.flowDate <= forecastEndIso),
  ];
  const openReceivableEntries = filteredEntries.filter(
    (entry) => entry.type === "inflow" && entry.stage === "pending" &&
      (entry.origin === "project_receivable" || entry.origin === "order_receivable" || entry.origin === "rent_receivable")
  );
  const plannedReceivableEntries = filteredEntries.filter(
    (entry) =>
      entry.type === "inflow" &&
      ((entry.origin === "payment" && entry.stage !== "posted") ||
        ((entry.origin === "project_receivable" || entry.origin === "order_receivable") && entry.stage === "scheduled"))
  );
  // Liability buckets stay REAL-ONLY: "התחייבויות פתוחות" means debts already
  // created (and feeds the net-worth calc), and the מאזן tab is accounting, not a
  // forecast — projected bills that don't exist yet must not inflate them.
  // A partly-paid bill is owed for what's left of it, not its face value — the
  // same rule as the payments calendar and the חובות page (withOpenAmount).
  // Late loan installments stay out: the loan's own outstanding balance
  // (loansSummary) already holds them, and net worth subtracts that too.
  const openLiabilities = openLiabilityEntries(filteredEntries);
  // The forward view is cash planning, not net worth — loan installments due
  // ahead belong in it like any other payment.
  const scheduledLiabilityEntries = filteredEntries
    .filter((entry) => entry.type === "outflow" && entry.stage === "scheduled")
    .map(withOpenAmount);
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
  // Send the full upcoming list (capped) so the client can scroll-to-load it,
  // just like the ledger above — no "next page" round-trips to the server.
  const UPCOMING_MAX = 1000;
  const upcomingVisibleEntries = upcomingSortedEntries.slice(0, UPCOMING_MAX);

  return {
    todayIso: referenceDate,
    actualSummary: summarizeEntries(actualEntries),
    futureSummary: summarizeEntries(futureEntries),
    totalSummary: summarizeEntries([...filteredEntries, ...projFiltered]),
    forecastSummary: summarizeEntries(forecastEntries),
    forecastEndIso,
    openReceivablesSummary: summarizeEntries(openReceivableEntries),
    plannedReceivablesSummary: summarizeEntries(plannedReceivableEntries),
    openLiabilitiesSummary: summarizeEntries(openLiabilities),
    scheduledLiabilitiesSummary: summarizeEntries(scheduledLiabilityEntries),
    loansSummary,
    domainGroups: buildDomainGroups([...filteredEntries, ...projFiltered], referenceDate),
    // P&L, monthly trend and forecast are driven by date/domain only (they need both
    // inflow+outflow and posted+pending), so they ignore the type/stage/source/q filters.
    profitLoss: aggregateProfitLoss(domainEntries, { from, to }),
    // Line-item proof behind each domain's cash/accrual number (סקירה drill-down).
    profitLossProof: aggregateProfitLossProof(domainEntries, { from, to }),
    // Expense line items by category, split by domain — every domain, personal ones
    // too. The report applies the בית/צדקה and ניהול נכסים toggles and the domain
    // chips to these rows exactly as it does to the totals (owner, 2026-10-13: the
    // table never showed property expenses, even with the toggle on).
    profitLossExpenseCategories: aggregateExpenseCategories(domainEntries, { from, to }),
    profitLossPrevious: previousPeriod ? aggregateProfitLoss(domainEntries, previousPeriod) : [],
    profitLossPreviousPeriod: previousPeriod,
    // Loan money that moved in the period — shown only behind "כולל הלוואות".
    loanFlows: aggregateLoanFlows(domainEntries, { from, to }),
    // Historical monthly trend: posted-only, within [from..today] (default last 12 months).
    monthlyTrend: buildMonthlyTrend(domainEntries, {
      from: from ?? addMonthsToIso(referenceDate, -12),
      to: to && to < referenceDate ? to : referenceDate,
    }),
    // Forward projection: next 6 months of scheduled/pending items (date filter N/A).
    forecastMonthly: buildForecastMonthly([...domainEntries, ...projDomainEntries], { referenceDate, months: 6 }),
    domainOptions,
    sourceKind,
    sourceOptions,
    sourceCount,
    ledgerEntries: ledgerVisibleEntries,
    ledgerTotalCount: filteredEntries.length,
    ledgerPage: 1,
    ledgerTotalPages: 1,
    upcomingEntries: upcomingVisibleEntries,
    upcomingTotalCount: upcomingSortedEntries.length,
    upcomingPage: 1,
    upcomingTotalPages: 1,
  };
}
