"use client";

// A customer row's actions behind one quiet ⋮ on the computer (owner,
// 2026-10-13: עריכה, + הזמנה, + פרויקט — the table had no way to edit a
// customer, and two always-visible buttons on every row). The sales lists'
// RowActionsMenu, without its מחיקה: a customer is deleted from its own page.
// The phone's cards carry the same three behind a swipe.

import { EditIcon, MoreIcon, OrderIcon, ProjectIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function CustomerRowActionsMenu({
  onEdit,
  onNewOrder,
  onNewProject,
}: {
  onEdit: () => void;
  onNewOrder: () => void;
  onNewProject: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          title="פעולות"
          aria-label="פעולות"
        >
          <MoreIcon className="h-4 w-4" />
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
        <DropdownMenuItem className="gap-2" onSelect={onNewOrder}>
          <OrderIcon className="h-4 w-4" />
          <span>+ הזמנה</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onSelect={onNewProject}>
          <ProjectIcon className="h-4 w-4" />
          <span>+ פרויקט</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
