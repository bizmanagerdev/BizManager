"use client";

import Link from "next/link";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";

type SalesTab = "orders" | "closed" | "inventory" | "price-list" | "deliveries";

const tabs: Array<{ id: SalesTab; label: string }> = [
  { id: "orders", label: "הזמנות" },
  { id: "closed", label: "הזמנות סגורות" },
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

function getTabLabel(tab: { id: SalesTab; label: string }, counts: Record<SalesTab, number>) {
  if (tab.id === "inventory" || tab.id === "price-list") {
    return tab.label;
  }

  return `${tab.label} (${counts[tab.id] ?? 0})`;
}

function triggerClassName(isActive: boolean) {
  return [
    "inline-flex",
    "min-h-[52px]",
    "min-w-0",
    "items-center",
    "justify-center",
    "whitespace-normal",
    "rounded-xl",
    "px-3",
    "py-2",
    "text-center",
    "text-sm",
    "font-medium",
    "leading-tight",
    "ring-offset-background",
    "transition-all",
    "focus-visible:outline-none",
    "focus-visible:ring-2",
    "focus-visible:ring-ring",
    "focus-visible:ring-offset-2",
    isActive
      ? "bg-gradient-to-r from-primary to-destructive text-primary-foreground shadow-lg shadow-primary/20"
      : "text-muted-foreground hover:text-foreground",
  ].join(" ");
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
  return (
    <>
      <div className="hidden items-center justify-center md:flex">
        <div className="inline-flex h-14 w-fit max-w-full items-center justify-center overflow-hidden rounded-2xl border border-white/60 bg-white/70 p-1 text-muted-foreground shadow-sm">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab;

            return (
              <Link
                key={tab.id}
                href={buildTabHref(tab.id, searchParams)}
                aria-current={isActive ? "page" : undefined}
                className={triggerClassName(isActive)}
                onClick={() => emitNavigationStart()}
              >
                {getTabLabel(tab, counts)}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="mx-auto grid h-14 w-full grid-cols-5 justify-center overflow-hidden rounded-2xl border border-white/60 bg-white/70 p-1 text-muted-foreground shadow-sm md:hidden">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;

          return (
            <Link
              key={tab.id}
              href={buildTabHref(tab.id, searchParams)}
              aria-current={isActive ? "page" : undefined}
              className={triggerClassName(isActive)}
              onClick={() => emitNavigationStart()}
            >
              {getTabLabel(tab, counts)}
            </Link>
          );
        })}
      </div>
    </>
  );
}
