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
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-card border-t">
        <div className="flex items-center justify-around h-16 px-2">
          {items.map((item) => (
            <NavLink
              key={item.title}
              to={item.url}
              end={item.url === "/"}
              className="flex flex-col items-center justify-center gap-1 min-w-[4.25rem] py-2 rounded-xl text-muted-foreground transition-colors"
              activeClassName="text-primary bg-primary/15"
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
                  className="flex flex-col items-center justify-center gap-1 min-w-[4.25rem] py-2 rounded-xl text-muted-foreground transition-colors"
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
                  className="flex flex-col items-center justify-center gap-1 min-w-[4.25rem] py-2 rounded-xl text-muted-foreground transition-colors"
                >
                  <MoreHorizontal className="h-6 w-6" />
                  <span className="text-xs font-medium">עוד</span>
                </button>
              </SheetTrigger>
              <SheetContent side="bottom" className="rounded-t-2xl pb-8">
                <SheetHeader>
                  <SheetTitle>עוד</SheetTitle>
                </SheetHeader>
                <div className="grid grid-cols-4 gap-4 mt-4">
                  {moreItems.map((item) => (
                      <NavLink
                        key={item.title}
                        to={item.url}
                        className="flex flex-col items-center gap-1.5 p-3 rounded-xl text-muted-foreground hover:bg-accent transition-colors"
                        activeClassName="text-primary bg-primary/15"
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
