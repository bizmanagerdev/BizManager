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
    { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
    { title: "Projects", url: "/projects", icon: FolderKanban },
    { title: "Sales", url: "/sales", icon: ShoppingCart },
    { title: "Inventory", url: "/inventory", icon: Boxes },
    { title: "Payroll", url: "/payroll", icon: BadgeDollarSign },
    { title: "Tasks", url: "/tasks", icon: ListTodo },
    { title: "Invoices", url: "/invoices", icon: FileText },
    { title: "Settings", url: "/settings", icon: Settings },
  ];

  const bottomNavItems: SidebarNavItem[] = [
    { title: "Home", url: "/dashboard", icon: LayoutDashboard },
    { title: "Projects", url: "/projects", icon: FolderKanban },
    { title: "Sales", url: "/sales", icon: ShoppingCart },
    { title: "Tasks", url: "/tasks", icon: ListTodo },
  ];

  const bottomNavMoreItems: SidebarNavItem[] = [
    { title: "Inventory", url: "/inventory", icon: Boxes },
    { title: "Payroll", url: "/payroll", icon: BadgeDollarSign },
    { title: "Invoices", url: "/invoices", icon: FileText },
    { title: "Settings", url: "/settings", icon: Settings },
  ];

  return { sidebarItems, bottomNavItems, bottomNavMoreItems };
}
