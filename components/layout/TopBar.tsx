"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, ChevronDown, LogOut, User } from "lucide-react";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import { getAvatarColorCache, setAvatarColorCache, subscribeAvatarColor } from "@/lib/ui/avatar-color";
import { BackButton } from "@/components/layout/BackButton";
import { RefreshButton } from "@/components/layout/RefreshButton";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import PwaInstallButton from "@/components/pwa/PwaInstallButton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNotifications, markNotificationRead } from "@/lib/ui/notifications-store";
import { formatShortDateTime } from "@/lib/date";

type Props = {
  userName?: string;
  initialColor?: string | null;
  showSearch?: boolean;
};

export function TopBar({
  userName,
  initialColor,
  showSearch = true,
}: Props) {
  const { items: notifications, unreadCount, loading: alertsLoading, error: alertsError } = useNotifications();

  // The signed-in user's chosen avatar color (null = auto). The (app) layout
  // passes the value from the server (`initialColor`), so the correct color is
  // painted on the very first render — no flash, ever. A module-level cache (see
  // lib/ui/avatar-color) keeps it consistent across mounts and lets the profile
  // page push a new choice here live. `initialColor` is the same on server and
  // client, so seeding state from it causes no hydration mismatch.
  const [avatarColor, setAvatarColor] = useState<string | null>(() => {
    const cached = getAvatarColorCache();
    return cached !== undefined ? cached : initialColor ?? null;
  });
  useEffect(() => {
    if (getAvatarColorCache() === undefined && initialColor !== undefined) {
      setAvatarColorCache(initialColor ?? null);
    }
    const unsubscribe = subscribeAvatarColor(() => setAvatarColor(getAvatarColorCache() ?? null));
    // Fallback fetch only if the server didn't provide a value (e.g. the column
    // isn't there yet) — normally the cache is already seeded above.
    if (getAvatarColorCache() === undefined) {
      void fetch("/api/profile/avatar-color", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((json: { avatarColor?: string | null } | null) => {
          setAvatarColorCache(json && typeof json.avatarColor === "string" ? json.avatarColor : null);
        })
        .catch(() => {
          // Offline / not signed in — leave the cache unset so a later mount retries.
        });
    }
    return unsubscribe;
  }, [initialColor]);

  // The bell is the notification CENTER: a read/unread history. Badge = unread.
  const notifItems = notifications ?? [];
  const activeAlertCount = unreadCount;
  // First-load flash only — once we have any data, never show "loading…" again.
  const showLoadingState = alertsLoading && notifications === null;

  return (
    <header className="sticky top-0 z-30 flex h-[60px] shrink-0 items-center gap-3 border-b border-border/70 bg-background bg-gradient-to-r from-primary/[0.04] via-background/95 to-secondary/[0.05] px-4 backdrop-blur-xl">
      <BackButton />
      <RefreshButton />

      {/* Brand mark intentionally omitted on mobile (the sidebar carries the brand
          on desktop); keeps the compact top bar uncluttered at large text sizes. */}

      <div className="flex-1 lg:flex-none" />

      <div className="flex items-center gap-1">
        <PwaInstallButton />
        <DropdownMenu dir="rtl" modal={false}>
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
          <DropdownMenuContent align="end" className="max-h-[70vh] w-80 overflow-y-auto rounded-2xl p-2">
            <div className="flex items-center justify-between gap-2 px-2 py-2">
              <div>
                <div className="text-sm font-semibold">התראות</div>
                <div className="text-xs text-muted-foreground">{unreadCount > 0 ? `${unreadCount} חדשות` : "הכול נקרא"}</div>
              </div>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={() => void markNotificationRead({ all: true })}
                  className="rounded-lg px-2 py-1 text-xs text-primary hover:bg-primary/10"
                >
                  סמן הכל כנקרא
                </button>
              ) : null}
            </div>
            <DropdownMenuSeparator />
            {showLoadingState ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">טוען התראות...</div>
            ) : alertsError && notifItems.length === 0 ? (
              <div className="px-3 py-4 text-sm text-destructive">{alertsError}</div>
            ) : notifItems.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">אין התראות עדיין.</div>
            ) : (
              notifItems.map((n) => {
                const unread = !n.read_at;
                return (
                  <DropdownMenuItem key={n.id} asChild className="cursor-pointer rounded-xl p-0">
                    <Link
                      href={n.url}
                      className={`flex items-start gap-2 px-3 py-2.5 ${unread ? "bg-primary/5" : ""}`}
                      onClick={() => {
                        if (unread) void markNotificationRead({ id: n.id });
                        emitNavigationStart();
                      }}
                    >
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unread ? "bg-primary" : "bg-transparent"}`} />
                      <div className="min-w-0 space-y-0.5">
                        <div className={`truncate text-sm ${unread ? "font-semibold" : "font-medium text-muted-foreground"}`}>{n.title}</div>
                        {n.body ? <div className="truncate text-xs text-muted-foreground">{n.body}</div> : null}
                        <div className="text-[11px] text-muted-foreground">{formatShortDateTime(n.created_at, "-")}</div>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                );
              })
            )}
            <DropdownMenuSeparator />
            <div className="flex items-center justify-between gap-2 px-1">
              <DropdownMenuItem asChild className="flex-1">
                <Link href="/notifications" className="justify-center font-medium" onClick={() => emitNavigationStart()}>
                  כל ההתראות
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="flex-1">
                <Link href="/alerts" className="justify-center font-medium" onClick={() => emitNavigationStart()}>
                  מה דורש טיפול
                </Link>
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/25 hover:bg-primary/90 hover:text-primary-foreground"
              type="button"
              id="topbar-user-trigger"
            >
              {userName ? (
                <InitialsAvatar name={userName} colorKey={userName} color={avatarColor} size="sm" />
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                  <User className="h-3.5 w-3.5" fill="currentColor" strokeWidth={2.2} />
                </div>
              )}
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
