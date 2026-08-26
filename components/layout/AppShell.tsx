"use client";

import { createContext, Suspense, useContext, type ReactNode } from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { TopBar, type Me } from "@/components/layout/TopBar";
import { BottomNav } from "@/components/layout/BottomNav";
import { DesktopQuickCreateFab } from "@/components/layout/DesktopQuickCreateFab";
import { TopNavigationProgress } from "@/components/layout/TopNavigationProgress";
import OfflineBanner from "@/components/layout/OfflineBanner";
import ConnectionToasts from "@/components/layout/ConnectionToasts";
import ConnectionTelemetry from "@/components/pwa/ConnectionTelemetry";
import PresenceTracker from "@/components/layout/PresenceTracker";
import SessionWatcher from "@/components/layout/SessionWatcher";
import NotificationsRealtime from "@/components/notifications/NotificationsRealtime";
import FontScaleSync from "@/components/layout/FontScaleSync";
import FocusHighlighter from "@/components/layout/FocusHighlighter";
import type { SidebarNavItem } from "@/components/layout/nav-items";
import { useNavItems } from "@/components/layout/nav-items";
import { SidebarCollapseProvider } from "@/components/layout/sidebar-collapse-context";
import { PageTitleProvider } from "@/components/layout/page-title-context";
import { PAGE_HEADER_TOOLBAR_ID } from "@/components/layout/PageHeaderToolbar";

type Props = {
  children: ReactNode;
  appName?: string;
  companyName?: string;
  userName?: string;
  viewerRole?: string;
  /** Signed-in worker's UI language ('he' | 'ar'); office/admin are always 'he'. */
  viewerLocale?: string | null;
  /** Per-worker toggle for deliveries access, admin-set; meaningless for staff. */
  viewerDeliveriesAccess?: boolean;
  avatarColor?: string | null;
  /** Server-resolved top-bar user-menu data — see the `Me` comment in TopBar. */
  initialMe?: Me;
  showSearch?: boolean;
  sidebarItems?: SidebarNavItem[];
  bottomNavItems?: SidebarNavItem[];
  bottomNavMoreItems?: SidebarNavItem[];
};

// True for any AppShell rendered inside another AppShell. The real chrome (top
// bar, sidebar, bottom nav, cross-cutting helpers) lives in app/(app)/layout.tsx
// and persists across navigations. Pages still call <AppShell> for backwards
// compatibility, but nested instances just pass their children through — no
// duplicate chrome, and the shell never remounts on a tab switch.
const NestedAppShellContext = createContext(false);

export default function AppShell({
  children,
  appName,
  companyName,
  userName,
  viewerRole,
  viewerLocale,
  viewerDeliveriesAccess = true,
  avatarColor,
  initialMe,
  showSearch,
  sidebarItems,
  bottomNavItems,
  bottomNavMoreItems,
}: Props) {
  const isNested = useContext(NestedAppShellContext);
  const defaults = useNavItems(viewerRole, viewerLocale, viewerDeliveriesAccess);

  // Nested (a page rendered under the (app) layout): render content only.
  if (isNested) return <>{children}</>;

  const sidebar = sidebarItems ?? defaults.sidebarItems;
  const bottom = bottomNavItems ?? defaults.bottomNavItems;
  const more = bottomNavMoreItems ?? defaults.bottomNavMoreItems;

  return (
    <NestedAppShellContext.Provider value={true}>
     <SidebarCollapseProvider>
      <PageTitleProvider>
      {/* Column layout: the top bar is a FULL-WIDTH rail across the whole viewport
          (it spans over the sidebar too, and carries the brand), with the sidebar
          and the content sitting side by side underneath it. */}
      <div className="flex min-h-screen w-full flex-col bg-transparent">
        <Suspense fallback={null}>
          <TopNavigationProgress />
        </Suspense>
        <PresenceTracker userName={userName} viewerRole={viewerRole} />
        <SessionWatcher />
        <NotificationsRealtime />
        <FontScaleSync />
        {/* Suspense boundary required: FocusHighlighter reads useSearchParams. */}
        <Suspense fallback={null}>
          <FocusHighlighter />
        </Suspense>
        <ConnectionToasts />
        <ConnectionTelemetry />
        <TopBar
          appName={appName}
          companyName={companyName}
          hasSidebar={sidebar.length > 0}
          userName={userName}
          viewerRole={viewerRole}
          viewerLocale={viewerLocale === "ar" ? "ar" : "he"}
          initialColor={avatarColor}
          initialMe={initialMe}
          showSearch={showSearch}
        />
        {/* Slot for a page's own search/filter row, directly under the bar and on
            the SAME surface as it — the bar is the page's colour now, so a dark
            strip here would put back exactly the separation we just removed
            (user, 2026-08-19: "I want it to flow as one page"). `empty:hidden`
            keeps it out of the layout entirely on pages that don't use it. */}
        <div
          id={PAGE_HEADER_TOOLBAR_ID}
          className="sticky top-[60px] z-20 flex h-[52px] items-center bg-background px-3 empty:hidden md:hidden"
        />
        <OfflineBanner />
        <div className="flex min-w-0 flex-1">
          {sidebar.length > 0 && (
            // Suspense boundary required because AppSidebar reads useSearchParams
            // (to carry financial filters between Flow/Reports links).
            <Suspense fallback={null}>
              <AppSidebar items={sidebar} />
            </Suspense>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* The curve at the sidebar/top-bar junction is carried by the sidebar
                itself (rounded-se), so the page background shows through it. */}
            <main className="flex-1 bg-background">
              {/* Phone gutter is deliberately narrow (12px, not 16): on a 360px
                  screen every pixel of side padding is a pixel a table row, a tab
                  strip or a customer name doesn't get. Anything that breaks out
                  of it full-bleed uses -mx-3 to match — keep the two in step, or
                  the page overflows sideways. */}
              <div className="mx-auto w-full max-w-[1600px] px-3 py-4 pb-24 md:p-6 md:pb-6 lg:p-8 lg:pb-8">
                {children}
              </div>
            </main>
            {bottom.length > 0 && (
              <BottomNav
                items={bottom}
                moreItems={more}
                viewerRole={viewerRole}
                viewerLocale={viewerLocale === "ar" ? "ar" : "he"}
              />
            )}
          </div>
        </div>

        {/* Quick-create, floating over the bottom-left corner on desktop — it
            portals itself to <body>, see the component for why. */}
        <DesktopQuickCreateFab viewerRole={viewerRole} />
      </div>
      </PageTitleProvider>
     </SidebarCollapseProvider>
    </NestedAppShellContext.Provider>
  );
}
