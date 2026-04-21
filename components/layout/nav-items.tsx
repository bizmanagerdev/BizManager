"use client";

import type { ComponentType } from "react";
import {
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

export function useNavItems() {
  const sidebarItems: SidebarNavItem[] = [
    { title: "דשבורד", url: "/dashboard", icon: LayoutDashboard },
    { title: "התראות", url: "/alerts", icon: Bell },
    { title: "פרויקטים", url: "/projects", icon: FolderKanban },
    { title: "משימות", url: "/tasks", icon: ListTodo },
    { title: "מכירות", url: "/sales", icon: ShoppingCart },
    { title: "לקוחות", url: "/customers", icon: Users },
    { title: "פניות", url: "/inquiries", icon: MessageSquareMore },
    { title: "ניהול נכסים", url: "/properties", icon: Building2 },
    { title: "פיננסי", url: "/financial", icon: Landmark },
    { title: "שכר", url: "/payroll", icon: Wallet },
    { title: "מסמכים", url: "/documents", icon: FolderOpen },
  ];

  const bottomNavItems: SidebarNavItem[] = [
    { title: "דשבורד", url: "/dashboard", icon: LayoutDashboard },
    { title: "פרויקטים", url: "/projects", icon: FolderKanban },
    { title: "מכירות", url: "/sales", icon: ShoppingCart },
    { title: "לקוחות", url: "/customers", icon: Users },
    { title: "פניות", url: "/inquiries", icon: MessageSquareMore },
  ];

  const bottomNavMoreItems: SidebarNavItem[] = [
    { title: "התראות", url: "/alerts", icon: Bell },
    { title: "משימות", url: "/tasks", icon: ListTodo },
    { title: "ניהול נכסים", url: "/properties", icon: Building2 },
    { title: "פיננסי", url: "/financial", icon: Landmark },
    { title: "שכר", url: "/payroll", icon: Wallet },
    { title: "מסמכים", url: "/documents", icon: FolderOpen },
  ];

  return { sidebarItems, bottomNavItems, bottomNavMoreItems };
}
