"use client";

// Everything you can do to the order, in two shapes over one set of dialogs.
// Phone: the order's name/number goes into the top bar, and the actions into
// the ⋮ beside the back arrow. Desktop: what this renders — the edit pencil
// and a ⋮ holding the rest, the project page's row (owner, 2026-10-11: it was
// five worded outline buttons; ProjectDetailsActions.tsx). Placed in the
// page's desktop heading (OrderPageHeading), which only shows from lg; the
// phone's ⋮ is registered from here all the same.

import { useCallback, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  CopyIcon,
  DeleteIcon,
  EditIcon,
  MoreIcon,
  NotificationIcon,
  PhoneIcon,
  PrintIcon,
  ShareIcon,
} from "@/components/ui/icons";
import { HeaderActionsMenu } from "@/components/layout/HeaderActionsMenu";
import { useSetPageTitle } from "@/components/layout/page-title-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditButton } from "@/components/ui/icon-button";
import LogCommunicationButton from "@/components/communications/LogCommunicationButton";
import DeleteOrderButton from "@/app/(app)/sales/orders/[id]/DeleteOrderButton";
import OrderEditDialog from "@/app/(app)/sales/orders/OrderEditDialog";
import {
  orderShareHref,
  printOrderSheet,
  type OrderShareData,
} from "@/app/(app)/sales/orders/[id]/OrderShareActions";

export default function OrderHeaderMenu({
  orderId,
  customerId,
  customerName,
  share,
  canManage,
  remindersSectionId,
}: {
  orderId: string;
  customerId?: string;
  customerName: string;
  share: OrderShareData;
  /** admin/office — the roles that may log a call or set a reminder. */
  canManage: boolean;
  remindersSectionId: string;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const shareHref = orderShareHref(share);

  // The items both ⋮ menus hold. Share and print stay two items of their own,
  // never nested (owner, 2026-10-11). The phone's menu also carries עריכה —
  // the pencil is desktop only — and תזכורת, a jump to the reminders section
  // that the desktop sees beside it.
  const menuItems = useCallback(
    (phone: boolean): ReactNode => (
      <>
        <DropdownMenuItem asChild className="gap-2">
          <Link href={`/sales/orders/new?duplicate=${orderId}`}>
            <CopyIcon className="h-4 w-4" />
            <span>שכפול</span>
          </Link>
        </DropdownMenuItem>
        {shareHref ? (
          <DropdownMenuItem asChild className="gap-2">
            <a href={shareHref} target="_blank" rel="noreferrer">
              <ShareIcon className="h-4 w-4" />
              <span>שיתוף</span>
            </a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem className="gap-2" onSelect={() => printOrderSheet(share)}>
          <PrintIcon className="h-4 w-4" />
          <span>הדפסה</span>
        </DropdownMenuItem>
        {phone ? (
          <DropdownMenuItem className="gap-2" onSelect={() => setEditOpen(true)}>
            <EditIcon className="h-4 w-4" />
            <span>עריכה</span>
          </DropdownMenuItem>
        ) : null}
        {canManage ? (
          <DropdownMenuItem className="gap-2" onSelect={() => setLogOpen(true)}>
            <PhoneIcon className="h-4 w-4" />
            <span>תיעוד שיחה</span>
          </DropdownMenuItem>
        ) : null}
        {canManage && phone ? (
          <DropdownMenuItem asChild className="gap-2">
            <a href={`#${remindersSectionId}`}>
              <NotificationIcon className="h-4 w-4" />
              <span>תזכורת</span>
            </a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-destructive focus:text-destructive"
          onSelect={() => setDeleteOpen(true)}
        >
          <DeleteIcon className="h-4 w-4" />
          <span>מחיקת הזמנה</span>
        </DropdownMenuItem>
      </>
    ),
    [canManage, orderId, remindersSectionId, share, shareHref]
  );

  const headerMenu = useMemo(() => <HeaderActionsMenu>{menuItems(true)}</HeaderActionsMenu>, [menuItems]);

  // Just "הזמנה" over the customer's name — the id is a lookup key, not a heading.
  useSetPageTitle("הזמנה", customerName, headerMenu);

  return (
    <>
      <div className="flex items-center gap-2">
        <EditButton onClick={() => setEditOpen(true)} label="עריכת הזמנה" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9"
              title="פעולות נוספות"
              aria-label="פעולות נוספות"
            >
              <MoreIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-44"
            // Let the dialog an item just opened keep the focus.
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            {menuItems(false)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Trigger-less: the pencil and the two ⋮ menus open these. */}
      <OrderEditDialog orderId={orderId} hideTrigger open={editOpen} onOpenChange={setEditOpen} />
      {canManage ? (
        <LogCommunicationButton
          entityType="order"
          entityId={orderId}
          customerId={customerId}
          defaultTopic="sales"
          hideTrigger
          open={logOpen}
          onOpenChange={setLogOpen}
        />
      ) : null}
      <DeleteOrderButton orderId={orderId} hideTrigger open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  );
}
