"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { ClientOnly } from "@/components/ClientOnly";
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
};

export function BottomNav({ items, moreItems = [] }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border/80 bg-background/88 backdrop-blur-xl md:hidden">
        {/* Fixed px sizing (not rem) so the nav bar stays compact and never
            collides/overflows when the user picks a large text size. */}
        <div className="flex h-[58px] items-center justify-around gap-0.5 px-1">
          {items.map((item) => (
            <NavLink
              key={item.title}
              to={item.url}
              end={item.url === "/"}
              className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl py-1 text-muted-foreground transition-all duration-200 hover:bg-secondary hover:text-secondary-foreground"
              activeClassName="bg-primary text-primary-foreground shadow-md shadow-primary/25 hover:ring-2 hover:ring-secondary hover:ring-offset-2 hover:ring-offset-background"
              pendingClassName="bg-primary/10 opacity-70"
            >
              <item.icon className="h-[22px] w-[22px] shrink-0" />
              <span className="w-full truncate text-center text-[11px] font-medium leading-none">{item.title}</span>
            </NavLink>
          ))}

          {moreItems.length > 0 && (
            <ClientOnly
              fallback={
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl border border-secondary/25 bg-secondary/10 py-1 text-secondary shadow-sm transition-all duration-200"
                >
                  <MoreHorizontal className="h-[22px] w-[22px] shrink-0" />
                  <span className="w-full truncate text-center text-[11px] font-medium leading-none">עוד</span>
                </button>
              }
            >
              <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl border border-secondary/25 bg-secondary/10 py-1 text-secondary shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-secondary/15"
                >
                  <MoreHorizontal className="h-[22px] w-[22px] shrink-0" />
                  <span className="w-full truncate text-center text-[11px] font-medium leading-none">עוד</span>
                </button>
              </SheetTrigger>
              <SheetContent side="bottom" className="rounded-t-[2rem] pb-8">
                <SheetHeader>
                  <SheetTitle>עוד</SheetTitle>
                </SheetHeader>
                <div className="grid grid-cols-3 gap-3 mt-4">
                  {moreItems.map((item) => (
                      <NavLink
                        key={item.title}
                        to={item.url}
                        className="flex min-w-0 flex-col items-center gap-1.5 rounded-2xl p-3 text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground"
                        activeClassName="bg-primary text-primary-foreground hover:ring-2 hover:ring-secondary hover:ring-offset-2 hover:ring-offset-background"
                        pendingClassName="bg-primary/10 opacity-70"
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

      <div className="md:hidden h-[58px] shrink-0" />
    </>
  );
}
