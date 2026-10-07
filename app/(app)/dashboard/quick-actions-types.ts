// Neutral (client- and server-safe) types/constants for the quick-action data.
// Kept out of quick-actions-data.ts so client code can import the shape + empty
// default without pulling the loader into its bundle.
//
// The option shapes below used to live in DashboardActions.tsx, the dashboard's
// own tile grid. That grid is gone — every create flow is behind the + menu now
// — so they live here, next to the payload that carries them.
import type { SalaryAgreementRow } from "@/lib/payroll";
import type { UserRole } from "@/lib/auth/requireProfile";
import type { PayrollWorkerType } from "@/lib/payroll-worker-type";

type Row = Record<string, unknown>;

/** A project a task / expense / income / session can be linked to. */
export type ProjectOption = {
  id: string;
  name: string;
  type?: string;
  customerId: string;
  customerName: string;
  startDate?: string;
};

/** Someone who can be assigned work, logged a shift, or paid. */
export type UserOption = {
  id: string;
  label: string;
  role?: UserRole;
  payroll_worker_type?: PayrollWorkerType | null;
  pay_tracking_mode?: string | null;
  /** Logs shifts (a session-logging worker type) — the attendance picker's test. */
  logs_shifts?: boolean;
};

/** An order or a property — anything pickable by name with an optional detail line. */
export type EntityOption = {
  id: string;
  name: string;
  subtitle?: string;
};

/** The data the quick-action create dialogs need (dropdowns / pickers). */
export type QuickActionsData = {
  customers: Row[];
  /** Every active customer as the task form's picker shows them ("name · phone", A–Z) — same list as the tasks board's. */
  taskCustomers: { id: string; label: string }[];
  products: Row[];
  projects: ProjectOption[];
  orders: EntityOption[];
  properties: EntityOption[];
  users: UserOption[];
  salaryAgreements: SalaryAgreementRow[];
};

export const EMPTY_QUICK_ACTIONS: QuickActionsData = {
  customers: [],
  taskCustomers: [],
  products: [],
  projects: [],
  orders: [],
  properties: [],
  users: [],
  salaryAgreements: [],
};
