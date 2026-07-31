"use client";

// The phone header's ⋮ — a detail page's actions, in the one slot the top bar
// keeps beside the back arrow. Desktop keeps the actions inline on the page, so
// the trigger only exists below lg.
//
// Register the menu with the bar via useSetHeaderAction(); this component is
// only the trigger + shell so both detail pages open the same-looking menu.

import type { ReactNode } from "react";
import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function HeaderActionsMenu({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="פעולות"
          title="פעולות"
          className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-white/10 lg:hidden"
        >
          <MoreVertical className="h-5 w-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-56 text-right"
        // Let the dialog an item just opened keep the focus — without this the
        // menu yanks it back to the ⋮ as it closes.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default HeaderActionsMenu;
