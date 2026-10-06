import type { ComponentProps } from "react";
import InventoryRealtimeBadge from "./InventoryRealtimeBadge";
import SalesTabsNav from "./SalesTabsNav";
import type { SalesTabCounts } from "./loadSalesCounts";

export type SalesTab = keyof SalesTabCounts;

/**
 * The /sales tab bar row: the tabs with their counts, the customer the page
 * is for, the stock tab's live badge. Shared by the server page and its
 * device version (LocalSalesPage).
 */
export default function SalesHeader({
  activeTab,
  counts,
  searchParams,
  customerName,
}: {
  activeTab: SalesTab;
  counts: SalesTabCounts;
  searchParams: ComponentProps<typeof SalesTabsNav>["searchParams"];
  customerName: string | null;
}) {
  // Orders/closed/price-list tabs mount a 52px mobile search toolbar into the
  // dark header (sticky at top-[60px], just under the 60px top bar); the tab bar
  // must sit BELOW it there (top-[112px] = 60 + 52). Desktop hides that toolbar
  // (md:hidden), and inventory/deliveries never mount it, so those stick
  // directly under the 60px top bar.
  const hasMobileToolbar = activeTab === "orders" || activeTab === "closed" || activeTab === "price-list";
  const tabsStickyTop = hasMobileToolbar ? "top-[112px] md:top-[60px]" : "top-[60px]";

  return (
    <div className={`sticky ${tabsStickyTop} z-20 -mx-3 -mt-4 flex h-[52px] items-end justify-between gap-3 border-b border-border/60 bg-background px-3 md:-mx-6 md:mt-0 md:px-6 lg:-mx-8 lg:px-8`}>
      <SalesTabsNav activeTab={activeTab} counts={counts} searchParams={searchParams} />
      <div className="flex flex-wrap items-center gap-3 pb-2">
        {customerName ? <div className="text-base font-medium sm:text-lg">לקוח: {customerName}</div> : null}
        {activeTab === "inventory" ? <InventoryRealtimeBadge /> : null}
        {/* No "הזמנה חדשה" button — the app's one quick-create + carries it. */}
      </div>
    </div>
  );
}
