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
  appName = "BizManager",
  logo,
  userName,
  showSearch = true,
}: Props) {
  return (
    <header className="flex items-center h-14 px-4 border-b bg-card gap-3 shrink-0">
      <div className="flex items-center gap-2 md:hidden">
        {logo ?? (
          <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-xs">
              {appName.charAt(0)}
            </span>
          </div>
        )}
        <span className="font-semibold text-base text-foreground">{appName}</span>
      </div>

      {showSearch && (
        <div className="hidden sm:flex flex-1 max-w-sm">
          <div className="relative w-full">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="חיפוש..."
              className="ps-9 h-9 bg-muted border-0 focus-visible:ring-1"
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
            className="sm:hidden text-muted-foreground"
            type="button"
          >
            <Search className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative text-muted-foreground"
          type="button"
        >
          <Bell className="h-4 w-4" />
        </Button>

        <ClientOnly
          fallback={
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-muted-foreground"
              type="button"
            >
              <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center">
                <User className="h-3.5 w-3.5" />
              </div>
              {userName && <span className="hidden sm:inline text-sm">{userName}</span>}
              <ChevronDown className="h-3 w-3" />
            </Button>
          }
        >
          <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" type="button">
              <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center">
                <User className="h-3.5 w-3.5" />
              </div>
              {userName && (
                <span className="hidden sm:inline text-sm">{userName}</span>
              )}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
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
