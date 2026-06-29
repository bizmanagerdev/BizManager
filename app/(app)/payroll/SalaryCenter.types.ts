import type { UserRole } from "@/lib/auth/requireProfile";
import type { ExpenseBusinessDomain } from "@/lib/expenses";
import type { PayrollWorkerType } from "@/lib/payroll-worker-type";
import type { PayrollPeriodRow } from "@/lib/payroll";
import type {
  SalaryCenterProjectOption,
  SalaryCenterUserRow,
  SessionPublicRow,
} from "@/lib/payroll-center";

// Form-state + view-state types for the payroll center. Extracted from
// SalaryCenterClient so the component file holds behaviour, not type noise.

export type Props = {
  viewerRole: UserRole;
  publicUsers: SalaryCenterUserRow[];
  publicSessions: SessionPublicRow[];
  projectOptions: SalaryCenterProjectOption[];
  propertyOptions: SalaryCenterProjectOption[];
  publicPeriods: PayrollPeriodRow[];
  initiallyUnlocked: boolean;
  hasPasswordConfigured: boolean;
  defaultWorkerId?: string;
  /**
   * "list" (default): renders the full payroll center — top tabs, worker
   * tables, and a worker-detail dialog that opens when a row is selected.
   * "worker-detail": renders only the worker-detail view inline (no top tabs,
   * no worker tables, no dialog wrapper) for the `defaultWorkerId` worker.
   * Used by /payroll/workers/[id].
   */
  mode?: "list" | "worker-detail";
};

export type SessionFormState = {
  session_id: string;
  user_id: string;
  business_domain: string;
  project_id: string;
  property_id: string;
  notes: string;
  clock_in: string;
  clock_out: string;
  labor_cost: string;
  original_user_id: string;
  original_clock_in: string;
  original_clock_out: string;
  original_labor_cost: string;
  is_billable_to_customer: boolean;
  bill_to_customer_amount: string;
  billing_status: string;
  mark_paid_now: boolean;
  paid_amount_now: string;
};

export type WorkerFormState = {
  full_name: string;
  email: string;
  phone: string;
  role: "admin" | "office" | "worker" | "worker_no_access";
  active: boolean;
  system_access: boolean;
  payroll_worker_type: PayrollWorkerType;
};

export type CreateUserFormState = {
  full_name: string;
  email: string;
  phone: string;
  password: string;
  role: "admin" | "office" | "worker" | "worker_no_access";
  active: boolean;
  system_access: boolean;
  payroll_worker_type: PayrollWorkerType;
};

export type AgreementFormState = {
  agreement_id: string;
  user_id: string;
  salary_type: "hourly" | "monthly";
  hourly_rate: string;
  monthly_salary: string;
  overtime_rate: string;
  standard_daily_hours: string;
  due_day_of_next_month: string;
  valid_from: string;
  notes: string;
};

export type OverrideFormState = {
  override_hourly_rate: string;
  start_time: string;
  end_time: string;
  reason: string;
  notes: string;
};

export type PayslipItemFormState = {
  payslip_id: string;
  item_type: string;
  amount: string;
  notes: string;
};

export type WorkerPaymentAllocationFormState = {
  source_type: "session" | "payslip";
  source_id: string;
  amount: string;
  max_amount: number;
  title: string;
  subtitle: string;
};

export type WorkerPaymentFormState = {
  payment_id: string;
  user_id: string;
  payment_date: string;
  amount: string;
  payment_method: string;
  account_id: string;
  reference_number: string;
  notes: string;
  allocations: WorkerPaymentAllocationFormState[];
};

export type SplitPartDraft = {
  id: string;
  minutes: string;
  domain: ExpenseBusinessDomain;
  projectId: string;
  propertyId: string;
};

export type PendingSalaryDeletion =
  | { kind: "session"; sessionId: string; workerLabel: string }
  | { kind: "worker"; userId: string; workerLabel: string }
  | { kind: "agreement"; agreementId: string; userId: string; workerLabel: string }
  | { kind: "payment"; paymentId: string; userId: string; amountLabel: string };

export type WorkerPrintFilters = {
  projectId: string;
  month: string;
  year: string;
};
