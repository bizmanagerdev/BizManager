// Shared shapes for the top-bar quick-create (+) menu. Kept in their own module
// so the menu (always in the bundle) and the dialogs (dynamically imported) can
// both import them without the menu pulling the dialogs in.

import type { QuickActionsData } from "@/app/(app)/dashboard/quick-actions-types";
import type { UserRole } from "@/lib/auth/requireProfile";

/** The create flows offered by the + menu, in the order they're listed. */
export const QUICK_CREATE_ACTIONS = [
  "task",
  "expense",
  "income",
  "order",
  "project",
  "collect",
  "transfer",
  "attendance",
  "customer",
  "reminder",
  "document",
  "workerPayment",
  "manualSession",
] as const;

export type QuickCreateAction = (typeof QUICK_CREATE_ACTIONS)[number];

/** Picker data + who's asking — exactly what /api/quick-actions/data returns. */
export type QuickCreateData = QuickActionsData & {
  currentUserId: string | null;
  role: UserRole | null;
};

export const EMPTY_QUICK_CREATE_DATA: QuickCreateData = {
  customers: [],
  products: [],
  projects: [],
  orders: [],
  properties: [],
  users: [],
  currentOpenSession: null,
  salaryAgreements: [],
  scheduleEntries: [],
  currentUserId: null,
  role: null,
};
