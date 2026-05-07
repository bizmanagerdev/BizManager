"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type SalesTab = "orders" | "closed" | "inventory" | "price-list" | "deliveries";

const tabs: Array<{ id: SalesTab; label: string }> = [
  { id: "orders", label: "הזמנות" },
  { id: "closed", label: "הזמנות סגורות" },
  { id: "inventory", label: "מלאי" },
  { id: "price-list", label: "מחירון" },
  { id: "deliveries", label: "משלוחים" },
];

export default function SalesTabsNav({
  activeTab,
  counts,
}: {
  activeTab: SalesTab;
  counts: Record<SalesTab, number>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [pendingTo, setPendingTo] = useState<SalesTab | null>(null);

  const currentTab = useMemo<SalesTab>(() => {
    const tab = searchParams.get("tab");
    if (tab === "closed" || tab === "inventory" || tab === "price-list" || tab === "deliveries") {
      return tab;
    }
    return "orders";
  }, [searchParams]);

  const selected = pendingTo ?? currentTab ?? activeTab;
  const isLoading = isPending || pendingTo !== null;

  function getTabLabel(tab: { id: SalesTab; label: string }) {
    if (tab.id === "inventory" || tab.id === "price-list") {
      return tab.label;
    }
    return `${tab.label} (${counts[tab.id] ?? 0})`;
  }

  function handleTabChange(value: string) {
    const next = (tabs.find((tab) => tab.id === value)?.id ?? "orders") as SalesTab;
    if (next === currentTab || isLoading) return;

    emitNavigationStart();
    setPendingTo(next);

    const params = new URLSearchParams(searchParams.toString());
    if (next === "orders") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;

    startTransition(() => {
      router.push(url, { scroll: false });
      setTimeout(() => setPendingTo(null), 700);
    });
  }

  return (
    <Tabs value={selected} onValueChange={handleTabChange}>
      <div className="hidden items-center justify-center md:flex">
        <TabsList className="flex w-fit max-w-full justify-center overflow-hidden">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="min-w-0 whitespace-normal px-3 text-center leading-tight"
              disabled={isLoading}
            >
              {getTabLabel(tab)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <TabsList className="mx-auto grid w-full grid-cols-5 justify-center overflow-hidden md:hidden">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            className="min-w-0 whitespace-normal px-3 text-center leading-tight"
            disabled={isLoading}
          >
            {getTabLabel(tab)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
