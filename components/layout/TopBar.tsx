"use client";

import { type ReactNode } from "react";
import { Search, Bell, LogOut, User, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClientOnly } from "@/components/ClientOnly";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

type Props = {
  appName?: string;
  logo?: ReactNode;
  userName?: string;
  showSearch?: boolean;
};

export function TopBar({
  appName = "BIZMANAGER",
  logo,
  userName,
  showSearch = true,
}: Props) {
  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border/70 bg-background/78 px-4 backdrop-blur-xl">
      <div className="flex items-center gap-2 md:hidden">
        {logo ?? (
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-destructive to-primary shadow-md shadow-destructive/20">
            <span className="text-xs font-black text-primary-foreground">
              {appName.charAt(0)}
            </span>
          </div>
        )}
        <span className="text-base font-bold tracking-[0.2em] text-primary">{appName}</span>
      </div>

      {showSearch && (
        <div className="hidden max-w-md flex-1 sm:flex">
          <div className="relative w-full">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="חיפוש..."
              className="h-10 rounded-xl border-white/50 bg-white/70 ps-9 shadow-sm shadow-primary/5 focus-visible:ring-2"
            />
          </div>
        </div>
      )}

      <div className="flex-1 sm:flex-none" />

      <div className="flex items-center gap-1">
        {showSearch && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-xl text-muted-foreground sm:hidden"
            type="button"
          >
            <Search className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative rounded-xl text-muted-foreground"
          type="button"
        >
          <Bell className="h-4 w-4" />
        </Button>

        <ClientOnly
          fallback={
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 rounded-xl border border-transparent bg-transparent text-muted-foreground hover:border-border/80 hover:bg-card/80"
              type="button"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-destructive text-primary-foreground">
                <User className="h-3.5 w-3.5" />
              </div>
              {userName && <span className="hidden sm:inline text-sm">{userName}</span>}
              <ChevronDown className="h-3 w-3" />
            </Button>
          }
        >
          <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2 rounded-xl border border-transparent bg-transparent text-muted-foreground hover:border-border/80 hover:bg-card/80" type="button">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-destructive text-primary-foreground">
                <User className="h-3.5 w-3.5" />
              </div>
              {userName && (
                <span className="hidden sm:inline text-sm">{userName}</span>
              )}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 rounded-xl">
            <DropdownMenuItem>
              <User className="h-4 w-4 me-2" />
              פרופיל
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <form action="/api/auth/logout" method="post">
              <DropdownMenuItem asChild className="text-destructive">
                <button type="submit" className="w-full flex items-center">
                  <LogOut className="h-4 w-4 me-2" />
                  התנתקות
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
          </DropdownMenu>
        </ClientOnly>
      </div>
    </header>
  );
}
