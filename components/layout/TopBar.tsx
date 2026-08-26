"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ClockIcon, LogoutIcon, NotificationIcon, UserIcon, WalletIcon } from "@/components/ui/icons";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import { getAvatarColorCache, setAvatarColorCache, subscribeAvatarColor } from "@/lib/ui/avatar-color";
import { BackButton } from "@/components/layout/BackButton";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { TOPBAR_ICON_BUTTON, TOPBAR_ICON_STROKE } from "@/components/layout/topbar-icon";
import PwaInstallButton from "@/components/pwa/PwaInstallButton";
import { Button } from "@/components/ui/button";
import { HoverPanel, HoverPanelContent, HoverPanelTrigger, useHoverPanel } from "@/components/ui/hover-panel";
import { useAlerts } from "@/lib/ui/alerts-store";
import { BrandMark } from "@/components/ui/brand-mark";
import { RAIL_WIDTH, useSidebarCollapse } from "@/components/layout/sidebar-collapse-context";
import { useHeaderAction, usePageTitle } from "@/components/layout/page-title-context";
import { titleForPath } from "@/lib/ui/route-titles";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/t";
import { topbarDict } from "@/lib/i18n/dictionaries/topbar";
import { commonDict } from "@/lib/i18n/dictionaries/common";
import type { Locale } from "@/lib/i18n/types";

// The top-bar glyph for the inbox. Most-looked-at icon in the app, so it lives
// in one named place: swap this line + the lucide import to change it
// everywhere. (Tried Inbox / Mailbox / ListChecks — back to the bell.)
const InboxIcon = NotificationIcon;

// The signed-in user's email + whether they punch shifts — for the user menu.
// app/(app)/layout.tsx computes this server-side (requireProfile already loads
// payroll_worker_type/email in its one `users` query) and passes it as
// `initialMe`, same as avatarColor below — no fetch needed on the normal
// signed-in path. Still cached at module scope as a fallback for any other
// AppShell instance that doesn't have it to pass (TopBar remounts on every
// navigation, so component state alone would refetch each time).
export type Me = { email: string | null; canTrackSessions: boolean; canViewSalary: boolean };
let meCache: Me | null = null;
let meInFlight: Promise<void> | null = null;

function userMenuLinks(locale: Locale): {
  href: string;
  label: string;
  icon: typeof UserIcon;
  gate?: (me: Me | null) => boolean;
}[] {
  // Same four words as the tab strip they deep-link into — a menu row that says
  // "נוכחות ומשמרות" landing on a tab labelled "נוכחות" reads as two features.
  return [
    { href: "/profile", label: t(topbarDict, locale, "profileLabel"), icon: UserIcon },
    { href: "/profile?tab=notifications", label: t(topbarDict, locale, "notificationsLabel"), icon: NotificationIcon },
    {
      href: "/profile?tab=sessions",
      label: t(topbarDict, locale, "attendanceLabel"),
      icon: ClockIcon,
      gate: (me) => me?.canTrackSessions === true,
    },
    {
      href: "/profile?tab=salary",
      label: t(topbarDict, locale, "salaryLabel"),
      icon: WalletIcon,
      gate: (me) => me?.canViewSalary === true,
    },
  ];
}

type Props = {
  appName?: string;
  companyName?: string;
  hasSidebar?: boolean;
  userName?: string;
  viewerRole?: string;
  /** Signed-in worker's UI language ('he' | 'ar'); office/admin are always 'he'. */
  viewerLocale?: Locale;
  initialColor?: string | null;
  /** Server-resolved user-menu data — see the `Me` comment above. */
  initialMe?: Me;
  showSearch?: boolean;
};

