"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, Clock, LogOut, User, Wallet } from "lucide-react";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import { getAvatarColorCache, setAvatarColorCache, subscribeAvatarColor } from "@/lib/ui/avatar-color";
import { BackButton } from "@/components/layout/BackButton";
import { RefreshButton } from "@/components/layout/RefreshButton";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { QuickCreateMenu } from "@/components/layout/QuickCreateMenu";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { TOPBAR_ICON_BUTTON, TOPBAR_ICON_STROKE } from "@/components/layout/topbar-icon";
import PwaInstallButton from "@/components/pwa/PwaInstallButton";
import { Button } from "@/components/ui/button";
import { HoverPanel, HoverPanelContent, HoverPanelTrigger, useHoverPanel } from "@/components/ui/hover-panel";
import { useAlerts } from "@/lib/ui/alerts-store";
import { BrandMark } from "@/components/ui/brand-mark";
import { RAIL_WIDTH, useSidebarCollapse } from "@/components/layout/sidebar-collapse-context";
import { usePageTitle } from "@/components/layout/page-title-context";
import { cn } from "@/lib/utils";

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

const USER_MENU_LINKS: {
  href: string;
  label: string;
  icon: typeof User;
  gate?: (me: Me | null) => boolean;
}[] = [
  { href: "/profile", label: "הפרופיל שלי", icon: User },
  { href: "/profile?tab=notifications", label: "הגדרות התראות", icon: Bell },
  {
    href: "/profile?tab=sessions",
    label: "נוכחות ומשמרות",
    icon: Clock,
    gate: (me) => me?.canTrackSessions === true,
  },
  { href: "/profile?tab=salary", label: "שכר ותלושים", icon: Wallet, gate: (me) => me?.canViewSalary === true },
];

type Props = {
  appName?: string;
  companyName?: string;
  hasSidebar?: boolean;
  userName?: string;
  viewerRole?: string;
  initialColor?: string | null;
  showSearch?: boolean;
};

