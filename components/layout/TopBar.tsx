"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { Bell, ChevronDown, LogOut, User } from "lucide-react";
import { BackButton } from "@/components/layout/BackButton";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import PwaInstallButton from "@/components/pwa/PwaInstallButton";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAlerts } from "@/lib/ui/alerts-store";

type Props = {
  appName?: string;
  logo?: ReactNode;
  userName?: string;
  showSearch?: boolean;
};

export function TopBar({
  appName = "BizH",
  logo,
  userName,
  showSearch = true,
}: Props) {
  const { alerts, loading: alertsLoading, error: alertsError } = useAlerts();

  // "Real alerts" = actionable items that need attention. Excludes baseline info
  // rows (e.g. "X active projects") and any explicitly opted-out entries.
  const activeAlerts = useMemo(
    () =>
      (alerts ?? []).filter(
        (alert) =>
          alert.count > 0 &&
          alert.severity !== "info" &&
          alert.countsAsActiveAlert !== false,
      ),
    [alerts],
  );
  const activeAlertCount = activeAlerts.reduce((sum, alert) => sum + alert.count, 0);
  // First-load flash only — once we have any data, never show "loading…" again
  // on subsequent route changes (data is cached in the module-level store).
  const showLoadingState = alertsLoading && alerts === null;

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border/70 bg-gradient-to-r from-primary/[0.04] via-background/95 to-secondary/[0.05] px-4 backdrop-blur-xl">
      <BackButton />

      <div className="flex items-center gap-2 lg:hidden">
        {logo ?? <BrandMark size="md" />}
        <span className="text-base font-bold tracking-[0.2em] text-primary">{appName}</span>
      </div>

      <div className="flex-1 lg:flex-none" />

      <div className="flex items-center gap-1">
        <PwaInstallButton />
        <DropdownMenu dir="rtl">
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={
                activeAlertCount > 0
                  ? "rounded-xl !bg-transparent !border-transparent !shadow-none text-destructive hover:text-destructive hover:!bg-transparent"
                  : "rounded-xl !bg-transparent !border-transparent !shadow-none text-primary hover:text-primary hover:!bg-transparent"
              }
              type="button"
              id="topbar-alerts-trigger"
            >
              <Bell
                className={
                  activeAlertCount > 0
                    ? "h-5 w-5 origin-top animate-bell-ring"
                    : "h-5 w-5"
                }
                fill={activeAlertCount > 0 ? "currentColor" : "none"}
                strokeWidth={activeAlertCount > 0 ? 2.4 : 2}
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 rounded-2xl p-2">
            <div className="px-2 py-2">
              <div className="text-sm font-semibold">התראות</div>
              <div className="text-xs text-muted-foreground">פעולות שדורשות תשומת לב</div>
            </div>
            <DropdownMenuSeparator />
            {showLoadingState ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">טוען התראות...</div>
            ) : alertsError && activeAlerts.length === 0 ? (
              <div className="px-3 py-4 text-sm text-destructive">{alertsError}</div>
            ) : activeAlerts.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">אין התראות פעילות.</div>
            ) : (
              activeAlerts.map((alert) => (
                <DropdownMenuItem key={alert.id} asChild className="cursor-pointer rounded-xl p-0">
                  <Link
                    href={alert.href}
                    className="flex items-start justify-between gap-3 px-3 py-3"
                    onClick={() => emitNavigationStart()}
                  >
                    <div className="space-y-1">
                      <div className="font-medium">{alert.title}</div>
                      <div className="text-xs text-muted-foreground">{alert.description}</div>
                    </div>
                    <span
                      className={
                        alert.severity === "danger"
                          ? "inline-flex items-center rounded-full border border-destructive bg-destructive-soft px-2 py-1 text-xs font-semibold text-destructive-soft-foreground"
                          : "inline-flex items-center rounded-full border border-warning bg-warning-soft px-2 py-1 text-xs font-semibold text-warning-soft-foreground"
                      }
                    >
                      {alert.count}
                    </span>
                  </Link>
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/alerts" className="justify-center font-medium" onClick={() => emitNavigationStart()}>
                כל ההתראות
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/25 hover:bg-primary/90 hover:text-primary-foreground"
              type="button"
              id="topbar-user-trigger"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                <User className="h-3.5 w-3.5" fill="currentColor" strokeWidth={2.2} />
              </div>
              {userName && <span className="hidden text-sm lg:inline">{userName}</span>}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 rounded-xl">
            <DropdownMenuItem asChild>
              <Link href="/profile" className="flex items-center" onClick={() => emitNavigationStart()}>
                <User className="me-2 h-4 w-4" />
                אזור אישי
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <form action="/api/auth/logout" method="post">
              <DropdownMenuItem asChild className="text-destructive">
                <button
                  type="submit"
                  className="flex w-full items-center rounded-lg bg-destructive px-3 py-2 text-destructive-foreground"
                >
                  <LogOut className="me-2 h-4 w-4" />
                  התנתקות
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>

        {showSearch ? <GlobalSearch mobileOnly /> : null}
      </div>

      {showSearch ? <GlobalSearch desktopOnly className="max-w-md" /> : null}
    </header>
  );
}
