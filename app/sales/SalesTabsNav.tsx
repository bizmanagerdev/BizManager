"use client";

import Link from "next/link";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";

type SalesTab = "orders" | "closed" | "inventory" | "price-list" | "deliveries";

const tabs: Array<{ id: SalesTab; label: string; shortLabel?: string }> = [
  { id: "orders", label: "הזמנות" },
  { id: "closed", label: "הזמנות סגורות", shortLabel: "סגורות" },
  { id: "inventory", label: "מלאי" },
  { id: "price-list", label: "מחירון" },
  { id: "deliveries", label: "משלוחים" },
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

function getCountSuffix(tab: { id: SalesTab }, counts: Record<SalesTab, number>) {
  if (tab.id === "inventory" || tab.id === "price-list" || tab.id === "closed") return "";
  return ` (${counts[tab.id] ?? 0})`;
}

// Mirrors the Radix TabsTrigger styling from components/ui/tabs.tsx so sales
// tabs look identical to project / payroll / financial tabs across the app.
function triggerClassName(isActive: boolean) {
  const base =
    "inline-flex min-w-0 items-center justify-center whitespace-normal rounded-xl px-2 py-2 text-center text-xs font-medium leading-tight ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:whitespace-nowrap sm:px-3 sm:text-sm";

  return isActive
    ? `${base} bg-primary text-primary-foreground shadow-md shadow-primary/25 hover:ring-2 hover:ring-secondary hover:ring-offset-2 hover:ring-offset-background`
    : `${base} text-muted-foreground hover:bg-secondary hover:text-secondary-foreground`;
}

// Mobile: full-width grid with 5 columns (compact labels).
// Tablet/desktop: fits content and centers.
const LIST_CLASSES =
  "mx-auto grid w-full grid-cols-5 items-center gap-1 rounded-2xl border border-border/60 bg-background/70 p-1 text-muted-foreground shadow-sm sm:flex sm:h-12 sm:w-fit sm:max-w-full sm:justify-center sm:overflow-x-auto";

export default function SalesTabsNav({
  activeTab,
  counts,
  searchParams,
}: {
  activeTab: SalesTab;
  counts: Record<SalesTab, number>;
  searchParams: SalesTabsSearchParams;
}) {
  return (
    <div dir="rtl" className={LIST_CLASSES}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        const countSuffix = getCountSuffix(tab, counts);
        return (
          <Link
            key={tab.id}
            href={buildTabHref(tab.id, searchParams)}
            aria-current={isActive ? "page" : undefined}
            className={triggerClassName(isActive)}
            onClick={() => emitNavigationStart()}
          >
            <span className="sm:hidden">
              {(tab.shortLabel ?? tab.label)}
              {countSuffix}
            </span>
            <span className="hidden sm:inline">
              {tab.label}
              {countSuffix}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
