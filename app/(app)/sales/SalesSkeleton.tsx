"use client";

import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveDataView } from "@/components/ui/responsive-data-view";
import { Skeleton } from "@/components/ui/skeleton";
import { PlainTableSkeleton, TableSkeleton, TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { PageHeaderToolbarSkeleton } from "@/components/layout/PageHeaderToolbarSkeleton";
import { DELIVERY_REGIONS } from "@/lib/ui/cities";
import { cn } from "@/lib/utils";
import { SalesHeaderSkeleton, type SalesTab } from "./SalesHeader";

// The sales page's placeholder: its tab bar (SalesHeader's — sticky,
// full-bleed, underlined, flush with the top on a phone) and the open tab's
// own shape, from the tab's own classes: the orders' table from xl and swipe
// cards below it, the inventory's titled card, the price list's toolbar and
// list, the deliveries' region pills and stop cards. Shown while the page
// streams (loading.tsx), while the device version works the open tab out
// (LocalSalesPage) and while a tab's code loads (the dynamic() fallbacks).

function tabOf(value: string | null): SalesTab {
  return value === "closed" || value === "inventory" || value === "price-list" || value === "deliveries" ? value : "orders";
}

export default function SalesSkeleton({ tab }: { tab?: SalesTab }) {
  const searchParams = useSearchParams();
  const activeTab = tab ?? tabOf(searchParams.get("tab"));
  return (
    <>
      <SalesHeaderSkeleton activeTab={activeTab} />
      <SalesTabSkeleton tab={activeTab} />
    </>
  );
}

/**
 * The phone's header strip while a tab loads, holding what that tab puts
 * there: its search (orders, closed, stock), the price list's add / search /
 * filter row, the deliveries' region pills.
 */
export function SalesStripSkeleton({ tab }: { tab: SalesTab }) {
  if (tab === "price-list") {
    return (
      <PageHeaderToolbarSkeleton>
        <Skeleton className="h-10 w-16 shrink-0 rounded-xl" />
        <Skeleton className="h-10 w-full max-w-[13rem] rounded-xl" />
        <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
      </PageHeaderToolbarSkeleton>
    );
  }
  if (tab === "deliveries") {
    return (
      <PageHeaderToolbarSkeleton className="justify-start overflow-hidden">
        {["הכל", ...DELIVERY_REGIONS].map((label) => (
          <span key={label} className="shrink-0 rounded-full border border-border bg-background px-3 py-1 text-sm text-muted-foreground">
            {label}
          </span>
        ))}
        <Skeleton className="h-8 w-8 shrink-0" />
      </PageHeaderToolbarSkeleton>
    );
  }
  return <PageHeaderToolbarSkeleton />;
}

/** The open tab's own placeholder, under the tab bar. */
export function SalesTabSkeleton({ tab }: { tab: SalesTab }) {
  if (tab === "inventory") return <InventorySkeleton />;
  if (tab === "price-list") return <PriceListSkeleton />;
  if (tab === "deliveries") return <DeliveriesSkeleton />;
  return <OrdersSkeleton />;
}

// The "showing N of M" line under every list.
const LIST_FOOTER = <TextLineSkeleton className="pt-3 text-center text-xs" barClassName="w-28" />;

const ORDER_COLUMNS = ["לקוח", "עיר ותאריך", "מוצרים", "הערות ותגובות", "סטטוס הזמנה", "חשבונית", "סטטוס תשלום", "סכום", "פעולות"];

// SalesOrdersClient: the xl search and count line, then the table from xl,
// swipe cards below it.
function OrdersSkeleton() {
  return (
    <div className="space-y-4">
      <div className="hidden xl:block">
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
      <div className="hidden h-5 items-center xl:flex">
        <Skeleton className="h-3.5 w-28" />
      </div>
      <div className="relative">
        <ResponsiveDataView
          breakpoint="xl"
          desktop={<TableSkeleton headers={ORDER_COLUMNS} rows={4} rowClassName="h-[10rem]" />}
          mobile={
            <div className="grid grid-cols-1 gap-2">
              <p className="px-1 text-[11px] text-muted-foreground">החלק כרטיס ימינה לפעולות · הקש לפתיחה</p>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-background shadow-sm">
                  <div className="divide-y divide-border/60 p-3 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0 [&>*]:py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Skeleton className="h-4 w-36" />
                        <Skeleton className="h-3 w-44" />
                      </div>
                      <Skeleton className="h-2.5 w-10" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-5 w-16" />
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </div>
                    <div className="flex gap-1.5">
                      <Skeleton className="h-6 w-20 rounded-full" />
                      <Skeleton className="h-6 w-16 rounded-full" />
                    </div>
                    <div>
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-7 w-24 rounded-full" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          }
        />
        {LIST_FOOTER}
      </div>
    </div>
  );
}

// A product line's phone card (the inventory's and the price list's): name and
// code, the figures line, and — price list — its buttons.
function ProductCardSkeleton({ actions = false }: { actions?: boolean }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-background p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className={cn("shrink-0", actions ? "h-4 w-14" : "h-8 w-8 rounded-lg")} />
      </div>
      <div className="mt-2 flex gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-12" />
        ))}
      </div>
      {actions ? (
        <div className="mt-2 flex justify-end gap-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-9" />
        </div>
      ) : null}
    </div>
  );
}

