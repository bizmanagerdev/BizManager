import type { SupabaseClient } from "@supabase/supabase-js";
import { getScheduleEntries, type CalendarEntry } from "@/lib/projectSchedule";
import { getInboxView, todaySlice } from "@/lib/reminders/worklist";
import { getMyTasks, type DashboardTask } from "@/lib/dashboard/tasks-overview";
import { loadDeliveriesPage, type DeliveryItem } from "@/app/(app)/sales/loadDeliveries";
import { loadAttendanceSpark, loadDeliveriesSpark } from "@/lib/dashboard/sparklines";
import { loadPhoneQueueData, type PhoneQueueData } from "@/lib/attendance/phone-reports";
import { loadAttendanceClassificationOptions } from "@/lib/payroll-page-loader";
import { getPropertiesSummary, type PropertiesSummary } from "@/lib/properties";
import { loadProjectsPage, type ProjectsFilters } from "@/app/(app)/projects/loadProjects";
import { israelDateKey } from "@/lib/timezone";
import type { Locale } from "@/lib/i18n/types";

// The page parts that can be worked out from the on-device copy, each with the
// SAME loader the server uses (run through createLocalSupabase): the
// dashboard's cards, and the projects list. Shared by the shadow check
// (dashboard-shadow.ts) and the device version of the board
// (components/powersync/LocalDashboardCard.tsx), so the two can't drift apart.

export type LocalDashboardCards = {
  todaySchedule: CalendarEntry[];
  todayAlerts: ReturnType<typeof todaySlice>;
  myTasks: DashboardTask[];
  deliveries: { items: DeliveryItem[]; spark: number[] };
  attendanceQueue: {
    data: PhoneQueueData;
    spark: number[];
    options: Awaited<ReturnType<typeof loadAttendanceClassificationOptions>> | null;
  };
  properties: PropertiesSummary;
  /** /projects, first page, for the given filters. */
  projectsList: { filters: ProjectsFilters; rows: Record<string, unknown>[]; hasMore: boolean };
};

export type LocalCardKind = keyof LocalDashboardCards;

export type LocalCardViewer = { userId: string; role: string; locale: Locale };

/** The device tables each card reads — it's worked out again when any changes. */
export const LOCAL_CARD_TABLES: Record<LocalCardKind, string[]> = {
  todaySchedule: ["tasks", "projects", "orders", "order_delivery_recipients", "reminders", "customers", "users"],
  todayAlerts: ["reminders", "customers", "tasks", "users"],
  myTasks: ["tasks", "task_members", "projects", "reminders"],
  deliveries: ["orders", "customers", "customer_branches", "order_items", "products", "inventory", "payments"],
  attendanceQueue: ["phone_attendance_reports", "users", "attendance_sessions", "projects", "properties"],
  properties: ["properties", "lease_agreements", "customers"],
  projectsList: [
    "projects", "customers", "users", "tasks", "payments", "expenses", "project_expenses", "attendance_sessions",
    "payslips", "payroll_periods", "salary_agreements", "worker_payments", "worker_payment_allocations",
  ],
};

export async function computeLocalCard<K extends LocalCardKind>(
  local: SupabaseClient,
  kind: K,
  { userId, role, locale }: LocalCardViewer,
  /** projectsList: the list's filters. */
  filters?: ProjectsFilters
): Promise<LocalDashboardCards[K]> {
  switch (kind) {
    case "todaySchedule":
      return (await getScheduleEntries(local, { scope: "mine", userId })) as LocalDashboardCards[K];
    case "todayAlerts":
      return todaySlice(await getInboxView(local, { userId, role })) as LocalDashboardCards[K];
    case "myTasks":
      return (await getMyTasks(local, userId, locale)) as LocalDashboardCards[K];
    case "deliveries": {
      const [page, spark] = await Promise.all([
        loadDeliveriesPage(local, { page: 1, filters: { customerId: null } }),
        loadDeliveriesSpark(local),
      ]);
      if (page.error) throw new Error(page.error);
      return { items: page.deliveries, spark } as LocalDashboardCards[K];
    }
    case "attendanceQueue": {
      const [data, spark, options] = await Promise.all([
        loadPhoneQueueData(local),
        loadAttendanceSpark(local),
        loadAttendanceClassificationOptions(local),
      ]);
      return { data, spark, options } as LocalDashboardCards[K];
    }
    case "properties":
      return (await getPropertiesSummary(local, israelDateKey())) as LocalDashboardCards[K];
    case "projectsList": {
      if (!filters) throw new Error("projectsList needs its filters");
      const result = await loadProjectsPage(local, { page: 1, filters });
      if (result.error) throw new Error(result.error);
      return { filters, rows: result.rows, hasMore: result.hasMore } as LocalDashboardCards[K];
    }
    default:
      throw new Error(`Unknown dashboard card ${String(kind)}`);
  }
}
