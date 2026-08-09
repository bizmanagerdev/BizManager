"use client";

// Phone: the order's name/number goes into the top bar, and everything you can
// do to the order goes into the ⋮ beside the back arrow. The page keeps the
// breadcrumb + inline action row for desktop only.

import { useMemo, useState } from "react";
import Link from "next/link";
import { CopyIcon, DeleteIcon, EditIcon, NotificationIcon, PhoneIcon, PrintIcon, ShareIcon } from "@/components/ui/icons";
import { HeaderActionsMenu } from "@/components/layout/HeaderActionsMenu";
import { useSetPageTitle } from "@/components/layout/page-title-context";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
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

  const headerMenu = useMemo(
    () => (
      <HeaderActionsMenu>
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
        <DropdownMenuItem className="gap-2" onSelect={() => setEditOpen(true)}>
          <EditIcon className="h-4 w-4" />
          <span>עריכה</span>
        </DropdownMenuItem>
        {canManage ? (
          <>
            <DropdownMenuItem className="gap-2" onSelect={() => setLogOpen(true)}>
              <PhoneIcon className="h-4 w-4" />
              <span>תיעוד שיחה</span>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="gap-2">
              <a href={`#${remindersSectionId}`}>
                <NotificationIcon className="h-4 w-4" />
                <span>תזכורת</span>
              </a>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-destructive focus:text-destructive"
          onSelect={() => setDeleteOpen(true)}
        >
          <DeleteIcon className="h-4 w-4" />
          <span>מחיקת הזמנה</span>
        </DropdownMenuItem>
      </HeaderActionsMenu>
    ),
    [canManage, orderId, remindersSectionId, share, shareHref]
  );

  // Just "הזמנה" over the customer's name — the id is a lookup key, not a heading.
  useSetPageTitle("הזמנה", customerName, headerMenu);

  return (
    <>
      {/* Trigger-less: the ⋮ above opens these. */}
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
