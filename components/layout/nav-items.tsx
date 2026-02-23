"use client";

import type { ComponentType } from "react";
import {
  LayoutDashboard,
  FolderKanban,
  ShoppingCart,
  Boxes,
  BadgeDollarSign,
  ListTodo,
  FileText,
  Settings,
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
    { title: "מכירות", url: "/sales", icon: ShoppingCart },
    { title: "מלאי", url: "/inventory", icon: Boxes },
    { title: "שכר", url: "/payroll", icon: BadgeDollarSign },
    { title: "משימות", url: "/tasks", icon: ListTodo },
    { title: "חשבוניות", url: "/invoices", icon: FileText },
    { title: "הגדרות", url: "/settings", icon: Settings },
  ];

  const bottomNavItems: SidebarNavItem[] = [
    { title: "דשבורד", url: "/dashboard", icon: LayoutDashboard },
    { title: "פרויקטים", url: "/projects", icon: FolderKanban },
    { title: "מכירות", url: "/sales", icon: ShoppingCart },
    { title: "משימות", url: "/tasks", icon: ListTodo },
  ];

  const bottomNavMoreItems: SidebarNavItem[] = [
    { title: "מלאי", url: "/inventory", icon: Boxes },
    { title: "שכר", url: "/payroll", icon: BadgeDollarSign },
    { title: "חשבוניות", url: "/invoices", icon: FileText },
    { title: "הגדרות", url: "/settings", icon: Settings },
  ];

  return { sidebarItems, bottomNavItems, bottomNavMoreItems };
}
