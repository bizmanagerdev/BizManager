"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RecurringIcon, TaskIcon } from "@/components/ui/icons";
import type { IconComponent } from "@/components/ui/icons";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";

// Top-level navigation for the Tasks section: the board and the recurring-task
// templates. Recurring tasks used to live under Settings; it's a Tasks tab now.
const TASK_TABS: Array<{ href: string; label: string; icon: IconComponent }> = [
  { href: "/tasks", label: "לוח משימות", icon: TaskIcon },
  { href: "/tasks/recurring", label: "משימות קבועות", icon: RecurringIcon },
];

// Mirrors the "underline" TabsTrigger styling from components/ui/tabs.tsx so the
// tasks tabs match the project / sales / collections tab bars: flat tabs with a
// primary-colored underline on the active one.
function triggerClassName(isActive: boolean) {
  const base =
    "-mb-px inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-t-md border-b-[3px] px-2 pb-2 pt-1 text-base leading-tight ring-offset-background transition-colors hover:bg-muted/60 focus-visible:outline-none";
  return isActive
    ? `${base} border-primary font-bold text-primary`
    : `${base} border-transparent font-medium text-muted-foreground hover:text-foreground`;
}

export function TasksTabs() {
  const pathname = usePathname();
  const isRecurring = pathname?.startsWith("/tasks/recurring") ?? false;

  return (
    <div
      dir="rtl"
      className="flex min-w-0 items-end gap-2 overflow-x-auto overflow-y-hidden border-b border-border/60 text-muted-foreground sm:gap-3"
    >
      {TASK_TABS.map((tab) => {
        const isActive = tab.href === "/tasks/recurring" ? isRecurring : !isRecurring;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={triggerClassName(isActive)}
            onClick={() => emitNavigationStart()}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
