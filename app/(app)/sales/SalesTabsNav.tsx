"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { DeliveryIcon, InventoryIcon, OrderIcon, SuccessIcon, TagIcon } from "@/components/ui/icons";
import type { IconComponent } from "@/components/ui/icons";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { CountBadge } from "@/components/ui/count-badge";
import { CountSkeleton } from "@/components/layout/loading-skeletons";

type SalesTab = "orders" | "closed" | "inventory" | "price-list" | "deliveries";

const tabs: Array<{ id: SalesTab; label: string; shortLabel?: string; icon: IconComponent }> = [
  { id: "orders", label: "הזמנות", icon: OrderIcon },
  { id: "closed", label: "הזמנות סגורות", shortLabel: "סגורות", icon: SuccessIcon },
  { id: "inventory", label: "מלאי", icon: InventoryIcon },
  { id: "price-list", label: "מחירון", icon: TagIcon },
  { id: "deliveries", label: "משלוחים", icon: DeliveryIcon },
];

type SalesTabsSearchParams = {
  tab?: string;
  customer_id?: string;
  customer_name?: string;
  customer_page?: string;
  ordersPage?: string;
  inventoryPage?: string;
  pricePage?: string;
  deliveriesPage?: string;
};

function buildTabHref(nextTab: SalesTab, searchParams: SalesTabsSearchParams) {
  const params = new URLSearchParams();

  if (nextTab !== "orders") {
    params.set("tab", nextTab);
  }

  if (searchParams.customer_id) params.set("customer_id", searchParams.customer_id);
  if (searchParams.customer_name) params.set("customer_name", searchParams.customer_name);
  if (searchParams.customer_page) params.set("customer_page", searchParams.customer_page);

  const query = params.toString();
  return query ? `/sales?${query}` : "/sales";
}

function getCount(tab: { id: SalesTab }, counts: Record<SalesTab, number>) {
  if (tab.id === "inventory" || tab.id === "price-list") return null;
  return counts[tab.id] ?? 0;
}

// Mirrors the "underline" TabsTrigger styling from components/ui/tabs.tsx so the
// sales tabs match the project / payroll / collections tab bars across the app:
// flat tabs with a primary-colored underline on the active one.
function triggerClassName(isActive: boolean) {
  const base =
    "-mb-px inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-t-md border-b-[3px] px-2 pb-2 pt-1 text-sm leading-tight ring-offset-background transition-colors hover:bg-muted/60 focus-visible:outline-none sm:text-base";

  return isActive
    ? `${base} border-primary font-bold text-primary`
    : `${base} border-transparent font-medium text-muted-foreground hover:text-foreground`;
}

// Inline flat tab row (underline style). The bottom border lives on the PARENT
// row (so the tabs sit on the same baseline as the "הזמנה חדשה" button);
// overflow-y-hidden stops overflow-x-auto from spawning a stray vertical
// scrollbar (the ▲▼ arrows). min-w-0 lets it shrink + scroll when space is tight.
const LIST_CLASSES =
  "flex min-w-0 items-center gap-2 overflow-x-auto overflow-y-hidden text-muted-foreground sm:gap-3";

/**
 * On a phone only three of the five tabs fit; the row now scrolls to the open
 * one (it stayed at the start, so on מחירון or משלוחים the underlined tab was
 * off the edge). Before paint, and the row only — never the page.
 */
function useOpenTabInView(listRef: RefObject<HTMLDivElement | null>, activeTab: SalesTab) {
  useLayoutEffect(() => {
    const list = listRef.current;
    const open = list?.querySelector<HTMLElement>("[data-open-tab]");
    if (!list || !open) return;
    const row = list.getBoundingClientRect();
    const tab = open.getBoundingClientRect();
    const margin = 8;
    if (tab.left < row.left) list.scrollLeft -= row.left - tab.left + margin;
    else if (tab.right > row.right) list.scrollLeft += tab.right - row.right + margin;
  }, [listRef, activeTab]);
}

export default function SalesTabsNav({
  activeTab,
  counts,
  searchParams,
}: {
  activeTab: SalesTab;
  counts: Record<SalesTab, number>;
  searchParams: SalesTabsSearchParams;
}) {
  const router = useRouter();
  const listRef = useRef<HTMLDivElement>(null);
  useOpenTabInView(listRef, activeTab);
  // One string (hrefs never contain a space), so the effect below re-runs when
  // the set of tabs changes rather than on every render.
  const otherTabHrefs = tabs
    .filter((tab) => tab.id !== activeTab)
    .map((tab) => buildTabHref(tab.id, searchParams))
    .join(" ");
  // The other tabs are fetched whole (data included) once the page is idle, so
  // switching shows them at once instead of waiting a second on the server; an
  // aged copy refreshes its list quietly once shown (useInfiniteScroll's
  // loadedAt). Once per visit to a tab, and by hand rather than with <Link
  // prefetch>: Next fetches every on-screen <Link prefetch> again after each
  // save that refreshes the page (router.refresh(), a revalidating action) —
  // four page loads per save here. A save now leaves the copies out of date
  // until the next tab switch, which loads normally and fetches the others
  // again (user, 2026-10-05: option B).
  useEffect(() => {
    const prefetchOtherTabs = () => {
      for (const href of otherTabHrefs.split(" ")) router.prefetch(href, { kind: PrefetchKind.FULL });
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(prefetchOtherTabs, { timeout: 2000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(prefetchOtherTabs, 300);
    return () => clearTimeout(timer);
  }, [router, otherTabHrefs]);

  return (
    <div ref={listRef} dir="rtl" className={LIST_CLASSES}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        const count = getCount(tab, counts);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.id}
            href={buildTabHref(tab.id, searchParams)}
            // Prefetched by hand above — see there for why not here.
            prefetch={false}
            aria-current={isActive ? "page" : undefined}
            data-open-tab={isActive ? "" : undefined}
            className={triggerClassName(isActive)}
            onClick={() => emitNavigationStart()}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="sm:hidden">{tab.shortLabel ?? tab.label}</span>
            <span className="hidden sm:inline">{tab.label}</span>
            {count !== null ? <CountBadge count={count} active={isActive} /> : null}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * The same tab row while the page loads (SalesSkeleton): the tabs' icons and
 * names, the open one underlined, a placeholder where each count will be.
 */
export function SalesTabsNavSkeleton({ activeTab }: { activeTab: SalesTab }) {
  // Scrolled the same way, so the row doesn't move when the page arrives.
  const listRef = useRef<HTMLDivElement>(null);
  useOpenTabInView(listRef, activeTab);
  return (
    <div ref={listRef} dir="rtl" className={LIST_CLASSES}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <span key={tab.id} data-open-tab={tab.id === activeTab ? "" : undefined} className={triggerClassName(tab.id === activeTab)}>
            <Icon className="h-4 w-4 shrink-0" />
            <span className="sm:hidden">{tab.shortLabel ?? tab.label}</span>
            <span className="hidden sm:inline">{tab.label}</span>
            {tab.id !== "inventory" && tab.id !== "price-list" ? <CountSkeleton /> : null}
          </span>
        );
      })}
    </div>
  );
}
