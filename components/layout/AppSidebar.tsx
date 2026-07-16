"use client";

import { type ReactNode, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/ui/brand-mark";
import { cn } from "@/lib/utils";
import { useNavCounts, type NavCount } from "@/lib/ui/nav-counts-store";
import type { SidebarNavItem } from "@/components/layout/nav-items";

interface Props {
  items: SidebarNavItem[];
  appName?: string;
  logo?: ReactNode;
}

const linkBase =
  "flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm text-sidebar-foreground transition-all duration-200 hover:bg-secondary hover:text-secondary-foreground hover:shadow-sm";
const linkActive =
  "bg-secondary text-secondary-foreground font-medium shadow-md shadow-secondary/30 hover:ring-2 hover:ring-white/50 hover:ring-offset-2 hover:ring-offset-sidebar";
const linkPending = "bg-white/10 opacity-70";

// Routes that share one filter bar (Flow + Reports) — switching between them via
// the sidebar carries the current filters (date/domain/…) so context isn't lost.
const FILTER_SHARED_ROUTES = new Set(["/financial", "/financial/reports"]);

// Lower = more urgent, for picking a group's roll-up tone.
const SEVERITY_ORDER: Record<NavCount["severity"], number> = { danger: 0, warning: 1, info: 2 };

function NavGroup({
  item,
  collapsed,
  navCounts,
}: {
  item: SidebarNavItem;
  collapsed: boolean;
  navCounts: Record<string, NavCount>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const children = item.children ?? [];
  const childActive = children.some((c) => pathname === c.url || pathname.startsWith(`${c.url}/`));
  const [open, setOpen] = useState(false);
  // Carry the live query string only between the filter-sharing financial routes.
  const sharedQuery =
    FILTER_SHARED_ROUTES.has(pathname) ? searchParams.toString() : "";
  // Auto-expand whenever a child route is active (no effect needed).
  const expanded = open || childActive;

  // Roll the children's counts up onto the group header, so a badge on a nested
  // route (e.g. /collections under "פיננסי") isn't invisible while collapsed.
  // Shown only when collapsed — expanded, the child rows carry their own badges.
  const rollup = children.reduce<NavCount | null>((acc, c) => {
    const b = navCounts[c.url];
    if (!b) return acc;
    if (!acc) return { count: b.count, severity: b.severity };
    return {
      count: acc.count + b.count,
      severity: SEVERITY_ORDER[b.severity] < SEVERITY_ORDER[acc.severity] ? b.severity : acc.severity,
    };
  }, null);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          linkBase,
          "w-full",
          collapsed && "justify-center px-0 lg:justify-start lg:px-2.5",
          childActive && "text-secondary-foreground"
        )}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        <span className={cn("flex-1 text-right", collapsed ? "hidden lg:inline" : "inline")}>{item.title}</span>
        {rollup && !expanded ? <NavCountBadge badge={rollup} collapsed={collapsed} /> : null}
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 transition-transform",
            expanded ? "" : "-rotate-90",
            collapsed ? "hidden lg:block" : "block"
          )}
        />
      </button>
      {expanded ? (
        <div
          className={cn(
            "mt-0.5 space-y-0.5",
            // Indent + a vertical guide line so children clearly read as sub-items
            // (only when labels are visible; icon-only mode stays un-indented).
            collapsed
              ? "lg:ms-[1.15rem] lg:border-s lg:border-sidebar-border/50 lg:ps-2"
              : "ms-[1.15rem] border-s border-sidebar-border/50 ps-2"
          )}
        >
          {children.map((child) => (
            <NavLink
              key={child.url + child.title}
              to={
                sharedQuery && FILTER_SHARED_ROUTES.has(child.url)
                  ? { pathname: child.url, query: sharedQuery }
                  : child.url
              }
              end={child.url === "/financial"}
              className={cn(
                "flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] text-sidebar-foreground/75 transition-all duration-200 hover:bg-secondary hover:text-secondary-foreground",
                collapsed && "justify-center px-0 lg:justify-start lg:px-2"
              )}
              activeClassName="bg-secondary text-secondary-foreground font-medium"
              pendingClassName={linkPending}
            >
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-50",
                  collapsed ? "hidden lg:block" : "block"
                )}
              />
              <child.icon className="h-3.5 w-3.5 shrink-0" />
              <span className={cn(collapsed ? "hidden lg:inline" : "inline")}>{child.title}</span>
              {navCounts[child.url] ? <NavCountBadge badge={navCounts[child.url]} collapsed={collapsed} /> : null}
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Small count pill next to a nav item — colored by the most urgent open item.
function NavCountBadge({ badge, collapsed }: { badge: NavCount; collapsed: boolean }) {
  const tone =
    badge.severity === "danger"
      ? "bg-destructive text-destructive-foreground"
      : badge.severity === "warning"
        ? "bg-warning text-warning-foreground"
        : "bg-sidebar-accent text-sidebar-accent-foreground";
  return (
    <span
      className={cn(
        "ms-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold leading-none",
        tone,
        // When icons-only, float the pill as a small dot-count over the icon.
        collapsed ? "hidden lg:inline-flex" : "inline-flex"
      )}
    >
      {badge.count > 99 ? "99+" : badge.count}
    </span>
  );
}

export function AppSidebar({ items, appName = "BizH", logo }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const navCounts = useNavCounts();

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen self-start md:flex shrink-0 flex-col border-e border-sidebar-border/80 bg-sidebar/95 backdrop-blur-xl transition-all duration-200",
        collapsed ? "w-16 lg:w-56" : "w-56"
      )}
    >
      <div className="flex h-14 items-center border-b border-sidebar-border/80 px-3">
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

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
        {items.map((item) =>
          item.children && item.children.length > 0 ? (
            <NavGroup key={item.title} item={item} collapsed={collapsed} navCounts={navCounts} />
          ) : (
            <NavLink
              key={item.title}
              to={item.url}
              end={item.url === "/"}
              className={cn(linkBase, collapsed && "justify-center px-0 lg:justify-start lg:px-2.5")}
              activeClassName={linkActive}
              pendingClassName={linkPending}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className={cn(collapsed ? "hidden lg:inline" : "inline")}>{item.title}</span>
              {navCounts[item.url] ? <NavCountBadge badge={navCounts[item.url]} collapsed={collapsed} /> : null}
            </NavLink>
          )
        )}
      </nav>

      <div className="border-t border-sidebar-border/80 p-2 lg:hidden">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setCollapsed(!collapsed)}
          className="w-full rounded-xl text-sidebar-foreground hover:bg-sidebar-accent hover:text-white"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
    </aside>
  );
}
