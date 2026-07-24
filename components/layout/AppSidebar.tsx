"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNavCounts, type NavCount } from "@/lib/ui/nav-counts-store";
import type { SidebarNavItem } from "@/components/layout/nav-items";
import { RAIL_WIDTH, useSidebarCollapse } from "@/components/layout/sidebar-collapse-context";

interface Props {
  items: SidebarNavItem[];
}

const linkBase =
  "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-sidebar-foreground transition-all duration-200 hover:bg-secondary hover:text-secondary-foreground hover:shadow-sm";
const linkActive =
  "bg-secondary text-secondary-foreground font-medium shadow-md shadow-secondary/30 hover:ring-2 hover:ring-white/50 hover:ring-offset-2 hover:ring-offset-sidebar";
const linkPending = "bg-white/10 opacity-70";
// Sub-tab row — smaller than a top-level row. Shared with the hover flyout so a
// sub-tab is never bigger in the pop-out than it is in the sidebar itself.
const subLinkBase =
  "flex h-7 items-center gap-2 rounded-lg px-2.5 text-[13px] text-sidebar-foreground/75 transition-all duration-200 hover:bg-secondary hover:text-secondary-foreground";

// Routes that share one filter bar (Flow + Reports) — switching between them via
// the sidebar carries the current filters (date/domain/…) so context isn't lost.
const FILTER_SHARED_ROUTES = new Set(["/financial", "/financial/reports"]);

// Lower = more urgent, for picking a group's roll-up tone.
const SEVERITY_ORDER: Record<NavCount["severity"], number> = { danger: 0, warning: 1, info: 2 };

type FlyoutState = {
  item: SidebarNavItem;
  /** Viewport coords, in the RTL sense: the panel's right edge sits at `right`. */
  top: number;
  right: number;
};

type HoverHandlers = {
  onMouseEnter: (event: { currentTarget: HTMLElement }) => void;
  onMouseLeave: () => void;
};

// Flyout rows reuse the sidebar's own classes, so a row in the pop-out is the
// exact same size and color as that row in the expanded sidebar.
const flyoutTopRow = cn(linkBase, "shrink-0 whitespace-nowrap");
const flyoutSubRow = cn(subLinkBase, "shrink-0 whitespace-nowrap");

/**
 * The hover flyout for the collapsed rail: a real panel in the sidebar's own
 * visual language (dark surface, same rows) rather than the browser's tiny
 * delayed tooltip. For a group it lists the sub-tabs and they're clickable; for a
 * plain tab it's just the name.
 *
 * Portalled to <body> and positioned `fixed` because the nav is a scroll
 * container (it would clip the panel) and the sidebar's backdrop-filter makes it
 * a containing block for fixed children.
 */
function NavFlyout({
  state,
  navCounts,
  onEnter,
  onLeave,
}: {
  state: FlyoutState;
  navCounts: Record<string, NavCount>;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const sharedQuery = FILTER_SHARED_ROUTES.has(pathname) ? searchParams.toString() : "";
  const children = state.item.children ?? [];

  return createPortal(
    <div
      dir="rtl"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      // Never taller than what's left below the anchor — a long group (פיננסי has
      // nine sub-tabs) scrolls inside the panel instead of running off-screen.
      style={{ top: state.top, right: state.right, maxHeight: `calc(100vh - ${state.top}px - 1rem)` }}
      className={cn(
        "scroll-slim fixed z-50 flex min-w-[12rem] flex-col overflow-y-auto overscroll-contain shadow-elevated",
        // A single tab needs no container — it IS the row, so the blue pill floats
        // on its own instead of sitting as light-blue-on-dark-blue. A group still
        // gets the dark panel to hold its header + list together.
        children.length === 0
          ? "rounded-lg"
          : "rounded-2xl border border-sidebar-border/80 bg-sidebar p-1.5"
      )}
    >
      {children.length === 0 ? (
        // A plain tab: the flyout IS the nav row, in the sidebar's own styling.
        <NavLink
          to={state.item.url}
          end={state.item.url === "/"}
          onClick={onLeave}
          // Standalone row: it carries the filled look itself (nothing behind it).
          className={cn(flyoutTopRow, "bg-secondary text-secondary-foreground")}
          activeClassName={linkActive}
          pendingClassName={linkPending}
        >
          <state.item.icon className="h-4 w-4 shrink-0" />
          <span>{state.item.title}</span>
          {navCounts[state.item.url] ? (
            <NavCountBadge badge={navCounts[state.item.url]} collapsed={false} />
          ) : null}
        </NavLink>
      ) : (
        <>
          {/* Header, deliberately NOT row-shaped: no icon, muted and smaller with
              a hairline under it, so it reads as the group's name rather than as a
              pressed nav row. */}
          <div className="mb-1 border-b border-sidebar-border/70 px-2.5 pb-1.5 pt-1 text-xs font-semibold tracking-wide text-sidebar-foreground/55">
            <span className="whitespace-nowrap">{state.item.title}</span>
          </div>
          {children.map((child) => (
            <NavLink
              key={child.url + child.title}
              to={
                sharedQuery && FILTER_SHARED_ROUTES.has(child.url)
                  ? { pathname: child.url, query: sharedQuery }
                  : child.url
              }
              end={child.url === "/financial"}
              onClick={onLeave}
              className={flyoutSubRow}
              activeClassName="bg-secondary text-secondary-foreground font-medium"
              pendingClassName={linkPending}
            >
              <child.icon className="h-3.5 w-3.5 shrink-0" />
              <span>{child.title}</span>
              {navCounts[child.url] ? <NavCountBadge badge={navCounts[child.url]} collapsed={false} /> : null}
            </NavLink>
          ))}
        </>
      )}
    </div>,
    document.body
  );
}

function NavGroup({
  item,
  collapsed,
  navCounts,
  hover,
}: {
  item: SidebarNavItem;
  collapsed: boolean;
  navCounts: Record<string, NavCount>;
  hover: (item: SidebarNavItem) => HoverHandlers;
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
        // Icons-only mode has no labels, so hovering pops the sub-tabs out.
        {...hover(item)}
        className={cn(
          linkBase,
          "w-full",
          collapsed && "justify-center px-0",
          childActive && "text-secondary-foreground"
        )}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        <span className={cn("flex-1 text-right", collapsed ? "hidden" : "inline")}>{item.title}</span>
        {rollup && !expanded ? <NavCountBadge badge={rollup} collapsed={collapsed} /> : null}
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 transition-transform",
            expanded ? "" : "-rotate-90",
            collapsed ? "hidden" : "block"
          )}
        />
      </button>
      {expanded ? (
        <div
          // No indent: children align with their parent tab and read as sub-items
          // from the leading dot + smaller text alone, which leaves room for the label.
          className="mt-0.5 space-y-0.5"
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
              className={cn(subLinkBase, collapsed && "justify-center px-0")}
              activeClassName="bg-secondary text-secondary-foreground font-medium"
              pendingClassName={linkPending}
            >
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-50",
                  collapsed ? "hidden" : "block"
                )}
              />
              <child.icon className="h-3.5 w-3.5 shrink-0" />
              <span className={cn(collapsed ? "hidden" : "inline")}>{child.title}</span>
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
        collapsed ? "hidden" : "inline-flex"
      )}
    >
      {badge.count > 99 ? "99+" : badge.count}
    </span>
  );
}

