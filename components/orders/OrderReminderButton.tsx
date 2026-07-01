"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import OrderReminderDialog from "@/components/orders/OrderReminderDialog";

// Order-detail header action: open a dialog to set a follow-up reminder on the
// order. Icon-only by default to match the neighbouring header buttons.
export default function OrderReminderButton({
  orderId,
  customerId,
  orderLabel,
  className,
  iconOnly = true,
}: {
  orderId: string;
  customerId?: string | null;
  orderLabel?: string | null;
  className?: string;
  iconOnly?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={className ?? (iconOnly ? "h-9 w-9 p-0" : "h-9")}
        title="תזכורת להזמנה"
        aria-label="תזכורת להזמנה"
        onClick={() => setOpen(true)}
      >
        <Bell className="h-4 w-4" />
        {iconOnly ? null : <span className="ms-1">תזכורת</span>}
      </Button>
      <OrderReminderDialog
        orderId={orderId}
        customerId={customerId}
        orderLabel={orderLabel}
        open={open}
        onOpenChange={setOpen}
        onSaved={() => router.refresh()}
      />
    </>
  );
}
