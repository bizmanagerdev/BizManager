"use client";

import { useRef, useState } from "react";
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
import { useSwipeToDismiss } from "@/components/ui/dialog-chrome";
import { t } from "@/lib/i18n/t";
import { topbarDict } from "@/lib/i18n/dictionaries/topbar";
import type { Locale } from "@/lib/i18n/types";

type Props = {
  items: SidebarNavItem[];
  moreItems?: SidebarNavItem[];
  viewerRole?: string;
  viewerLocale?: Locale;
};

export function BottomNav({ items, moreItems = [], viewerRole, viewerLocale = "he" }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBodyRef = useRef<HTMLDivElement>(null);
  const moreSwipeProps = useSwipeToDismiss({
    enabled: moreOpen,
    bodyRef: moreBodyRef,
    onDismiss: () => setMoreOpen(false),
  });

  // The + sits dead centre. Each side is its own flex-1 container (see the
  // JSX below) so the two sides always take up EXACTLY equal width — the FAB
  // stays centred whether the split is 2/2, 2/1, or anything else. An earlier
  // version balanced this by dealing an even COUNT of tabs to each side
  // (counting "עוד" as one), which only centred the FAB when the total
  // happened to be even; a worker board with an odd tab count (e.g. Arabic
  // locale's 3-item nav, no "עוד" needed) threw it off (user, 2026-08-20).
  const tabCount = items.length + (moreItems.length > 0 ? 1 : 0);
  const leading = items.slice(0, Math.ceil(tabCount / 2));
  const trailing = items.slice(Math.ceil(tabCount / 2));

  const renderTab = (item: SidebarNavItem) => (
    <NavLink
      key={item.title}
      to={item.url}
      end={item.url === "/"}
      // Same reasoning as the desktop sidebar's dashboard tab: it's always
      // mounted here, so fully prefetch it instead of leaving a dynamic route
      // uncached.
      prefetch={item.url === "/dashboard" ? true : undefined}
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
            collides/overflows when the user picks a large text size. Each side
            is its own flex-1 group — see the comment above `leading` — so the
            FAB between them always sits at the true horizontal centre. */}
        <div className="flex h-[58px] items-center gap-0.5 px-1">
          <div className="flex flex-1 items-center justify-around gap-0.5">{leading.map(renderTab)}</div>

          {/* The centre + — quick-create without leaving the page. */}
          <div className="flex shrink-0 items-center justify-center px-1">
            <QuickCreateMenu viewerRole={viewerRole} variant="fab" />
          </div>

          <div className="flex flex-1 items-center justify-around gap-0.5">
            {trailing.map(renderTab)}

            {moreItems.length > 0 && (
              <ClientOnly
                fallback={
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-sm py-1 text-sidebar-foreground/70 transition-all duration-200"
                  >
                    <MoreIcon className="h-[22px] w-[22px] shrink-0" />
                    <span className="w-full truncate text-center text-[11px] font-medium leading-none">{t(topbarDict, viewerLocale, "more")}</span>
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
                    <span className="w-full truncate text-center text-[11px] font-medium leading-none">{t(topbarDict, viewerLocale, "more")}</span>
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
                  {...moreSwipeProps}
                >
                  <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/25" aria-hidden />
                  <SheetHeader className="shrink-0 border-b border-white/10 px-6 py-4">
                    <SheetTitle className="text-sidebar-foreground">{t(topbarDict, viewerLocale, "more")}</SheetTitle>
                  </SheetHeader>
                  <div
                    ref={moreBodyRef}
                    className="grid grid-cols-3 gap-3 overflow-y-auto overscroll-contain px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-4"
                  >
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
