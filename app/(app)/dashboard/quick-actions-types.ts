// Neutral (client- and server-safe) types/constants for the quick-action data.
// Kept out of quick-actions-data.ts (which is `server-only`) so client code can
// import the shape + empty default without pulling server code into the bundle.
//
// The option shapes below used to live in DashboardActions.tsx, the dashboard's
// own tile grid. That grid is gone — every create flow is behind the + menu now
// — so they live here, next to the payload that carries them.
import type { CalendarEntry } from "@/lib/projectSchedule";
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
};

/** An order or a property — anything pickable by name with an optional detail line. */
export type EntityOption = {
  id: string;
  name: string;
  subtitle?: string;
};

/** The viewer's currently-running shift, if they have one. */
export type OpenSessionInfo = {
  id: string;
  clock_in: string;
};

/** The data the quick-action create dialogs need (dropdowns / pickers). */
export type QuickActionsData = {
  customers: Row[];
  products: Row[];
  projects: ProjectOption[];
  orders: EntityOption[];
  properties: EntityOption[];
  users: UserOption[];
  currentOpenSession: OpenSessionInfo | null;
  salaryAgreements: SalaryAgreementRow[];
  scheduleEntries: CalendarEntry[];
};

export const EMPTY_QUICK_ACTIONS: QuickActionsData = {
  customers: [],
  products: [],
  projects: [],
  orders: [],
  properties: [],
  users: [],
  currentOpenSession: null,
  salaryAgreements: [],
  scheduleEntries: [],
};
