// Neutral (client- and server-safe) types/constants for the quick-action data.
// Kept out of quick-actions-data.ts (which is `server-only`) so the client wrapper
// can import the shape + empty default without pulling server code into the bundle.
import type { CalendarEntry } from "@/lib/projectSchedule";
import type { SalaryAgreementRow } from "@/lib/payroll";
import type {
  ProjectOption,
  EntityOption,
  UserOption,
  OpenSessionInfo,
} from "@/app/dashboard/DashboardActions";

type Row = Record<string, unknown>;

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
