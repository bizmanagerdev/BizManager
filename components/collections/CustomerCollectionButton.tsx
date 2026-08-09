"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { ViewDialog } from "@/components/ui/view-dialog";
import CollectionTrackingPanel from "@/components/collections/CollectionTrackingPanel";

type Props = {
  customerId: string;
  customerName: string;
  customerPhone?: string | null;
  label?: string;
  size?: "sm" | "default";
  variant?: "default" | "outline" | "secondary" | "ghost";
  iconOnly?: boolean;
  /** Refresh the page after changes so debt/last-contact stay current. */
  refreshOnClose?: boolean;
};

// Opens the מעקב גבייה (collection tracking) panel for a customer. Reused on the
// customer card and the גבייה worklist rows.
export default function CustomerCollectionButton({
  customerId,
  customerName,
  customerPhone,
  label = "מעקב גבייה",
  size = "sm",
  variant = "outline",
  iconOnly = false,
  refreshOnClose = false,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next && dirty) {
      setDirty(false);
      if (refreshOnClose) router.refresh();
    }
  }

  return (
    <>
      <Button
        type="button"
        size={iconOnly ? "icon" : size}
        variant={variant}
        className={iconOnly ? "h-8 w-8" : undefined}
        onClick={() => setOpen(true)}
      >
        <PhoneIcon className={iconOnly ? "h-4 w-4" : "me-1 h-4 w-4"} />
        {iconOnly ? null : label}
      </Button>

      <ViewDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="מעקב גבייה"
        description={`תיעוד שיחות ותזכורות מול ${customerName}`}
      >
        <CollectionTrackingPanel
          customerId={customerId}
          customerName={customerName}
          customerPhone={customerPhone}
          onChanged={() => setDirty(true)}
        />
      </ViewDialog>
    </>
  );
}