export function AppSidebar({ items }: Props) {
  // Shared with the top bar's brand corner so the two stay the same width.
  const { collapsed, toggle: toggleCollapsed } = useSidebarCollapse();
  const navCounts = useNavCounts();

  // Hover flyout for the collapsed rail. The small close delay lets the pointer
  // travel from the icon into the panel without it vanishing underneath.
  const [flyout, setFlyout] = useState<FlyoutState | null>(null);
  const closeTimer = useRef<number | null>(null);
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setFlyout(null), 140);
  }, [cancelClose]);
  useEffect(() => cancelClose, [cancelClose]);
  useEffect(() => {
    if (!collapsed) setFlyout(null);
  }, [collapsed]);

  const hover = useCallback(
    (item: SidebarNavItem): HoverHandlers => ({
      onMouseEnter: (event) => {
        if (!collapsed) return;
        cancelClose();
        const rect = event.currentTarget.getBoundingClientRect();
        setFlyout({
          item,
          // Nudge up so the panel's first row lines up with the hovered icon.
          top: Math.max(8, rect.top - 6),
          right: window.innerWidth - rect.left + 8,
        });
      },
      onMouseLeave: scheduleClose,
    }),
    [collapsed, cancelClose, scheduleClose]
  );

  return (
    <aside
      className={cn(
        // Sits UNDER the full-width top bar (60px): the brand corner in that bar
        // is the light patch above it, so the rail itself starts straight at the nav.
        "sticky top-[60px] hidden h-[calc(100vh-60px)] self-start md:flex shrink-0 flex-col border-e border-sidebar-border/80 bg-sidebar/95 backdrop-blur-xl transition-all duration-200",
        collapsed ? RAIL_WIDTH.collapsed : RAIL_WIDTH.expanded
      )}
    >
      <nav
        className={cn(
          "scroll-slim flex-1 space-y-0.5 overflow-y-auto overscroll-contain py-2",
          collapsed ? "px-1.5" : "px-2"
        )}
      >
        {items.map((item) =>
          item.children && item.children.length > 0 ? (
            <NavGroup
              key={item.title}
              item={item}
              collapsed={collapsed}
              navCounts={navCounts}
              hover={hover}
            />
          ) : (
            <NavLink
              key={item.title}
              to={item.url}
              end={item.url === "/"}
              {...hover(item)}
              className={cn(linkBase, collapsed && "justify-center px-0")}
              activeClassName={linkActive}
              pendingClassName={linkPending}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className={cn(collapsed ? "hidden" : "inline")}>{item.title}</span>
              {navCounts[item.url] ? <NavCountBadge badge={navCounts[item.url]} collapsed={collapsed} /> : null}
            </NavLink>
          )
        )}
      </nav>

      {/* Collapse toggle — works at every screen size (it used to be phone-only,
          so on desktop the labels could never be hidden). Collapsed = icons only. */}
      <div className="border-t border-sidebar-border/80 p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleCollapsed}
          title={collapsed ? "הרחבת התפריט" : "כיווץ התפריט"}
          aria-label={collapsed ? "הרחבת התפריט" : "כיווץ התפריט"}
          aria-expanded={!collapsed}
          className={cn(
            "w-full rounded-xl text-sidebar-foreground hover:bg-sidebar-accent hover:text-white",
            collapsed ? "justify-center px-0" : "justify-end px-2.5"
          )}
        >
          {collapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
      </div>

      {flyout ? (
        <NavFlyout
          state={flyout}
          navCounts={navCounts}
          onEnter={cancelClose}
          onLeave={scheduleClose}
        />
      ) : null}
    </aside>
  );
}
