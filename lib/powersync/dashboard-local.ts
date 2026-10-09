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
import { loadProjectPageCore, type ProjectPageCore } from "@/lib/projects/project-page";
import { getCollectionsSummary, type CollectionsSummary } from "@/lib/collections";
import {
  buildDomainChartData,
  buildPaymentsSummary,
  getBooksStartDate,
  loadDomainChartBreakdowns,
  loadMoneyCardEntries,
  loadPaymentLeadRows,
  loadPaymentsCalendar,
  moneyCardDates,
  type DomainChartData,
} from "@/lib/dashboard/money-cards";
import type { PaymentsSummary } from "@/components/dashboard/UpcomingPayments";
import { copyHasMoneyTables } from "@/lib/powersync/money-copy";
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
  /**
   * A project's page (/projects/<id>), all but what only the server reads
   * (its documents and files, Morning documents, the change log, history).
   * `dashboardRow` null: not on this device's copy (yet).
   */
  projectPage: ProjectPageCore;
  /** The dashboard's money cards (lib/dashboard/money-cards.ts) — only from a copy with sync rules v1.8. */
  payments: PaymentsSummary;
  collections: CollectionsSummary;
  /** null: nothing moved this month (the card isn't shown). */
  domainChart: DomainChartData | null;
};

export type LocalCardKind = keyof LocalDashboardCards;

export type SalesCountsFilters = { customerId: string | null; paymentStatus: OrdersPaymentFilter };

export type LocalCardViewer = { userId: string; role: string; locale: Locale };

/** What the money cards read: the financial engine's tables, the money views' and the cards' own. */
const MONEY_TABLES = [
  "payments", "expenses", "project_expenses", "worker_payments", "worker_payment_allocations", "attendance_sessions",
  "payslips", "payroll_periods", "salary_agreements", "projects", "orders", "customers", "users", "user_directory",
  "loans", "loan_repayments", "recurring_expense_templates", "outflow_source_settings", "card_settlement_confirmations",
  "card_statement_charges", "card_statement_rows", "business_settings",
];

/** The device tables each card reads — it's worked out again when any changes. */
export const LOCAL_CARD_TABLES: Record<LocalCardKind, string[]> = {
  todaySchedule: ["tasks", "projects", "orders", "order_delivery_recipients", "reminders", "customers", "users", "user_directory", "task_snoozes"],
  todayAlerts: ["reminders", "customers", "tasks", "users", "user_directory"],
  myTasks: ["tasks", "task_members", "projects", "reminders", "task_snoozes"],
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
    "task_snoozes",
  ],
  orderPage: ["orders", "order_items", "payments", "customers", "customer_branches", "products", "inventory", "users", "user_directory"],
  projectPage: [
    "projects", "customers", "customer_branches", "users", "user_directory", "tasks", "project_expenses", "expenses",
    "attendance_sessions", "payments", "payslips", "payroll_periods", "salary_agreements", "worker_payments",
    "worker_payment_allocations", "accounts", "business_settings", "recurring_expense_templates",
  ],
  payments: MONEY_TABLES,
  collections: MONEY_TABLES,
  domainChart: MONEY_TABLES,
};

/**
 * The money cards' loaders treat a read that failed as "nothing there" — on
 * the server a rare outage, on the device a table or column this copy doesn't
 * have — and a figure would then silently leave out a loan or a card charge.
 * So on the device every read must succeed: this hands the loaders a client
 * that notes each failed read, and the card is then refused (the server's
 * version shows instead) rather than drawn with a gap in it.
 */
function strictReads(local: SupabaseClient): { client: SupabaseClient; failures: string[] } {
  const failures: string[] = [];
  const watch = (query: object, source: string): object => {
    const proxy: object = new Proxy(query, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop, target);
        if (typeof value !== "function") return value;
        if (prop === "then") {
          return (onFulfilled?: (result: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
            (value as (inspect: (result: unknown) => unknown) => Promise<unknown>)
              .call(target, (result: unknown) => {
                const { error, status } = (result ?? {}) as { error?: { message?: string } | null; status?: number };
                // 4xx answers (e.g. single() finding no row) are the same on the
                // server; only a read the device couldn't do counts.
                if (error && (status ?? 500) >= 500) failures.push(`${source}: ${error.message ?? "failed"}`);
                return result;
              })
              .then(onFulfilled, (reason: unknown) => {
                failures.push(`${source}: ${reason instanceof Error ? reason.message : String(reason)}`);
                if (onRejected) return onRejected(reason);
                throw reason;
              });
        }
        // The builder's own methods hand back the builder: keep watching it.
        return (...args: unknown[]) => {
          const next = (value as (...a: unknown[]) => unknown).apply(target, args);
          return next === target ? proxy : next;
        };
      },
    });
    return proxy;
  };
  const client = {
    from: (name: string) => watch(local.from(name) as object, name),
    rpc: (name: string, args?: Record<string, unknown>) => watch(local.rpc(name, args) as object, `rpc ${name}`),
  };
  return { client: client as unknown as SupabaseClient, failures };
}

/** A money card from the device, all its reads done — or refused (see strictReads). */
async function computeMoneyCard(local: SupabaseClient, kind: "payments" | "collections" | "domainChart"): Promise<unknown> {
  // A copy synced before the money tables existed would read as "no loans,
  // no card charges": not this card's to draw (lib/powersync/money-copy.ts).
  if (!(await copyHasMoneyTables(local))) throw new Error(`${MONEY_CARD_NOT_READY} (sync rules before v1.8)`);
  const { client, failures } = strictReads(local);
  const todayIso = israelDateKey();
  const dates = moneyCardDates(todayIso);
  let card: unknown;
  switch (kind) {
    case "payments": {
      const shared = await loadMoneyCardEntries(client, dates);
      const [calendar, leadRows] = await Promise.all([loadPaymentsCalendar(client, shared), loadPaymentLeadRows(client)]);
      card = buildPaymentsSummary(calendar, leadRows, todayIso);
      break;
    }
    case "collections":
      card = await getCollectionsSummary(client, todayIso);
      break;
    case "domainChart": {
      const [shared, booksStartDate] = await Promise.all([loadMoneyCardEntries(client, dates), getBooksStartDate(client)]);
      card = buildDomainChartData(await loadDomainChartBreakdowns(client, dates, shared.entries, booksStartDate), dates, booksStartDate);
      break;
    }
  }
  if (failures.length) throw new Error(`${kind}: a read failed on the device — ${failures[0]}`);
  return card;
}

/** The start of the error a money card gives on a copy without the money tables (not a difference to report). */
export const MONEY_CARD_NOT_READY = "money cards: this copy has no money tables yet";

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
    case "projectPage": {
      const { id } = need<{ id: string }>();
      // A copy without the business settings' row doesn't have what this
      // page needs yet (sync rules v1.7): the server version, rather than a
      // page with the default VAT rate and unnamed accounts.
      const { data: settings } = await local.from("business_settings").select("vat_rate").limit(1);
      if (!Array.isArray(settings) || settings.length === 0) throw new Error("projectPage: this copy has no business settings (sync rules before v1.7)");
      const core = await loadProjectPageCore(local, id);
      const failed = Object.entries(core.errors).find(([, message]) => message);
      if (failed) throw new Error(`${failed[0]}: ${failed[1]}`);
      return core as LocalDashboardCards[K];
    }
    case "payments":
    case "collections":
    case "domainChart":
      return (await computeMoneyCard(local, kind)) as LocalDashboardCards[K];
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
