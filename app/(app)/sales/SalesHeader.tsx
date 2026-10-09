import type { ComponentProps } from "react";
import SalesTabsNav, { SalesTabsNavSkeleton } from "./SalesTabsNav";
import type { SalesTabCounts } from "./loadSalesCounts";

export type SalesTab = keyof SalesTabCounts;

// The tab bar sticks right under the top bar (60px) and the sticky block
// below it — the alert strip and, on a phone, the page's search strip —
// whose live height AppShell publishes as --page-sticky-h (it changes with
// the alert strip: none, one or two lines, opened).
const HEADER_CLASS =
  "sticky top-[calc(60px+var(--page-sticky-h,0px))] z-20 -mx-3 -mt-4 flex h-[52px] items-end justify-between gap-3 border-b border-border/60 bg-background px-3 md:-mx-6 md:mt-0 md:px-6 lg:-mx-8 lg:px-8";

/**
 * The /sales tab bar row: the tabs with their counts, and the customer the
 * page is for. Shared by the server page and its device version
 * (LocalSalesPage).
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
  return (
    <div className={HEADER_CLASS}>
      <SalesTabsNav activeTab={activeTab} counts={counts} searchParams={searchParams} />
      <div className="flex flex-wrap items-center gap-3 pb-2">
        {customerName ? <div className="text-base font-medium sm:text-lg">לקוח: {customerName}</div> : null}
        {/* No "הזמנה חדשה" button — the app's one quick-create + carries it. */}
      </div>
    </div>
  );
}

/** The tab bar row while the page loads (SalesSkeleton) — the same bar, the open tab underlined. */
export function SalesHeaderSkeleton({ activeTab }: { activeTab: SalesTab }) {
  return (
    <div className={HEADER_CLASS}>
      <SalesTabsNavSkeleton activeTab={activeTab} />
    </div>
  );
}
