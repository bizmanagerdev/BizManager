"use client";

import { type ReactNode, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SidebarNavItem } from "@/components/layout/nav-items";

interface Props {
  items: SidebarNavItem[];
  appName?: string;
  logo?: ReactNode;
}

export function AppSidebar({ items, appName = "BizManager", logo }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col border-r bg-sidebar transition-all duration-200 shrink-0",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <div className="flex items-center h-14 px-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2 overflow-hidden">
          {logo ?? (
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <span className="text-primary-foreground font-bold text-sm">
                {appName.charAt(0)}
              </span>
            </div>
          )}
          {!collapsed && (
            <span className="font-semibold text-foreground text-sm whitespace-nowrap">
              {appName}
            </span>
          )}
        </div>
      </div>

      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {items.map((item) => (
          <NavLink
            key={item.title}
            to={item.url}
            end={item.url === "/"}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 h-10 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
              collapsed && "justify-center px-0"
            )}
            activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{item.title}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="p-2 border-t border-sidebar-border">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setCollapsed(!collapsed)}
          className="w-full text-sidebar-foreground"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>
    </aside>
  );
}
