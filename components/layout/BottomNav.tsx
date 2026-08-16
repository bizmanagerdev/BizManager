"use client";

import { useState } from "react";
import { MoreIcon } from "@/components/ui/icons";
import { NavLink } from "@/components/NavLink";
import { ClientOnly } from "@/components/ClientOnly";
import { QuickCreateMenu } from "@/components/layout/QuickCreateMenu";
import type { SidebarNavItem } from "@/components/layout/nav-items";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type Props = {
  items: SidebarNavItem[];
  moreItems?: SidebarNavItem[];
  viewerRole?: string;
};

export function BottomNav({ items, moreItems = [], viewerRole }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);

  // The + sits dead centre, so the tabs are dealt evenly to either side of it.
  // "עוד" counts as a tab for that split, since it renders as one.
  const tabCount = items.length + (moreItems.length > 0 ? 1 : 0);
  const leading = items.slice(0, Math.ceil(tabCount / 2));
  const trailing = items.slice(Math.ceil(tabCount / 2));

  const renderTab = (item: SidebarNavItem) => (
    <NavLink
      key={item.title}
      to={item.url}
      end={item.url === "/"}
      className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-sm py-1 text-sidebar-foreground/70 transition-all duration-200 hover:bg-white/10 hover:text-white"
      activeClassName="bg-secondary text-secondary-foreground shadow-md shadow-secondary/25"
      pendingClassName="bg-white/10 opacity-70"
    >
      <item.icon className="h-[22px] w-[22px] shrink-0" />
      <span className="w-full truncate text-center text-[11px] font-medium leading-none">{item.title}</span>
    </NavLink>
  );

  return (
    <>
      {/* The bottom nav is CHROME, so it wears the same navy as the sidebar and
          top bar (sidebar tokens), not a light bar. Idle items are light-on-navy;
          the active tab is a sky pill. The safe-area padding keeps the row above
          the iPhone home indicator. */}
      {/* data-bottom-nav: a full-height page (the tasks board) measures its own
          height against this bar's real top edge. Anchoring to window.innerHeight
          instead leaves a white strip, because mobile browsers don't agree on
          which viewport that number refers to. */}
      <nav
        data-bottom-nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-sidebar pb-[env(safe-area-inset-bottom)] text-sidebar-foreground md:hidden"
      >
        {/* Fixed px sizing (not rem) so the nav bar stays compact and never
            collides/overflows when the user picks a large text size. */}
        <div className="flex h-[58px] items-center justify-around gap-0.5 px-1">
          {leading.map(renderTab)}

          {/* The centre + — quick-create without leaving the page. */}
          <div className="flex shrink-0 items-center justify-center px-1">
            <QuickCreateMenu viewerRole={viewerRole} variant="fab" />
          </div>

          {trailing.map(renderTab)}

          {moreItems.length > 0 && (
            <ClientOnly
              fallback={
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-sm py-1 text-sidebar-foreground/70 transition-all duration-200"
                >
                  <MoreIcon className="h-[22px] w-[22px] shrink-0" />
                  <span className="w-full truncate text-center text-[11px] font-medium leading-none">עוד</span>
                </button>
              }
            >
              <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-sm py-1 text-sidebar-foreground/70 transition-all duration-200 hover:bg-white/10 hover:text-white"
                >
                  <MoreIcon className="h-[22px] w-[22px] shrink-0" />
                  <span className="w-full truncate text-center text-[11px] font-medium leading-none">עוד</span>
                </button>
              </SheetTrigger>
              {/* Navy, so "עוד" reads as the nav bar unfolding rather than a
                  separate panel. (It's the one sheet in the app that isn't light
                  — deliberate: it belongs to the chrome, not to the content.)

                  Height is capped and the GRID scrolls, header pinned — with ~17
                  items the uncapped version ran straight off the bottom of the
                  screen. svh (not vh) is the mobile-correct unit: it accounts for
                  the browser's address bar. Safe-area padding keeps the last row
                  clear of the home indicator. */}
              <SheetContent
                side="bottom"
                className="flex max-h-[80svh] flex-col rounded-t-[2rem] border-white/10 bg-sidebar p-0 text-sidebar-foreground"
              >
                <SheetHeader className="shrink-0 border-b border-white/10 px-6 py-4">
                  <SheetTitle className="text-sidebar-foreground">עוד</SheetTitle>
                </SheetHeader>
                <div className="grid grid-cols-3 gap-3 overflow-y-auto overscroll-contain px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-4">
                  {moreItems.map((item) => (
                      <NavLink
                        key={item.title}
                        to={item.url}
                        className="flex min-w-0 flex-col items-center gap-1.5 rounded-2xl p-3 text-sidebar-foreground/70 transition-colors hover:bg-white/10 hover:text-white"
                        activeClassName="bg-secondary text-secondary-foreground"
                        pendingClassName="bg-white/10 opacity-70"
                        onClick={() => setMoreOpen(false)}
                      >
                        <item.icon className="h-6 w-6 shrink-0" />
                        <span className="w-full text-center text-xs font-medium leading-tight break-words">{item.title}</span>
                      </NavLink>
                    ))}
                </div>
              </SheetContent>
              </Sheet>
            </ClientOnly>
          )}
        </div>
      </nav>

      {/* Spacer matches the nav height PLUS the safe-area inset it adds. Tagged
          so a full-height page (the tasks board) can measure how much room the
          nav takes instead of guessing at the safe-area inset, which no two
          phones agree on. */}
      <div
        data-bottom-nav-spacer
        className="md:hidden h-[calc(58px+env(safe-area-inset-bottom))] shrink-0"
      />
    </>
  );
}
