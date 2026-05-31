"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
        <Phone className={iconOnly ? "h-4 w-4" : "me-1 h-4 w-4"} />
        {iconOnly ? null : label}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[90svh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>מעקב גבייה</DialogTitle>
            <DialogDescription>תיעוד שיחות ותזכורות מול {customerName}</DialogDescription>
          </DialogHeader>
          <CollectionTrackingPanel
            customerId={customerId}
            customerName={customerName}
            customerPhone={customerPhone}
            onChanged={() => setDirty(true)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
