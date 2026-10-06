import type { SupabaseClient } from "@supabase/supabase-js";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import { deviceCheckCookie } from "@/lib/powersync/device-check";
import type { DashboardShadowCards } from "@/lib/powersync/dashboard-shadow";
import { withLoadedAt } from "@/lib/loaded-at";
import { israelDateKey } from "@/lib/timezone";
import type { Locale } from "@/lib/i18n/types";
import { loadDeliveriesPage } from "./loadDeliveries";
import { loadOrdersPage, type OrdersInvoiceFilter, type OrdersPaymentFilter } from "./loadOrders";
import { loadInventoryListPage, loadPriceListPage } from "./loadProducts";
import { loadSalesTabCounts } from "./loadSalesCounts";
import type { SalesTab } from "./SalesHeader";

/**
 * The open sales tab and the tab counts as the server reads them, for the
 * device to compare with its own (once a day per device —
 * lib/powersync/device-check.ts). Rendered in a Suspense boundary after the
 * page, so it never holds the page up. The same cards the server version's
 * own check sends.
 */
export default async function SalesServerCheck({
  supabase,
  activeTab,
  customerId,
  category,
  paymentStatus,
  invoice,
  userId,
  role,
  locale,
}: {
  supabase: SupabaseClient;
  activeTab: SalesTab;
  customerId: string | null;
  category: string;
  paymentStatus: OrdersPaymentFilter;
  invoice: OrdersInvoiceFilter;
  userId: string;
  role: string;
  locale: Locale;
}) {
  const countsPromise = loadSalesTabCounts(supabase, { customerId, paymentStatus });
  let cards: DashboardShadowCards | null = null;
  let readAt = 0;
  if (activeTab === "orders" || activeTab === "closed") {
    const filters = { tab: activeTab, customerId, q: "", paymentStatus, invoice };
    const { rows, hasMore, error, loadedAt } = await withLoadedAt(loadOrdersPage(supabase, { page: 1, filters }));
    if (!error) {
      readAt = loadedAt;
      cards = { salesOrders: { filters, rows, hasMore } };
    }
  } else if (activeTab === "price-list") {
    const filters = { q: "", category };
    const { products, categories, hasMore, error, loadedAt } = await withLoadedAt(
      loadPriceListPage(supabase, { page: 1, filters })
    );
    if (!error) {
      readAt = loadedAt;
      cards = { salesPriceList: { filters, products, categories, hasMore } };
    }
  } else if (activeTab === "inventory") {
    const filters = { q: "", category };
    const { items, movements, orderCustomerById, performerNameById, hasMore, error, loadedAt } = await withLoadedAt(
      loadInventoryListPage(supabase, { page: 1, filters })
    );
    if (!error) {
      readAt = loadedAt;
      cards = { salesInventory: { filters, items, movements, orderCustomerById, performerNameById, hasMore } };
    }
  } else {
    const filters = { customerId };
    const { deliveries, hasMore, error, loadedAt } = await withLoadedAt(loadDeliveriesPage(supabase, { page: 1, filters }));
    if (!error) {
      readAt = loadedAt;
      cards = { salesDeliveries: { filters, deliveries, hasMore } };
    }
  }
  if (!cards) return null;
  const counts = await countsPromise;
  return (
    <DashboardLocalShadow
      doneCookie={deviceCheckCookie("sales")}
      snapshot={{
        renderedAt: new Date(readAt).toISOString(),
        userId,
        role,
        locale,
        todayIso: israelDateKey(),
        cards: { ...cards, salesCounts: { filters: { customerId, paymentStatus }, counts } },
      }}
    />
  );
}
