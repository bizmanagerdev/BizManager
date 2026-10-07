import type { SupabaseClient } from "@supabase/supabase-js";
import { getScheduleEntries, type CalendarEntry } from "@/lib/projectSchedule";
import { getInboxView, todaySlice } from "@/lib/reminders/worklist";
import { getMyTasks, type DashboardTask } from "@/lib/dashboard/tasks-overview";
import { loadDeliveriesPage, type DeliveriesFilters, type DeliveryItem } from "@/app/(app)/sales/loadDeliveries";
import { loadOrdersPage, type OrdersFilters, type OrdersPaymentFilter } from "@/app/(app)/sales/loadOrders";
import { loadSalesTabCounts, type SalesTabCounts } from "@/app/(app)/sales/loadSalesCounts";
import type { InfinitePage } from "@/hooks/useInfiniteScroll";
import {
  loadInventoryListPage,
  loadPriceListPage,
  type InventoryListPageResult,
  type PriceListPageResult,
  type ProductsFilters,
} from "@/app/(app)/sales/loadProducts";
import { loadAttendanceSpark, loadDeliveriesSpark } from "@/lib/dashboard/sparklines";
import { loadPhoneQueueData, type PhoneQueueData } from "@/lib/attendance/phone-reports";
import { loadAttendanceClassificationOptions } from "@/lib/payroll-page-loader";
import { getPropertiesSummary, type PropertiesSummary } from "@/lib/properties";
import { loadProjectsPage, type ProjectsFilters } from "@/app/(app)/projects/loadProjects";
import {
  loadProjectsPickerOptions,
  loadProjectsTabCounts,
  type ProjectsPickerOptions,
  type ProjectsTabCounts,
} from "@/app/(app)/projects/loadProjectsPageData";
import {
  loadTaskPickerOptions,
  loadTasksBoard,
  type TaskBoardItem,
  type TaskPickerOptions,
  type TasksFilters,
} from "@/app/(app)/tasks/loadTasks";
import { loadOrderPageCore, type OrderPageCore } from "@/lib/orders/order-page";
import { israelDateKey } from "@/lib/timezone";
import type { Locale } from "@/lib/i18n/types";

// The page parts that can be worked out from the on-device copy, each with the
// SAME loader the server uses (run through createLocalSupabase): the
// dashboard's cards, the projects list, the sales tabs and the tasks board. Shared by the shadow check
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
  projectsList: { filters: ProjectsFilters; rows: Record<string, unknown>[]; hasMore: boolean; totalCount: number };
  /** /projects tab counts (for the page's customer) and the new-project dialog's lists. */
  projectsExtras: { filters: { customerId: string | null }; tabCounts: ProjectsTabCounts; options: ProjectsPickerOptions };
  /** /sales tabs, first page, for the given filters. */
  salesOrders: { filters: OrdersFilters; rows: Record<string, unknown>[]; hasMore: boolean };
  salesDeliveries: { filters: DeliveriesFilters; deliveries: DeliveryItem[]; hasMore: boolean };
  salesPriceList: { filters: ProductsFilters } & Pick<PriceListPageResult, "products" | "categories" | "hasMore">;
  salesInventory: { filters: ProductsFilters } & Pick<
    InventoryListPageResult,
    "items" | "movements" | "orderCustomerById" | "performerNameById" | "hasMore"
  >;
  /** /sales tab bar counts, for the page's customer and the closed tab's payment filter. */
  salesCounts: { filters: SalesCountsFilters; counts: SalesTabCounts };
  /** /tasks, the whole board for the given filters, and the task dialog's pickers. */
  tasksBoard: { filters: TasksFilters; items: TaskBoardItem[]; options: TaskPickerOptions };
  /**
   * An order's page (/sales/orders/<id>), all but what only the server reads
   * (its documents, photos and history). `order` null: not on this device's
   * copy (yet).
   */
  orderPage: OrderPageCore;
};

export type LocalCardKind = keyof LocalDashboardCards;

export type SalesCountsFilters = { customerId: string | null; paymentStatus: OrdersPaymentFilter };

export type LocalCardViewer = { userId: string; role: string; locale: Locale };

/** The device tables each card reads — it's worked out again when any changes. */
export const LOCAL_CARD_TABLES: Record<LocalCardKind, string[]> = {
  todaySchedule: ["tasks", "projects", "orders", "order_delivery_recipients", "reminders", "customers", "users", "user_directory"],
  todayAlerts: ["reminders", "customers", "tasks", "users", "user_directory"],
  myTasks: ["tasks", "task_members", "projects", "reminders"],
  deliveries: ["orders", "customers", "customer_branches", "order_items", "products", "inventory", "payments"],
  attendanceQueue: ["phone_attendance_reports", "users", "user_directory", "attendance_sessions", "projects", "properties", "property_directory"],
  properties: ["properties", "property_directory", "lease_agreements", "customers"],
  projectsList: [
    "projects", "customers", "users", "user_directory", "tasks", "payments", "expenses", "project_expenses", "attendance_sessions",
    "payslips", "payroll_periods", "salary_agreements", "worker_payments", "worker_payment_allocations",
  ],
  projectsExtras: ["projects", "users", "user_directory", "customers"],
  salesOrders: ["orders", "customers", "users", "user_directory", "customer_branches", "payments", "order_items", "products", "inventory"],
  salesDeliveries: ["orders", "customers", "customer_branches", "order_items", "products", "inventory", "payments"],
  salesPriceList: ["products", "inventory", "inventory_movements", "product_categories"],
  salesInventory: ["products", "inventory", "inventory_movements", "product_categories", "orders", "customers", "users", "user_directory"],
  salesCounts: ["orders", "products", "payments", "customers", "customer_branches"],
  tasksBoard: [
    "tasks", "task_members", "users", "user_directory", "projects", "customers", "properties", "property_directory", "task_comments", "reminders", "document_links",
  ],
  orderPage: ["orders", "order_items", "payments", "customers", "customer_branches", "products", "inventory", "users", "user_directory"],
};

