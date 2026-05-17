"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  Activity,
  Bell,
  Building2,
  FolderKanban,
  FolderOpen,
  Landmark,
  LayoutDashboard,
  ListTodo,
  MessageSquareMore,
  ShoppingCart,
  Users,
  Wallet,
} from "lucide-react";

export type SidebarNavItem = {
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
};

const SIDEBAR_ITEMS: SidebarNavItem[] = [
  { title: "דשבורד", url: "/dashboard", icon: LayoutDashboard },
  { title: "התראות", url: "/alerts", icon: Bell },
  { title: "פרויקטים", url: "/projects", icon: FolderKanban },
  { title: "משימות", url: "/tasks", icon: ListTodo },
  { title: "מכירות", url: "/sales", icon: ShoppingCart },
  { title: "לקוחות", url: "/customers", icon: Users },
  { title: "פניות", url: "/inquiries", icon: MessageSquareMore },
  { title: "ניהול נכסים", url: "/properties", icon: Building2 },
  { title: "פיננסי", url: "/financial", icon: Landmark },
  { title: "עובדים ושכר", url: "/payroll", icon: Wallet },
  { title: "מסמכים", url: "/documents", icon: FolderOpen },
  { title: "פעילות", url: "/activity", icon: Activity },
];

const BOTTOM_NAV_ITEMS: SidebarNavItem[] = [
  { title: "דשבורד", url: "/dashboard", icon: LayoutDashboard },
  { title: "פרויקטים", url: "/projects", icon: FolderKanban },
  { title: "מכירות", url: "/sales", icon: ShoppingCart },
  { title: "לקוחות", url: "/customers", icon: Users },
  { title: "פניות", url: "/inquiries", icon: MessageSquareMore },
];

const BOTTOM_NAV_MORE_ITEMS: SidebarNavItem[] = [
  { title: "התראות", url: "/alerts", icon: Bell },
  { title: "משימות", url: "/tasks", icon: ListTodo },
  { title: "ניהול נכסים", url: "/properties", icon: Building2 },
  { title: "פיננסי", url: "/financial", icon: Landmark },
  { title: "עובדים ושכר", url: "/payroll", icon: Wallet },
  { title: "מסמכים", url: "/documents", icon: FolderOpen },
  { title: "פעילות", url: "/activity", icon: Activity },
];

const ADMIN_ONLY_URLS = new Set(["/payroll", "/activity"]);

function filterByRole(items: SidebarNavItem[], isAdmin: boolean) {
  return items.filter((item) => isAdmin || !ADMIN_ONLY_URLS.has(item.url));
}

export function useNavItems() {
  const [viewerRole, setViewerRole] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void fetch("/api/profile/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json().catch(() => null)) as { role?: string | null } | null;
      })
      .then((json) => {
        if (!active) return;
        setViewerRole(typeof json?.role === "string" ? json.role : null);
      })
      .catch(() => {
        if (!active) return;
        setViewerRole(null);
      });

    return () => {
      active = false;
    };
  }, []);

  const isAdmin = viewerRole === "admin";

  const sidebarItems = useMemo(
    () => filterByRole(SIDEBAR_ITEMS, isAdmin),
    [isAdmin]
  );
  const bottomNavMoreItems = useMemo(
    () => filterByRole(BOTTOM_NAV_MORE_ITEMS, isAdmin),
    [isAdmin]
  );

  return { sidebarItems, bottomNavItems: BOTTOM_NAV_ITEMS, bottomNavMoreItems };
}
