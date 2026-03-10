"use client";

import type { ComponentType } from "react";
import {
  LayoutDashboard,
  FolderKanban,
  ShoppingCart,
  ListTodo,
  Users,
  Landmark,
  FolderOpen,
} from "lucide-react";

export type SidebarNavItem = {
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
};

export function useNavItems() {
  const sidebarItems: SidebarNavItem[] = [
    { title: "דשבורד", url: "/dashboard", icon: LayoutDashboard },
    { title: "פרויקטים", url: "/projects", icon: FolderKanban },
    { title: "משימות", url: "/tasks", icon: ListTodo },
    { title: "מכירות", url: "/sales", icon: ShoppingCart },
    { title: "לקוחות", url: "/customers", icon: Users },
    { title: "פיננסי", url: "/financial", icon: Landmark },
    { title: "מסמכים", url: "/documents", icon: FolderOpen },
  ];

  const bottomNavItems: SidebarNavItem[] = [
    { title: "דשבורד", url: "/dashboard", icon: LayoutDashboard },
    { title: "פרויקטים", url: "/projects", icon: FolderKanban },
    { title: "מכירות", url: "/sales", icon: ShoppingCart },
    { title: "לקוחות", url: "/customers", icon: Users },
  ];

  const bottomNavMoreItems: SidebarNavItem[] = [
    { title: "משימות", url: "/tasks", icon: ListTodo },
    { title: "פיננסי", url: "/financial", icon: Landmark },
    { title: "מסמכים", url: "/documents", icon: FolderOpen },
  ];

  return { sidebarItems, bottomNavItems, bottomNavMoreItems };
}

