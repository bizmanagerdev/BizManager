"use client";

import { createContext, Suspense, useContext, type ReactNode } from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { BottomNav } from "@/components/layout/BottomNav";
import { TopNavigationProgress } from "@/components/layout/TopNavigationProgress";
import OfflineBanner from "@/components/layout/OfflineBanner";
import ConnectionToasts from "@/components/layout/ConnectionToasts";
import ConnectionTelemetry from "@/components/pwa/ConnectionTelemetry";
import PresenceTracker from "@/components/layout/PresenceTracker";
import SessionWatcher from "@/components/layout/SessionWatcher";
import NotificationsRealtime from "@/components/notifications/NotificationsRealtime";
import FontScaleSync from "@/components/layout/FontScaleSync";
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
  avatarColor?: string | null;
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
  avatarColor,
  showSearch,
  sidebarItems,
  bottomNavItems,
  bottomNavMoreItems,
}: Props) {
  const isNested = useContext(NestedAppShellContext);
  const defaults = useNavItems(viewerRole);

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
        <ConnectionToasts />
        <ConnectionTelemetry />
        <TopBar
          appName={appName}
          companyName={companyName}
          hasSidebar={sidebar.length > 0}
          userName={userName}
          viewerRole={viewerRole}
          initialColor={avatarColor}
          showSearch={showSearch}
        />
        {/* Slot for a page's own search/filter row, rendered as part of the dark
            header so the two read as one block. `empty:hidden` keeps it out of
            the layout entirely on pages that don't use it. */}
        <div
          id={PAGE_HEADER_TOOLBAR_ID}
          className="sticky top-[60px] z-20 flex h-[52px] items-center bg-sidebar px-3 empty:hidden md:hidden"
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
              <div className="mx-auto w-full max-w-[1600px] p-4 pb-24 md:p-6 md:pb-6 lg:p-8 lg:pb-8">
                {children}
              </div>
            </main>
            {bottom.length > 0 && <BottomNav items={bottom} moreItems={more} viewerRole={viewerRole} />}
          </div>
        </div>
      </div>
      </PageTitleProvider>
     </SidebarCollapseProvider>
    </NestedAppShellContext.Provider>
  );
}
