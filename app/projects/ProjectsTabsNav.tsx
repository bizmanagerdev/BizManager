"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ResponsiveTabsRail } from "@/components/layout/page-layout";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";

type ProjectsTab = "list" | "calendar";

const tabs: Array<{ id: ProjectsTab; label: string }> = [
  { id: "list", label: "רשימת פרויקטים" },
  { id: "calendar", label: "לוח שנה" },
];

export default function ProjectsTabsNav({ activeTab }: { activeTab: ProjectsTab }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [pendingTo, setPendingTo] = useState<ProjectsTab | null>(null);

  const currentTab = useMemo<ProjectsTab>(() => {
    const tab = searchParams.get("tab");
    if (tab === "calendar") return "calendar";
    return "list";
  }, [searchParams]);

  const selected = pendingTo ?? currentTab ?? activeTab;
  const locked = isPending || pendingTo !== null;

  function goToTab(next: ProjectsTab) {
    if (next === currentTab) return;
    emitNavigationStart();
    setPendingTo(next);

    const params = new URLSearchParams(searchParams.toString());
    if (next === "list") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;

    startTransition(() => {
      router.push(url, { scroll: false });
      setTimeout(() => setPendingTo(null), 900);
    });
  }

  return (
    <ResponsiveTabsRail>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          disabled={locked}
          onClick={() => goToTab(tab.id)}
          className={`rounded-xl border px-4 py-2 text-center text-sm transition-all duration-200 ${
            selected === tab.id
              ? "border-primary/20 bg-gradient-to-r from-primary to-destructive font-medium text-primary-foreground shadow-lg shadow-primary/20"
              : "border-primary/10 bg-gradient-to-r from-accent to-destructive/15 text-accent-foreground shadow-sm hover:-translate-y-0.5 hover:shadow-md"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </ResponsiveTabsRail>
  );
}
