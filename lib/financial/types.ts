import type { ExpenseBusinessDomain } from "@/lib/expenses";
import type { LoansSummary } from "@/lib/loans";

// ─── Internal DB row types ────────────────────────────────────────────────────

export type PaymentRow = {
  id: string;
  payment_date: string | null;
  due_date: string | null;
  amount_total: number | string | null;
  payment_method: string | null;
  payment_status: string | null;
  reference_number: string | null;
  business_domain: string | null;
  notes: string | null;
  project_id: string | null;
  order_id: string | null;
  property_id: string | null;
  target_type: string | null;
  target_id: string | null;
  recorded_by: string | null;
};

export type ExpenseRow = {
  id: string;
  expense_date: string | null;
  amount: number | string | null;
  category: string | null;
  description: string | null;
  business_domain: string | null;
  notes: string | null;
  project_id: string | null;
  order_id: string | null;
  property_id: string | null;
  recorded_by: string | null;
  payment_status: string | null;
  paid_amount: number | string | null;
  payment_method: string | null;
  paid_date?: string | null;
  account_id?: string | null;
};

export type OrderRow = {
  id: string;
  customer_id: string | null;
  order_date?: string | null;
  status?: string | null;
  total_amount?: number | string | null;
  payment_status?: string | null;
};

export type ProjectRow = {
  id: string;
  name: string | null;
  customer_id: string | null;
  agreed_base_price?: number | string | null;
  actual_price?: number | string | null;
  created_at?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
};

export type PropertyRow = {
  id: string;
  address: string | null;
};

export type ProjectFinancialRow = {
  id: string;
  customer_total_price: number | string | null;
  expenses_billed: number | string | null;
};

export type OrderFinancialRow = {
  id: string;
  order_id?: string | null;
  total_amount: number | string | null;
  total_paid: number | string | null;
  remaining_balance: number | string | null;
  payment_status: string | null;
};

export type LeaseAgreementRow = {
  property_id: string | null;
  customer_id: string | null;
};

export type ProjectExpenseLinkRow = {
  expense_id: string | null;
  project_id: string | null;
};

export type WorkerPaymentRow = {
  id: string;
  user_id: string | null;
  payment_date: string | null;
  amount: number | string | null;
  payment_method: string | null;
  reference_number: string | null;
  notes: string | null;
  recorded_by: string | null;
};

export type WorkerPaymentAllocationRow = {
  id: string;
  worker_payment_id: string | null;
  source_type: string | null;
  attendance_session_id: string | null;
  payslip_id: string | null;
  amount: number | string | null;
};

export type WorkerDebtItemRow = {
  source_type: string | null;
  source_id: string | null;
  user_id: string | null;
  project_id: string | null;
  source_date: string | null;
  due_date: string | null;
  period_month: string | null;
  owed_amount: number | string | null;
  payment_status: string | null;
};

export type AttendanceSessionFinanceRow = {
  id: string;
  user_id: string | null;
  clock_in: string | null;
  business_domain: string | null;
  project_id: string | null;
  property_id: string | null;
  labor_cost: number | string | null;
  paid_amount: number | string | null;
  owed_amount: number | string | null;
  payment_status: string | null;
};

export type WorkerUserRow = {
  id: string;
  pay_tracking_mode: string | null;
};

export type SalaryAgreementLiteRow = {
  id: string;
  user_id: string | null;
  salary_type: string | null;
  hourly_rate: number | string | null;
  monthly_salary: number | string | null;
  valid_from: string | null;
  valid_to: string | null;
};

// ─── Public types ─────────────────────────────────────────────────────────────

export type FinancialPageFilters = {
  customerId?: string | null;
  from?: string | null;
  to?: string | null;
  domain?: string | null;
  sourceId?: string | null;
  type?: string | null;
  stage?: string | null;
  q?: string | null;
  ledgerPage?: number | null;
  upcomingPage?: number | null;
};

export type FinancialEntryType = "inflow" | "outflow";
export type FinancialEntryStage = "posted" | "scheduled" | "pending";
export type FinancialSourceKind = "project" | "property" | "order" | "general";
export type FinancialEntryOrigin =
  | "payment"
  | "expense"
  | "worker_payment"
  | "worker_owed"
  | "project_receivable"
  | "order_receivable"
  // Loan principal cash movement (loan received / repaid). Carries cash but NOT
  // P&L — aggregateProfitLoss only counts payment/expense/receivable origins, so
  // loan principal is excluded from profit by construction. Interest is emitted
  // separately as expense/payment so it does hit P&L.
  | "loan";

