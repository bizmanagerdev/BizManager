"use client";

import { createContext, Suspense, useContext, type ReactNode } from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { BottomNav } from "@/components/layout/BottomNav";
import { TopNavigationProgress } from "@/components/layout/TopNavigationProgress";
import OfflineBanner from "@/components/layout/OfflineBanner";
import ConnectionToasts from "@/components/layout/ConnectionToasts";
import PresenceTracker from "@/components/layout/PresenceTracker";
import FontScaleSync from "@/components/layout/FontScaleSync";
import type { SidebarNavItem } from "@/components/layout/nav-items";
import { useNavItems } from "@/components/layout/nav-items";

type Props = {
  children: ReactNode;
  appName?: string;
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
      <div className="flex min-h-screen w-full bg-transparent">
        <Suspense fallback={null}>
          <TopNavigationProgress />
        </Suspense>
        <PresenceTracker userName={userName} viewerRole={viewerRole} />
        <FontScaleSync />
        <ConnectionToasts />
        {sidebar.length > 0 && (
          // Suspense boundary required because AppSidebar reads useSearchParams
          // (to carry financial filters between Flow/Reports links).
          <Suspense fallback={null}>
            <AppSidebar items={sidebar} appName={appName} />
          </Suspense>
        )}
        <div className="flex flex-1 flex-col min-w-0">
          <TopBar appName={appName} userName={userName} initialColor={avatarColor} showSearch={showSearch} />
          <OfflineBanner />
          <main className="flex-1">
            <div className="mx-auto w-full max-w-[1600px] p-4 pb-24 md:p-6 md:pb-6 lg:p-8 lg:pb-8">
              {children}
            </div>
          </main>
          {bottom.length > 0 && <BottomNav items={bottom} moreItems={more} />}
        </div>
      </div>
    </NestedAppShellContext.Provider>
  );
}
