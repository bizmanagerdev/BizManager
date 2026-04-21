"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";

type SalesTab = "orders" | "inventory" | "price-list" | "deliveries";

const tabs: Array<{ id: SalesTab; label: string }> = [
  { id: "orders", label: "הזמנות" },
  { id: "inventory", label: "מלאי" },
  { id: "price-list", label: "מחירון" },
  { id: "deliveries", label: "משלוחים" },
];

export default function SalesTabsNav({ activeTab }: { activeTab: SalesTab }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [pendingTo, setPendingTo] = useState<SalesTab | null>(null);

  const currentTab = useMemo<SalesTab>(() => {
    const tab = searchParams.get("tab");
    if (tab === "inventory" || tab === "price-list" || tab === "deliveries") return tab;
    return "orders";
  }, [searchParams]);

  const isLoading = isPending || pendingTo !== null;
  const selected = pendingTo ?? currentTab ?? activeTab;

  function goToTab(next: SalesTab) {
    if (next === currentTab) return;
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
    <div className="inline-flex h-12 items-center rounded-2xl border border-white/60 bg-white/70 p-1 text-sm shadow-sm">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => goToTab(tab.id)}
          disabled={isLoading}
          className={`rounded-xl border px-4 py-2 transition-all duration-200 ${
            selected === tab.id
              ? "border-primary/20 bg-gradient-to-r from-primary to-destructive font-medium text-primary-foreground shadow-lg shadow-primary/20"
              : "border-primary/10 bg-gradient-to-r from-accent to-destructive/15 text-accent-foreground shadow-sm hover:-translate-y-0.5 hover:shadow-md"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