export type FinancialEntry = {
  id: string;
  type: FinancialEntryType;
  amount: number;
  signedAmount: number;
  businessDomain: ExpenseBusinessDomain | null;
  domainName: string;
  flowDate: string;
  recordedDate: string | null;
  dueDate: string | null;
  stage: FinancialEntryStage;
  sourceKind: FinancialSourceKind;
  sourceId: string | null;
  sourceLabel: string;
  sourceHref: string | null;
  description: string;
  origin: FinancialEntryOrigin;
  reference: string | null;
  paymentMethod: string | null;
  paymentMethodLabel: string | null;
  paymentStatus: string | null;
  recordedByName: string | null;
  customerId: string | null;
  searchText: string;
  expenseId?: string | null;
  expenseCategory?: string | null;
  expenseDescriptionRaw?: string | null;
  expenseNotes?: string | null;
  expenseProjectId?: string | null;
  expenseOrderId?: string | null;
  expensePropertyId?: string | null;
  expensePaidAmount?: number | null;
  expensePaymentMethod?: string | null;
  expensePaidDate?: string | null;
  expenseAccountId?: string | null;
};

export type FinancialSummary = {
  inflow: number;
  outflow: number;
  net: number;
  count: number;
};

export type FinancialDomainGroup = {
  domain: ExpenseBusinessDomain | null;
  domainName: string;
  actual: FinancialSummary;
  future: FinancialSummary;
  total: FinancialSummary;
};

// Per-domain profit & loss row. Both bases are computed in one pass so the UI
// can toggle between them with no re-fetch (see aggregateProfitLoss in entries.ts):
//  - cash (בפועל):     posted income vs posted expenses/wages (+ paid portion of partials).
//  - accrual (כולל פתוחים): cash + open receivables (earned) and open liabilities (incurred).
export type ProfitLossDomainRow = {
  domain: ExpenseBusinessDomain | null;
  domainName: string;
  isPersonal: boolean; // home | charity
  cashRevenue: number;
  cashExpense: number;
  accrualRevenue: number;
  accrualExpense: number;
};

// Expense line item by category (cash/accrual) — see aggregateExpenseCategories in entries.ts.
export type ProfitLossCategoryRow = {
  category: string;
  cashExpense: number;
  accrualExpense: number;
};

// One month of realized (posted) cash movement — see buildMonthlyTrend in entries.ts.
export type MonthlyTrendPoint = {
  month: string; // YYYY-MM
  inflow: number;
  outflow: number;
  net: number;
};

// One future month's expected net change (scheduled + pending items) — see
// buildForecastMonthly in entries.ts. The running projected balance is computed
// client-side starting from the current actual balance.
export type ForecastChangePoint = {
  month: string; // YYYY-MM
  change: number;
};

export type FinancialPageData = {
  todayIso: string;
  actualSummary: FinancialSummary;
  futureSummary: FinancialSummary;
  totalSummary: FinancialSummary;
  forecastSummary: FinancialSummary;
  forecastEndIso: string;
  openReceivablesSummary: FinancialSummary;
  plannedReceivablesSummary: FinancialSummary;
  openLiabilitiesSummary: FinancialSummary;
  scheduledLiabilitiesSummary: FinancialSummary;
  // Outstanding loan principal: borrowed (a debt) vs lent (an asset). Counts into
  // the dashboard's position/net-worth but not P&L. See lib/loans.
  loansSummary: LoansSummary;
  domainGroups: FinancialDomainGroup[];
  profitLoss: ProfitLossDomainRow[];
  profitLossExpenseCategories: ProfitLossCategoryRow[];
  // Same-shape rows for the immediately-preceding equal-length period (empty unless
  // both from+to are set); profitLossPreviousPeriod holds that window's dates.
  profitLossPrevious: ProfitLossDomainRow[];
  profitLossPreviousPeriod: { from: string; to: string } | null;
  monthlyTrend: MonthlyTrendPoint[];
  forecastMonthly: ForecastChangePoint[];
  domainOptions: ExpenseBusinessDomain[];
  sourceKind: FinancialSourceKind | null;
  sourceOptions: Array<{ id: string; label: string }>;
  sourceCount: number;
  ledgerEntries: FinancialEntry[];
  ledgerTotalCount: number;
  ledgerPage: number;
  ledgerTotalPages: number;
  upcomingEntries: FinancialEntry[];
  upcomingTotalCount: number;
  upcomingPage: number;
  upcomingTotalPages: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const SCAN_CHUNK_SIZE = 500;
export const ID_CHUNK_SIZE = 200;
export const LEDGER_PAGE_SIZE = 25;
export const UPCOMING_PAGE_SIZE = 15;
