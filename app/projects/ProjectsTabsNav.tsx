"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
    <div className="inline-flex h-11 items-center rounded-md bg-muted p-1 text-sm">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          disabled={locked}
          onClick={() => goToTab(tab.id)}
          className={`rounded-sm px-4 py-2 transition ${
            selected === tab.id
              ? "bg-background font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

