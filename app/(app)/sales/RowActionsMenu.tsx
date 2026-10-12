"use client";

// A desktop list row's actions behind one ⋮ (owner, 2026-10-11: a big list
// keeps its row actions in a ⋮ on the computer and a swipe on the phone; a
// short list inside a page — an order's payments, its comments — keeps the
// always-visible pencil and bin). The project ledger's menu
// (app/(app)/projects/[id]/ProjectMovements.tsx), shared by the sales lists:
// the orders, the price list and the stock movements.

import type { ReactNode } from "react";
import { DeleteIcon, EditIcon, MoreIcon, SpinnerIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export default function RowActionsMenu({
  onEdit,
  onDelete,
  busy = false,
  children,
  className,
}: {
  onEdit: () => void;
  /** Opens the row's ConfirmDialog — the menu asks nothing itself. */
  onDelete: () => void;
  /** A delete on its way: the ⋮ turns into a spinner and stays shut. */
  busy?: boolean;
  /** More items, between עריכה and the ruled-off מחיקה. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={busy}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground", className)}
          title="פעולות"
          aria-label="פעולות"
        >
          {busy ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : <MoreIcon className="h-4 w-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-44"
        // Let the dialog an item just opened keep the focus — without this the
        // menu yanks it back to the ⋮ as it closes.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuItem className="gap-2" onSelect={onEdit}>
          <EditIcon className="h-4 w-4" />
          <span>עריכה</span>
        </DropdownMenuItem>
        {children}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onSelect={onDelete}>
          <DeleteIcon className="h-4 w-4" />
          <span>מחיקה</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