export async function computeLocalCard<K extends LocalCardKind>(
  local: SupabaseClient,
  kind: K,
  { userId, role, locale }: LocalCardViewer,
  /** The list's filters, for the projects list, the sales tabs and the tasks board. */
  filters?: unknown
): Promise<LocalDashboardCards[K]> {
  const need = <F,>(): F => {
    if (!filters) throw new Error(`${String(kind)} needs its filters`);
    return filters as F;
  };
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
      const projectFilters = need<ProjectsFilters>();
      const result = await loadProjectsPage(local, { page: 1, filters: projectFilters });
      if (result.error) throw new Error(result.error);
      return {
        filters: projectFilters,
        rows: result.rows,
        hasMore: result.hasMore,
        totalCount: result.totalCount,
      } as LocalDashboardCards[K];
    }
    case "projectsExtras": {
      const { customerId } = need<{ customerId: string | null }>();
      const [tabCounts, options] = await Promise.all([loadProjectsTabCounts(local, customerId), loadProjectsPickerOptions(local)]);
      return { filters: { customerId }, tabCounts, options } as LocalDashboardCards[K];
    }
    case "salesOrders": {
      const orderFilters = need<OrdersFilters>();
      const result = await loadOrdersPage(local, { page: 1, filters: orderFilters });
      if (result.error) throw new Error(result.error);
      return { filters: orderFilters, rows: result.rows, hasMore: result.hasMore } as LocalDashboardCards[K];
    }
    case "salesDeliveries": {
      const deliveryFilters = need<DeliveriesFilters>();
      const result = await loadDeliveriesPage(local, { page: 1, filters: deliveryFilters });
      if (result.error) throw new Error(result.error);
      return { filters: deliveryFilters, deliveries: result.deliveries, hasMore: result.hasMore } as LocalDashboardCards[K];
    }
    case "salesPriceList": {
      const productFilters = need<ProductsFilters>();
      const result = await loadPriceListPage(local, { page: 1, filters: productFilters });
      if (result.error) throw new Error(result.error);
      const { products, categories, hasMore } = result;
      return { filters: productFilters, products, categories, hasMore } as LocalDashboardCards[K];
    }
    case "salesInventory": {
      const productFilters = need<ProductsFilters>();
      const result = await loadInventoryListPage(local, { page: 1, filters: productFilters });
      if (result.error) throw new Error(result.error);
      const { items, movements, orderCustomerById, performerNameById, hasMore } = result;
      return { filters: productFilters, items, movements, orderCustomerById, performerNameById, hasMore } as LocalDashboardCards[K];
    }
    case "salesCounts": {
      const countFilters = need<SalesCountsFilters>();
      return { filters: countFilters, counts: await loadSalesTabCounts(local, countFilters) } as LocalDashboardCards[K];
    }
    case "tasksBoard": {
      const taskFilters = need<TasksFilters>();
      const canSeeAll = role === "admin" || role === "office";
      const [result, options] = await Promise.all([
        loadTasksBoard(local, { filters: taskFilters, userId, canSeeAll, locale }),
        loadTaskPickerOptions(local),
      ]);
      if (result.error) throw new Error(result.error);
      return { filters: taskFilters, items: result.items, options } as LocalDashboardCards[K];
    }
    case "orderPage": {
      const { id } = need<{ id: string }>();
      const core = await loadOrderPageCore(local, id);
      // A read the device couldn't do: the server version shows it instead.
      const failed = Object.entries(core.errors).find(([, message]) => message);
      if (failed) throw new Error(`${failed[0]}: ${failed[1]}`);
      return core as LocalDashboardCards[K];
    }
    default:
      throw new Error(`Unknown dashboard card ${String(kind)}`);
  }
}

/** The lists whose further pages the device serves as you scroll. */
export type LocalPagedKind = "projectsList" | "salesOrders" | "salesDeliveries" | "salesPriceList" | "salesInventory";

/**
 * Page `page` (1-based) of a paged list, from the device copy — the rows the
 * list's own "load more" (a server action) would have returned.
 */
export async function computeLocalListPage(
  local: SupabaseClient,
  kind: LocalPagedKind,
  filters: unknown,
  page: number
): Promise<InfinitePage<unknown>> {
  const read = async <R extends { error: string | null; hasMore: boolean }>(result: Promise<R>, rows: (r: R) => unknown[]) => {
    const r = await result;
    if (r.error) throw new Error(r.error);
    return { rows: rows(r), hasMore: r.hasMore };
  };
  switch (kind) {
    case "projectsList":
      return read(loadProjectsPage(local, { page, filters: filters as ProjectsFilters }), (r) => r.rows);
    case "salesOrders":
      return read(loadOrdersPage(local, { page, filters: filters as OrdersFilters }), (r) => r.rows);
    case "salesDeliveries":
      return read(loadDeliveriesPage(local, { page, filters: filters as DeliveriesFilters }), (r) => r.deliveries);
    case "salesPriceList":
      return read(loadPriceListPage(local, { page, filters: filters as ProductsFilters }), (r) => r.products);
    case "salesInventory":
      return read(loadInventoryListPage(local, { page, filters: filters as ProductsFilters }), (r) => r.items);
  }
}
