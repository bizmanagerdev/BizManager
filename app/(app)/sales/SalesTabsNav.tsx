"use client";

import Link from "next/link";
import { Boxes, CheckCircle2, ShoppingCart, Tags, Truck, type LucideIcon } from "lucide-react";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";

type SalesTab = "orders" | "closed" | "inventory" | "price-list" | "deliveries";

const tabs: Array<{ id: SalesTab; label: string; shortLabel?: string; icon: LucideIcon }> = [
  { id: "orders", label: "הזמנות", icon: ShoppingCart },
  { id: "closed", label: "הזמנות סגורות", shortLabel: "סגורות", icon: CheckCircle2 },
  { id: "inventory", label: "מלאי", icon: Boxes },
  { id: "price-list", label: "מחירון", icon: Tags },
  { id: "deliveries", label: "משלוחים", icon: Truck },
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
  if (tab.id === "inventory" || tab.id === "price-list") return "";
  return ` (${counts[tab.id] ?? 0})`;
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
        const Icon = tab.icon;
        return (
          <Link
            key={tab.id}
            href={buildTabHref(tab.id, searchParams)}
            aria-current={isActive ? "page" : undefined}
            className={triggerClassName(isActive)}
            onClick={() => emitNavigationStart()}
          >
            <Icon className="h-4 w-4 shrink-0" />
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
