"use client";

// Everything you can do to the customer, in two shapes over one set of dialogs
// — the order page's header menu (OrderHeaderMenu.tsx). Phone: the customer's
// name goes into the top bar ("לקוח" over the name) and the actions into the ⋮
// beside the back arrow. Desktop: what this renders — the edit pencil and a ⋮
// holding the rest — placed in the page's desktop heading (CustomerPageHeading);
// the phone's ⋮ is registered from here all the same.
//
// The ⋮ holds (owner, 2026-10-13): עריכה (the pencil, on desktop), + הזמנה,
// + פרויקט, + משימה, תיעוד שיחה, + תזכורת, and last מחיקה — which says up
// front when the customer can't be deleted, and why.

import { useCallback, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AddIcon,
  DeleteIcon,
  EditIcon,
  MoreIcon,
  NotificationIcon,
  PhoneIcon,
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
import DeleteCustomerButton from "@/app/(app)/customers/[id]/DeleteCustomerButton";

export default function CustomerHeaderMenu({
  customerId,
  customerName,
  active,
  deleteBlocker,
  canManage,
  onEdit,
  onNewTask,
  onCollectionForm,
  onActiveChange,
}: {
  customerId: string;
  customerName: string;
  active: boolean;
  /** Why this customer can't be deleted ("יש ללקוח 6 הזמנות ו-2 פרויקטים"), or null. */
  deleteBlocker: string | null;
  /** admin/office — the roles that may log a call, set a reminder or add a task. */
  canManage: boolean;
  onEdit: () => void;
  onNewTask: () => void;
  onCollectionForm: (form: "call" | "reminder") => void;
  onActiveChange: (active: boolean) => void;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const newOrderHref = `/sales/orders/new?customer_id=${encodeURIComponent(customerId)}`;
  const newProjectHref = `/projects?create=1&customer_id=${encodeURIComponent(customerId)}`;

  // The items both ⋮ menus hold. The phone's also carries עריכה — the pencil
  // is desktop only.
  const menuItems = useCallback(
    (phone: boolean): ReactNode => (
      <>
        {phone ? (
          <DropdownMenuItem className="gap-2" onSelect={onEdit}>
            <EditIcon className="h-4 w-4" />
            <span>עריכה</span>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild className="gap-2">
          <Link href={newOrderHref}>
            <AddIcon className="h-4 w-4" />
            <span>הזמנה</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="gap-2">
          <Link href={newProjectHref}>
            <AddIcon className="h-4 w-4" />
            <span>פרויקט</span>
          </Link>
        </DropdownMenuItem>
        {canManage ? (
          <>
            <DropdownMenuItem className="gap-2" onSelect={onNewTask}>
              <AddIcon className="h-4 w-4" />
              <span>משימה</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2" onSelect={() => onCollectionForm("call")}>
              <PhoneIcon className="h-4 w-4" />
              <span>תיעוד שיחה</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2" onSelect={() => onCollectionForm("reminder")}>
              <NotificationIcon className="h-4 w-4" />
              <span>תזכורת</span>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        {/* Last, and red only when it can actually happen. Blocked, it says why
            right here, and opens the explanation with "סימון כלא פעיל". */}
        <DropdownMenuItem
          className={
            deleteBlocker ? "items-start gap-2 text-muted-foreground" : "gap-2 text-destructive focus:text-destructive"
          }
          onSelect={() => setDeleteOpen(true)}
        >
          <DeleteIcon className={deleteBlocker ? "mt-0.5 h-4 w-4" : "h-4 w-4"} />
          <span className="min-w-0">
            <span className="block">מחיקת לקוח</span>
            {deleteBlocker ? <span className="block text-xs">לא ניתן — {deleteBlocker}</span> : null}
          </span>
        </DropdownMenuItem>
      </>
    ),
    [canManage, deleteBlocker, newOrderHref, newProjectHref, onCollectionForm, onEdit, onNewTask]
  );

  const headerMenu = useMemo(() => <HeaderActionsMenu>{menuItems(true)}</HeaderActionsMenu>, [menuItems]);

  // Just "לקוח" over the customer's name — the page's own heading is the bar on a phone.
  useSetPageTitle("לקוח", customerName, headerMenu);

  return (
    <>
      <div className="flex items-center gap-2">
        <EditButton onClick={onEdit} label="עריכת לקוח" />
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
            className="w-56"
            // Let the dialog an item just opened keep the focus.
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            {menuItems(false)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Trigger-less: the two ⋮ menus open it. */}
      <DeleteCustomerButton
        customerId={customerId}
        customerName={customerName}
        blocker={deleteBlocker}
        active={active}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onActiveChange={onActiveChange}
      />
    </>
  );
}
