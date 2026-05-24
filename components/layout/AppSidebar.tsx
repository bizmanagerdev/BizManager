"use client";

import { type ReactNode, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/ui/brand-mark";
import { cn } from "@/lib/utils";
import type { SidebarNavItem } from "@/components/layout/nav-items";

interface Props {
  items: SidebarNavItem[];
  appName?: string;
  logo?: ReactNode;
}

export function AppSidebar({ items, appName = "BizH", logo }: Props) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen self-start md:flex shrink-0 flex-col border-e border-sidebar-border/80 bg-sidebar/95 backdrop-blur-xl transition-all duration-200",
        collapsed ? "w-16 lg:w-60" : "w-60"
      )}
    >
      <div className="flex h-16 items-center border-b border-sidebar-border/80 px-4">
        <div className="flex items-center gap-2 overflow-hidden">
          {logo ?? <BrandMark size="lg" />}
          <span
            className={cn(
              "block whitespace-nowrap text-sm font-semibold text-white",
              collapsed ? "hidden lg:inline" : "inline"
            )}
          >
            {appName}
          </span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4">
        {items.map((item) => (
          <NavLink
            key={item.title}
            to={item.url}
            end={item.url === "/"}
            className={cn(
              "flex h-11 items-center gap-3 rounded-xl px-3 text-base text-sidebar-foreground transition-all duration-200 hover:bg-secondary hover:text-secondary-foreground hover:shadow-sm",
              collapsed && "justify-center px-0 lg:justify-start lg:px-3"
            )}
            activeClassName="bg-secondary text-secondary-foreground font-medium shadow-md shadow-secondary/30 hover:ring-2 hover:ring-white/50 hover:ring-offset-2 hover:ring-offset-sidebar"
            pendingClassName="bg-white/10 opacity-70"
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className={cn(collapsed ? "hidden lg:inline" : "inline")}>{item.title}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-sidebar-border/80 p-2 lg:hidden">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setCollapsed(!collapsed)}
          className="w-full rounded-xl text-sidebar-foreground hover:bg-sidebar-accent hover:text-white"
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
