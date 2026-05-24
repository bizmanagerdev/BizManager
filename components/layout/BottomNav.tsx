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
        <div className="flex h-16 items-center justify-around px-2">
          {items.map((item) => (
            <NavLink
              key={item.title}
              to={item.url}
              end={item.url === "/"}
              className="flex min-w-[4.25rem] flex-col items-center justify-center gap-1 rounded-2xl py-2 text-muted-foreground transition-all duration-200 hover:bg-secondary hover:text-secondary-foreground"
              activeClassName="bg-primary text-primary-foreground shadow-md shadow-primary/25 hover:ring-2 hover:ring-secondary hover:ring-offset-2 hover:ring-offset-background"
              pendingClassName="bg-primary/10 opacity-70"
            >
              <item.icon className="h-6 w-6" />
              <span className="text-xs font-medium">{item.title}</span>
            </NavLink>
          ))}

          {moreItems.length > 0 && (
            <ClientOnly
              fallback={
                <button
                  type="button"
                  className="flex min-w-[4.25rem] flex-col items-center justify-center gap-1 rounded-2xl border border-secondary/25 bg-secondary/10 px-3 py-2 text-secondary shadow-sm transition-all duration-200"
                >
                  <MoreHorizontal className="h-6 w-6" />
                  <span className="text-xs font-medium">עוד</span>
                </button>
              }
            >
              <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-[4.25rem] flex-col items-center justify-center gap-1 rounded-2xl border border-secondary/25 bg-secondary/10 px-3 py-2 text-secondary shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-secondary/15"
                >
                  <MoreHorizontal className="h-6 w-6" />
                  <span className="text-xs font-medium">עוד</span>
                </button>
              </SheetTrigger>
              <SheetContent side="bottom" className="rounded-t-[2rem] pb-8">
                <SheetHeader>
                  <SheetTitle>עוד</SheetTitle>
                </SheetHeader>
                <div className="grid grid-cols-4 gap-4 mt-4">
                  {moreItems.map((item) => (
                      <NavLink
                        key={item.title}
                        to={item.url}
                        className="flex flex-col items-center gap-1.5 rounded-2xl p-3 text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground"
                        activeClassName="bg-primary text-primary-foreground hover:ring-2 hover:ring-secondary hover:ring-offset-2 hover:ring-offset-background"
                        pendingClassName="bg-primary/10 opacity-70"
                        onClick={() => setMoreOpen(false)}
                      >
                        <item.icon className="h-6 w-6" />
                        <span className="text-xs font-medium">{item.title}</span>
                      </NavLink>
                    ))}
                </div>
              </SheetContent>
              </Sheet>
            </ClientOnly>
          )}
        </div>
      </nav>

      <div className="md:hidden h-16 shrink-0" />
    </>
  );
}