// SalesInventoryClient: the "stock by product" card — its title and (md+)
// search in the header, the table from xl, product cards below it — and the
// stock movements card under it.
function InventorySkeleton() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">רמות מלאי לפי מוצר</CardTitle>
            <Skeleton className="hidden h-10 w-full sm:max-w-xs md:block" />
          </div>
        </CardHeader>
        <CardContent>
          <PlainTableSkeleton
            headers={["מוצר", "מק״ט", "במלאי", "שמור", "זמין", "נמכר", "פעולות"]}
            rows={10}
            className="hidden max-h-[70vh] overflow-hidden rounded-md border xl:block"
            rowClassName="h-[3.0625rem]"
          />
          <div className="grid grid-cols-1 gap-2 xl:hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
          {LIST_FOOTER}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-2">
            <CardTitle className="text-base">תנועות מלאי</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-9 w-full rounded-lg" />
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

// PriceListClient: the md+ toolbar (search, category, share, add), the table
// from xl, product cards below it.
function PriceListSkeleton() {
  return (
    <div className="space-y-3">
      <div className="hidden md:flex md:flex-col md:gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Skeleton className="h-11 w-full rounded-xl sm:w-56" />
          <Skeleton className="h-11 rounded-xl sm:w-56" />
        </div>
        <div className="grid grid-cols-2 gap-2 lg:flex lg:items-center">
          <Skeleton className="h-11 lg:h-10 lg:w-36" />
          <Skeleton className="h-11 lg:h-10 lg:w-28" />
        </div>
      </div>
      <PlainTableSkeleton
        headers={["מוצר", "קוד", "מחיר", "עלות בסיס", "מלאי נוכחי", "כמות שנרכשה", "כמות שנמכרה", "סטטוס", "פעולות"]}
        rows={10}
        className="hidden max-h-[70vh] overflow-hidden rounded-md border xl:block"
        rowClassName="h-[3.0625rem]"
      />
      <div className="grid grid-cols-1 gap-2 xl:hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <ProductCardSkeleton key={i} actions />
        ))}
      </div>
      {LIST_FOOTER}
    </div>
  );
}

// SalesDeliveriesQueue: the md+ region pills (on a phone they're in the
// header strip), then the region table from xl and stop cards below it.
function DeliveriesSkeleton() {
  const searchParams = useSearchParams();
  const region = searchParams.get("region");
  const pills = ["הכל", ...DELIVERY_REGIONS];
  return (
    <div className="space-y-3">
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        {pills.map((label) => {
          const active = label === "הכל" ? !region : region === label;
          return (
            <span
              key={label}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"
              )}
            >
              {label}
            </span>
          );
        })}
        <Skeleton className="h-9 w-32" />
        <Skeleton className="mr-auto h-3 w-20" />
      </div>
      <ResponsiveDataView
        breakpoint="xl"
        desktop={
          <TableSkeleton
            headers={["לקוח", "עיר", "כתובת", "מוצרים", "סכום", "פעולות"]}
            rows={6}
            cellClassName="px-4 py-3"
            rowClassName="h-[6.5rem]"
            maxHeight="75vh"
          />
        }
        mobile={
          <div className="space-y-2">
            {/* A city's heading, then its stops: where (Waze, address, customer),
                who to call, the delivery — its money, items and buttons. */}
            <div className="flex h-6 items-center justify-between gap-2 px-1">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-3 w-14" />
            </div>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="flex items-start gap-3 p-3">
                  <Skeleton className="h-11 w-10 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
                <div className="border-t border-border/60 p-3">
                  <Skeleton className="h-[3.25rem] w-full rounded-xl" />
                </div>
                <div className="divide-y divide-border/60 border-t border-border/60">
                  <div className="flex items-center gap-2 p-3">
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-6 w-20 rounded-full" />
                  </div>
                  <div className="flex gap-1 p-3">
                    <Skeleton className="h-6 w-20 rounded-full" />
                    <Skeleton className="h-6 w-16 rounded-full" />
                    <Skeleton className="h-6 w-14 rounded-full" />
                  </div>
                  <div className="flex items-center gap-2 p-3">
                    <Skeleton className="h-9 flex-1 rounded-xl" />
                    <Skeleton className="h-9 w-9 rounded-xl" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        }
      />
      <TextLineSkeleton className="pt-1 text-center text-xs" barClassName="w-24" />
    </div>
  );
}
