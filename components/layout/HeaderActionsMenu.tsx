"use client";

// The phone header's ⋮ — a detail page's actions, in the one slot the top bar
// keeps beside the back arrow. Desktop keeps the actions inline on the page, so
// the trigger only exists below lg.
//
// Register the menu with the bar via useSetHeaderAction(); this component is
// only the trigger + shell so both detail pages open the same-looking menu.

import type { ReactNode } from "react";
import { MoreIcon } from "@/components/ui/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { TOPBAR_ICON_BUTTON, TOPBAR_ICON_STROKE } from "@/components/layout/topbar-icon";
import { cn } from "@/lib/utils";

export function HeaderActionsMenu({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Same fixed-px shell as every other top-bar icon (see topbar-icon.ts) —
            this used to be its own `h-8 w-8` (rem) button, which grows with the
            per-account text-size setting ([[responsive-text-scaling]]) same as
            the old title bug did: at a big scale this trigger ballooned and ate
            the space the title needed, squeezing it to a couple of letters. */}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="פעולות"
          title="פעולות"
          className={cn(TOPBAR_ICON_BUTTON, "lg:hidden")}
        >
          <MoreIcon strokeWidth={TOPBAR_ICON_STROKE} />
        </Button>
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
