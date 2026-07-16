"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, ChevronDown, Clock, LogOut, User, Wallet } from "lucide-react";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import { getAvatarColorCache, setAvatarColorCache, subscribeAvatarColor } from "@/lib/ui/avatar-color";
import { BackButton } from "@/components/layout/BackButton";
import { RefreshButton } from "@/components/layout/RefreshButton";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { TOPBAR_ICON_BUTTON, TOPBAR_ICON_STROKE } from "@/components/layout/topbar-icon";
import PwaInstallButton from "@/components/pwa/PwaInstallButton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverPanel, HoverPanelContent, HoverPanelTrigger, useHoverPanel } from "@/components/ui/hover-panel";
import { useAlerts } from "@/lib/ui/alerts-store";

// The top-bar glyph for the inbox. Most-looked-at icon in the app, so it lives
// in one named place: swap this line + the lucide import to change it
// everywhere. (Tried Inbox / Mailbox / ListChecks — back to the bell.)
const InboxIcon = Bell;

// The signed-in user's email + whether they punch shifts — for the user menu.
// Fetched once per page load and cached at module scope (TopBar remounts on every
// navigation, so component state would refetch each time). Nothing here is
// sensitive enough to warrant threading props through ~40 AppShell call sites.
type Me = { email: string | null; canTrackSessions: boolean; canViewSalary: boolean };
let meCache: Me | null = null;
let meInFlight: Promise<void> | null = null;

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
  const { alerts, count, loading: alertsLoading, error: alertsError } = useAlerts();

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

  // The top-bar icon IS the inbox: it previews what's still open and its count is
  // the inbox count — the same number the inbox page shows, from the same source.
  // (It used to count unread rows in the delivery log, a different number of a
  // different thing — that mismatch is what made it untrustworthy.)
  const notifItems = alerts ?? [];
  const activeAlertCount = count;
  // First-load flash only — once we have any data, never show "loading…" again.
  const showLoadingState = alertsLoading && alerts === null;

  // Hover peeks at the list; clicking the icon goes straight to /inbox.
  const inboxPanel = useHoverPanel();

  const [me, setMe] = useState<Me | null>(meCache);
  useEffect(() => {
    if (meCache) return;
    if (!meInFlight) {
      meInFlight = fetch("/api/profile/me", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((json: { email?: string | null; canTrackSessions?: boolean; canViewSalary?: boolean } | null) => {
          meCache = {
            email: typeof json?.email === "string" ? json.email : null,
            canTrackSessions: json?.canTrackSessions === true,
            canViewSalary: json?.canViewSalary === true,
          };
        })
        .catch(() => {
          meCache = { email: null, canTrackSessions: false, canViewSalary: false };
        })
        .finally(() => {
          meInFlight = null;
        });
    }
    let active = true;
    void meInFlight?.then(() => {
      if (active) setMe(meCache);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-[60px] shrink-0 items-center gap-2 border-b border-border/70 bg-background bg-gradient-to-r from-primary/[0.04] via-background/95 to-secondary/[0.05] px-4 backdrop-blur-xl">
      {/* RTL: the first child sits on the RIGHT. Back arrow, then the search —
          both anchored to the start edge. Brand mark intentionally omitted (the
          sidebar carries it on desktop). */}
      <BackButton />
      {showSearch ? <GlobalSearch desktopOnly className="max-w-md flex-1" /> : null}

      <div className="flex-1" />

      {/* End edge, in reading order: refresh, bell, then the user menu. */}
      <div className="flex items-center gap-2">
        <RefreshButton />

        <HoverPanel open={inboxPanel.open} onOpenChange={inboxPanel.setOpen}>
          <HoverPanelTrigger asChild>
            <Button
              asChild
              variant="ghost"
              size="icon-sm"
              className={TOPBAR_ICON_BUTTON}
              id="topbar-inbox-trigger"
            >
              <Link
                href="/inbox"
                aria-label={
                  activeAlertCount > 0 ? `התיבה שלי — ${activeAlertCount} ממתינים לטיפול` : "התיבה שלי"
                }
                {...inboxPanel.triggerProps}
                // Click always goes to the inbox — the panel is only a peek.
                // (On touch there's no hover, so tapping simply opens the page.)
                onClick={() => {
                  inboxPanel.hide();
                  emitNavigationStart();
                }}
              >
                {/* No size class on the glyph: Button's `[&_svg]:size-4` sizes every
                    top-bar icon to 16px, so adding one here made this icon bigger
                    and bolder than its neighbours. The badge anchors to this span
                    (the glyph) — anchoring it to the button box, which is larger,
                    left it floating away from the icon. */}
                <span className="relative inline-flex shrink-0">
                  <InboxIcon strokeWidth={TOPBAR_ICON_STROKE} />
                  {activeAlertCount > 0 ? (
                    <span
                      className="absolute -top-2 -end-2 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground ring-2 ring-background"
                      aria-hidden
                    >
                      {activeAlertCount > 99 ? "99+" : activeAlertCount}
                    </span>
                  ) : null}
                </span>
              </Link>
            </Button>
          </HoverPanelTrigger>
          <HoverPanelContent
            dir="rtl"
            className="max-h-[70vh] w-80 overflow-y-auto p-2 text-right"
            {...inboxPanel.panelProps}
          >
            <div className="px-2 py-2">
              <div className="text-sm font-semibold">התיבה שלי</div>
              <div className="text-xs text-muted-foreground">
                {activeAlertCount > 0 ? `${activeAlertCount} ממתינים לטיפול` : "אין מה לטפל"}
              </div>
            </div>
            <div className="-mx-1 my-1 h-px bg-muted" />
            {showLoadingState ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">טוען...</div>
            ) : alertsError && notifItems.length === 0 ? (
              <div className="px-3 py-4 text-sm text-destructive">{alertsError}</div>
            ) : notifItems.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">הכול נקי.</div>
            ) : (
              notifItems.map((n) => (
                <Link
                  key={n.id}
                  href={n.href}
                  className="flex items-start gap-2 rounded-xl px-3 py-2.5 transition-colors hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    inboxPanel.hide();
                    emitNavigationStart();
                  }}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      n.severity === "danger" ? "bg-destructive" : n.severity === "warning" ? "bg-warning" : "bg-muted-foreground/40"
                    }`}
                  />
                  <span className="min-w-0 space-y-0.5">
                    <span className="block truncate text-sm font-medium">{n.title}</span>
                    {n.description ? (
                      <span className="block truncate text-xs text-muted-foreground">{n.description}</span>
                    ) : null}
                  </span>
                </Link>
              ))
            )}
            <div className="-mx-1 my-1 h-px bg-muted" />
            <Link
              href="/inbox"
              className="flex justify-center rounded-xl px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                inboxPanel.hide();
                emitNavigationStart();
              }}
            >
              פתח את התיבה
            </Link>
          </HoverPanelContent>
        </HoverPanel>

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
          <DropdownMenuContent align="end" className="w-60 rounded-xl p-1.5">
            {/* Who you're signed in as — the menu's most common question. */}
            <div className="flex items-center gap-2.5 px-2 py-2">
              {userName ? <InitialsAvatar name={userName} colorKey={userName} color={avatarColor} size="sm" /> : null}
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{userName ?? "משתמש"}</div>
                {me?.email ? <div className="truncate text-xs text-muted-foreground">{me.email}</div> : null}
              </div>
            </div>
            <DropdownMenuSeparator />

            {/* One entry per errand — these are the profile's three tabs. */}
            <DropdownMenuItem asChild>
              <Link href="/profile" className="flex items-center" onClick={() => emitNavigationStart()}>
                <User className="me-2 h-4 w-4 text-muted-foreground" />
                הפרופיל שלי
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href="/profile?tab=notifications"
                className="flex items-center"
                onClick={() => emitNavigationStart()}
              >
                <Bell className="me-2 h-4 w-4 text-muted-foreground" />
                הגדרות התראות
              </Link>
            </DropdownMenuItem>
            {/* These two mirror the profile's own gates — a pay type that doesn't
                punch in has no shifts tab, and one with no payslips has no salary
                tab. Showing either unconditionally would link to nothing. */}
            {me?.canTrackSessions ? (
              <DropdownMenuItem asChild>
                <Link href="/profile?tab=sessions" className="flex items-center" onClick={() => emitNavigationStart()}>
                  <Clock className="me-2 h-4 w-4 text-muted-foreground" />
                  נוכחות ומשמרות
                </Link>
              </DropdownMenuItem>
            ) : null}
            {me?.canViewSalary ? (
              <DropdownMenuItem asChild>
                <Link href="/profile?tab=salary" className="flex items-center" onClick={() => emitNavigationStart()}>
                  <Wallet className="me-2 h-4 w-4 text-muted-foreground" />
                  שכר ותלושים
                </Link>
              </DropdownMenuItem>
            ) : null}

            <DropdownMenuSeparator />
            <form action="/api/auth/logout" method="post">
              <DropdownMenuItem asChild className="text-destructive focus:bg-destructive/10 focus:text-destructive">
                <button type="submit" className="flex w-full items-center rounded-lg px-3 py-2">
                  <LogOut className="me-2 h-4 w-4" />
                  התנתקות
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>

        <PwaInstallButton />

        {showSearch ? <GlobalSearch mobileOnly /> : null}
      </div>
    </header>
  );
}