export function TopBar({
  appName = "BizH",
  companyName = "יעקב הלר",
  hasSidebar = true,
  userName,
  viewerRole,
  viewerLocale = "he",
  initialColor,
  initialMe,
  showSearch = true,
}: Props) {
  const { collapsed } = useSidebarCollapse();
  // Global search spans customers, projects, orders and money — all staff-only
  // for a worker, so the box would only ever return doors he can't open.
  const showGlobalSearch = showSearch && viewerRole !== "worker";
  const pageTitle = usePageTitle();
  const pathname = usePathname();
  // The page's own heading wins (it's the one that can carry a live subtitle);
  // otherwise fall back to the route's name so no screen is ever nameless.
  const fallbackTitle = titleForPath(pathname);
  // PHONE ONLY, except for pages that set `showOnDesktop` — today that's just the
  // dashboard (user, 2026-08-19). A phone has no sidebar to say where you are;
  // past `lg` it does, so a title in the bar repeats it. See the slot below.
  const headerTitle = pageTitle ?? (fallbackTitle ? { title: fallbackTitle, subtitle: undefined } : null);
  const headerAction = useHeaderAction();
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

  const [me, setMe] = useState<Me | null>(initialMe ?? meCache);
  // Mirror a fresh `initialMe` into state right away if it ever changes after
  // mount (e.g. a profile edit elsewhere calls router.refresh(), re-running
  // the server layout with updated data) — React's documented "adjust state
  // during render" pattern rather than an effect, so there's no stale-frame
  // flash while an effect callback catches up on the next tick.
  const [prevInitialMe, setPrevInitialMe] = useState(initialMe);
  if (initialMe && initialMe !== prevInitialMe) {
    setPrevInitialMe(initialMe);
    setMe(initialMe);
  }
  useEffect(() => {
    // The normal signed-in path: the server already resolved this in
    // app/(app)/layout.tsx (the render-time sync above keeps `me` current).
    // Just keep the module cache in step, so a TopBar instance that ever
    // mounts without the prop still has something to read.
    if (initialMe) {
      meCache = initialMe;
      return;
    }
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
  }, [initialMe]);

  return (
    // THE BAR IS WHITE and the sidebar is dark (user, 2026-08-19). They used to be
    // one dark surface with a white brand patch cut out of it; that reads as one
    // L-shaped block of chrome wrapping the page. White above and dark beside it
    // makes the sidebar a rail you navigate from and the bar a strip belonging to
    // the page — and it puts the app's one dark corner (the brand) where the two
    // meet, instead of the one light one.
    //
    // Everything in here therefore takes PAGE tokens (foreground / background),
    // not sidebar ones. The exception is the brand corner below, which is now
    // the sidebar's.
    //
    // NO BORDER and no translucency: the bar should FLOW INTO the page, not sit
    // on it (user, 2026-08-19). A rule under it drew a line across the top of
    // every screen and put the bar back to being a separate strip; the same
    // background as the page, with nothing between them, is what makes the two
    // read as one surface. It stays OPAQUE (not /95) so content scrolling under
    // it disappears cleanly instead of ghosting through.
    <header className="sticky top-0 z-30 flex h-[60px] shrink-0 items-center gap-2 bg-background px-4 text-foreground">
      {/* RTL: the first child sits on the RIGHT. The brand corner is the top of
          the SIDEBAR, not part of the bar — same dark surface, so the rail reads
          as one column from the logo down. Its width tracks the rail's so the two
          line up. */}
      {hasSidebar ? (
        <Link
          href="/dashboard"
          aria-label={appName}
          className={cn(
            "-my-[1px] -ms-4 me-2 hidden h-[calc(100%+2px)] shrink-0 cursor-pointer items-center gap-2.5 self-stretch bg-sidebar text-sidebar-foreground md:flex",
            // Collapsed: the mark is centered so it lines up with the icon column
            // of the rail below it. Expanded: mark + name, left-aligned.
            collapsed ? `${RAIL_WIDTH.collapsed} justify-center px-0` : `${RAIL_WIDTH.expanded} px-3`
          )}
        >
          {/* WHITE on the navy, not sky (user, 2026-08-19). `text-primary-foreground`
              rather than text-white, per the palette rule — the token IS white,
              and it says "the readable colour on a primary surface", which is
              what this corner is. BrandMark's own default is text-secondary, for
              the light surfaces it sits on elsewhere (the auth screen). */}
          <BrandMark size="sm" className="text-primary-foreground" />
          <div className={cn("min-w-0 leading-tight", collapsed ? "hidden" : "block")}>
            <div className="truncate text-sm font-bold tracking-tight">{appName}</div>
            {companyName ? (
              <div className="truncate text-[11px] text-sidebar-foreground/70">{companyName}</div>
            ) : null}
          </div>
        </Link>
      ) : null}

      {/* Leading (right) edge: back arrow, then the search right beside it —
          search belongs with navigation, not with the action/notification
          cluster. Everything else sits on the far edge. */}
      <BackButton />
      {/* A page-declared action (e.g. the calendar's ⋮ menu, or a detail page's
          actions menu) — sits between the back arrow and the page title. */}
      {pageTitle?.action ?? headerAction ? (
        <div className="shrink-0">{pageTitle?.action ?? headerAction}</div>
      ) : null}
      {/* The bar says WHERE YOU ARE on a phone, which is why titles are written
          short: "לקוחות · 571 לקוחות", not a sentence.

          `overflow-hidden` on the slot is a GUARD, not a layout strategy. The
          title span below is `whitespace-nowrap`, so a title wider than the slot
          doesn't shrink or wrap — it SPILLS, and the slot's neighbour is the
          search glyph, so it spilled straight under the magnifier (the date read
          as "16 באוגוס🔍ט"). Worse, every bit of padding added to separate the two
          made the slot narrower and the spill longer. Titles are chosen to fit;
          this only stops a stray long one from painting over the icons. */}
      {headerTitle ? (
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col justify-center overflow-hidden px-3 leading-tight",
            // PHONE ONLY, unless the page asks otherwise (user, 2026-08-19).
            // There's no sidebar on a phone, so the bar has to say where you are;
            // past `lg` the sidebar says it, and repeating it in a bar that is
            // now just a strip of the page is noise. The dashboard opts in — its
            // heading is a GREETING, not a page name, and nothing else carries it.
            pageTitle?.showOnDesktop
              ? "items-center text-center lg:items-start lg:text-start"
              : "items-center text-center lg:hidden"
          )}
        >
          {/* One line, always: the title SHRINKS to fit the middle slot rather than
              wrapping mid-word ("עובדי / ם") or clipping. clamp() scales it with the
              viewport down to a still-legible floor. */}
          <span className="w-full whitespace-nowrap text-[clamp(0.75rem,3.4vw,1.0625rem)] font-semibold text-foreground">
            {headerTitle.title}
          </span>
          {headerTitle.subtitle ? (
            // Wraps to a second line instead of clipping — record names live here
            // (e.g. a project's name) and half a name reads as a bug.
            <span className="line-clamp-2 w-full break-words text-[12px] leading-tight text-muted-foreground">
              {headerTitle.subtitle}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Pushes the icon cluster to the far edge. On a phone the title slot is
          itself flex-1 and already does this; on desktop the title is hidden on
          every page but the dashboard, so without this the cluster would slide
          back against the brand corner. Needed whenever the slot isn't filling
          the row: no title at all, or a title that's phone-only. */}
      {headerTitle && pageTitle?.showOnDesktop ? null : <div className="hidden flex-1 lg:block" />}

      {/* ms-3 (RTL → space on the RIGHT, i.e. toward the title): the search glyph
          leads this cluster on a phone and sat flush against the page title, so
          the magnifier read as part of the words. The gap lives here rather than
          as yet more title padding so it only ever separates the title from the
          icons — the icons keep their own tighter gap-1 between themselves. */}
      <div className="ms-3 flex items-center gap-1">
        {/* Search is a GLYPH at every width now — the 20rem desktop box is gone and
            the middle slot belongs to the title. The magnifier opens the same
            full-screen search dialog on a phone and on a desktop. */}
        {showGlobalSearch ? <GlobalSearch mobileOnly iconOnly /> : null}


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
                  activeAlertCount > 0
                    ? `${t(topbarDict, viewerLocale, "myInbox")} — ${activeAlertCount} ${t(topbarDict, viewerLocale, "waitingForAction")}`
                    : t(topbarDict, viewerLocale, "myInbox")
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
              <div className="text-sm font-semibold">{t(topbarDict, viewerLocale, "myInbox")}</div>
              <div className="text-xs text-muted-foreground">
                {activeAlertCount > 0
                  ? `${activeAlertCount} ${t(topbarDict, viewerLocale, "waitingForAction")}`
                  : t(topbarDict, viewerLocale, "allClear")}
              </div>
            </div>
            <div className="-mx-1 my-1 h-px bg-muted" />
            {showLoadingState ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">{t(commonDict, viewerLocale, "loading")}</div>
            ) : alertsError && notifItems.length === 0 ? (
              <div className="px-3 py-4 text-sm text-destructive">{alertsError}</div>
            ) : notifItems.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">{t(topbarDict, viewerLocale, "allClear")}</div>
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
              {t(topbarDict, viewerLocale, "openInbox")}
            </Link>
          </HoverPanelContent>
        </HoverPanel>

        <PwaInstallButton locale={viewerLocale} />

      {/* Hairline between the tools and you. */}
      <span aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-border" />

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
            className="h-[40px] w-[40px] rounded-full p-0 hover:bg-accent"
            type="button"
            aria-label={
              userName
                ? `${t(topbarDict, viewerLocale, "myAccount")} — ${userName}`
                : t(topbarDict, viewerLocale, "myAccount")
            }
            id="topbar-user-trigger"
            {...userPanel.triggerProps}
          >
            {/* px, like the button around it — see topbar-icon.ts. */}
            {userName ? (
              <InitialsAvatar
                name={userName}
                colorKey={userName}
                color={avatarColor}
                size="md"
                className="!h-[36px] !w-[36px] !text-[13px]"
              />
            ) : (
              <div className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                <UserIcon className="h-[18px] w-[18px]" fill="currentColor" strokeWidth={2.2} />
              </div>
            )}
          </Button>
        </HoverPanelTrigger>
        <HoverPanelContent dir="rtl" className="w-60 rounded-xl p-1.5 text-right" {...userPanel.panelProps}>
          {/* Who you're signed in as — the panel's most common question. */}
          <div className="flex items-center gap-2.5 px-2 py-2">
            {userName ? <InitialsAvatar name={userName} colorKey={userName} color={avatarColor} size="sm" /> : null}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{userName ?? t(topbarDict, viewerLocale, "userFallback")}</div>
              {me?.email ? <div className="truncate text-xs text-muted-foreground">{me.email}</div> : null}
            </div>
          </div>
          <div className="-mx-1 my-1 h-px bg-muted" />

          {/* One entry per errand — these are the profile's tabs. */}
          {userMenuLinks(viewerLocale).filter((link) => !link.gate || link.gate(me)).map((link) => (
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
              <LogoutIcon className="me-2 h-4 w-4" />
              {t(topbarDict, viewerLocale, "logout")}
            </button>
          </form>
        </HoverPanelContent>
      </HoverPanel>
      </div>
    </header>
  );
}
