"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Top-level navigation for the Tasks section: the board and the recurring-task
// templates. Recurring tasks used to live under Settings; it's a Tasks tab now.
const TASK_TABS = [
  { href: "/tasks", label: "לוח משימות" },
  { href: "/tasks/recurring", label: "משימות קבועות" },
] as const;

export function TasksTabs() {
  const pathname = usePathname();
  const isRecurring = pathname?.startsWith("/tasks/recurring") ?? false;

  return (
    <div className="inline-flex gap-1 rounded-xl border bg-secondary/40 p-1">
      {TASK_TABS.map((tab) => {
        const active = tab.href === "/tasks/recurring" ? isRecurring : !isRecurring;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              active ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