export function TopBar({
  appName = "BizH",
  companyName = "חברת הלר",
  hasSidebar = true,
  userName,
  viewerRole,
  initialColor,
  showSearch = true,
}: Props) {
  const { collapsed } = useSidebarCollapse();
  const pageTitle = usePageTitle();
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
  const userPanel = useHoverPanel();

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
    // The top bar and the sidebar are ONE chrome surface: same background token,
    // same foreground, same border. Two different navies meeting where they touch
    // is exactly the mismatch this avoids. `primary` is reserved for ACTIONS
    // (buttons, quick-action tiles) and is never used as a chrome color.
    //
    // The panels that drop OUT of the bar — inbox, profile, the + grid — stay on
    // the normal light popover surface; only the rail itself is dark.
    <header className="sticky top-0 z-30 flex h-[60px] shrink-0 items-center gap-2 border-b border-sidebar-border/80 bg-sidebar/95 px-4 text-sidebar-foreground backdrop-blur-xl">
      {/* RTL: the first child sits on the RIGHT. The brand corner sits directly
          above the sidebar and is the ONLY light patch in the dark chrome — it
          opens up the corner where the rail meets the bar instead of leaving a
          solid navy block there. Its width tracks the rail's so the two line up. */}
      {hasSidebar ? (
        <div
          className={cn(
            "-my-[1px] -ms-4 me-2 hidden h-[calc(100%+2px)] shrink-0 items-center gap-2.5 self-stretch bg-background text-foreground md:flex",
            // Collapsed: the mark is centered so it lines up with the icon column
            // of the rail below it. Expanded: mark + name, left-aligned.
            collapsed ? `${RAIL_WIDTH.collapsed} justify-center px-0` : `${RAIL_WIDTH.expanded} px-3`
          )}
        >
          <BrandMark size="sm" />
          <div className={cn("min-w-0 leading-tight", collapsed ? "hidden" : "block")}>
            <div className="truncate text-sm font-bold tracking-tight">{appName}</div>
            {companyName ? (
              <div className="truncate text-[11px] text-muted-foreground">{companyName}</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Leading (right) edge: back arrow, then the search right beside it —
          search belongs with navigation, not with the action/notification
          cluster. Everything else sits on the far edge. */}
      <BackButton />
      {showSearch ? (
        // Fixed width, not flex-1: a `flex-1 basis-0` box would fight the spacer
        // below it and collapse.
        <GlobalSearch desktopOnly className="w-[20rem] max-w-[30vw] flex-none" />
      ) : null}
      {/* Mobile: the bar says WHERE YOU ARE. There's no sidebar on a phone, so
          without this the header is an anonymous row of icons. Pages declare it
          via useSetPageTitle(); when none is set the space just stays empty and
          the search fills it as before. */}
      {pageTitle ? (
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center text-center leading-tight lg:hidden">
          <span className="w-full truncate text-[17px] font-semibold text-white">{pageTitle.title}</span>
          {pageTitle.subtitle ? (
            <span className="w-full truncate text-[12px] text-sidebar-foreground/70">{pageTitle.subtitle}</span>
          ) : null}
        </div>
      ) : showSearch ? (
        <GlobalSearch mobileOnly className="min-w-0 flex-1" />
      ) : null}

      {/* Desktop only: the search box is a fixed width there, so this is what
          pushes the icon cluster to the far edge. On mobile the search bar above
          already does that. */}
      <div className="hidden flex-1 lg:block" />

      <div className="flex items-center gap-2">
        {/* Desktop only — on mobile the bottom nav's centre + is the quick-create,
            and two of them in one screen is one too many. There's no bottom nav
            from md up, so this stays the only door to it there. */}
        <div className="hidden md:block">
          <QuickCreateMenu viewerRole={viewerRole} />
        </div>

        {/* Desktop only — on a phone you pull the page down to refresh, so the
            glyph is just another target competing for a narrow bar. */}
        <div className="hidden md:block">
          <RefreshButton />
        </div>

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
                      className="absolute -top-2 -end-2 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground ring-2 ring-sidebar"
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

        <PwaInstallButton />

      {/* Hairline between the tools and you. */}
      <span aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-sidebar-border" />

      {/* Hover reveals the account menu, same as the inbox and the + — and for
          the same reason those use HoverPanel rather than a real menu: a menu
          grabs focus on open, which would swallow keystrokes from the search
          box sitting right next to it. Click still works, and on touch (no
          hover) the tap is the only interaction. */}
      <HoverPanel open={userPanel.open} onOpenChange={userPanel.setOpen}>
        <HoverPanelTrigger asChild>
          {/* Just the circle — the name lives inside the panel, where it's
              actually useful. Gmail-style: tap the avatar, get your details. */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-10 w-10 rounded-full p-0 hover:bg-secondary"
            type="button"
            aria-label={userName ? `החשבון שלי — ${userName}` : "החשבון שלי"}
            id="topbar-user-trigger"
            {...userPanel.triggerProps}
          >
            {userName ? (
              <InitialsAvatar name={userName} colorKey={userName} color={avatarColor} size="md" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                <User className="h-4 w-4" fill="currentColor" strokeWidth={2.2} />
              </div>
            )}
          </Button>
        </HoverPanelTrigger>
        <HoverPanelContent dir="rtl" className="w-60 rounded-xl p-1.5 text-right" {...userPanel.panelProps}>
          {/* Who you're signed in as — the panel's most common question. */}
          <div className="flex items-center gap-2.5 px-2 py-2">
            {userName ? <InitialsAvatar name={userName} colorKey={userName} color={avatarColor} size="sm" /> : null}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{userName ?? "משתמש"}</div>
              {me?.email ? <div className="truncate text-xs text-muted-foreground">{me.email}</div> : null}
            </div>
          </div>
          <div className="-mx-1 my-1 h-px bg-muted" />

          {/* One entry per errand — these are the profile's tabs. */}
          {USER_MENU_LINKS.filter((link) => !link.gate || link.gate(me)).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                userPanel.hide();
                emitNavigationStart();
              }}
            >
              <link.icon className="me-2 h-4 w-4 text-muted-foreground" />
              {link.label}
            </Link>
          ))}

          <div className="-mx-1 my-1 h-px bg-muted" />
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
            >
              <LogOut className="me-2 h-4 w-4" />
              התנתקות
            </button>
          </form>
        </HoverPanelContent>
      </HoverPanel>
      </div>
    </header>
  );
}
