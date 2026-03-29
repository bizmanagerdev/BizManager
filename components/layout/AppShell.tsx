"use client";

import { Suspense, type ReactNode } from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { BottomNav } from "@/components/layout/BottomNav";
import { TopNavigationProgress } from "@/components/layout/TopNavigationProgress";
import type { SidebarNavItem } from "@/components/layout/nav-items";
import { useNavItems } from "@/components/layout/nav-items";

type Props = {
  children: ReactNode;
  appName?: string;
  userName?: string;
  showSearch?: boolean;
  sidebarItems?: SidebarNavItem[];
  bottomNavItems?: SidebarNavItem[];
  bottomNavMoreItems?: SidebarNavItem[];
};

export default function AppShell({
  children,
  appName,
  userName,
  showSearch,
  sidebarItems,
  bottomNavItems,
  bottomNavMoreItems,
}: Props) {
  const defaults = useNavItems();

  const sidebar = sidebarItems ?? defaults.sidebarItems;
  const bottom = bottomNavItems ?? defaults.bottomNavItems;
  const more = bottomNavMoreItems ?? defaults.bottomNavMoreItems;

  return (
    <div className="flex min-h-screen w-full bg-transparent">
      <Suspense fallback={null}>
        <TopNavigationProgress />
      </Suspense>
      {sidebar.length > 0 && <AppSidebar items={sidebar} appName={appName} />}
      <div className="flex flex-1 flex-col min-w-0">
        <TopBar appName={appName} userName={userName} showSearch={showSearch} />
        <main className="flex-1">
          <div className="mx-auto w-full max-w-[1600px] p-4 pb-24 md:p-6 md:pb-6 lg:p-8 lg:pb-8">
            {children}
          </div>
        </main>
        {bottom.length > 0 && <BottomNav items={bottom} moreItems={more} />}
      </div>
    </div>
  );
}
