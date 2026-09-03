"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { DeleteButton } from "@/components/ui/icon-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { offlineFetch } from "@/lib/offline-queue";
import { scheduleDeferredDelete } from "@/lib/undo-engine";

export default function DeleteOrderButton({
  orderId,
  className,
  hideTrigger = false,
  open: openProp,
  onOpenChange,
}: {
  orderId: string;
  className?: string;
  /** Render only the confirm dialog — for callers that trigger it from their own menu. */
  hideTrigger?: boolean;
  /** Control the confirm dialog from outside (pairs with hideTrigger). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [confirmOpenState, setConfirmOpenState] = useState(false);
  const confirmOpen = openProp ?? confirmOpenState;
  const setConfirmOpen = (next: boolean) => {
    setConfirmOpenState(next);
    onOpenChange?.(next);
  };

  function onDelete() {
    setConfirmOpen(false);
    emitNavigationStart();
    router.push("/sales");
    // Nothing here — cascade to payments/documents/inventory movements — runs
    // until this actually commits, so undo is completely safe even for the
    // heaviest-cascade delete in the app.
    scheduleDeferredDelete({
      scope: "order",
      id: orderId,
      message: "ההזמנה נמחקה",
      onCommit: async () => {
        const result = await offlineFetch("/api/orders/delete", { order_id: orderId }, "מחיקת הזמנה");
        if (!result.queued) {
          if (!result.ok) return { ok: false, error: toHebrewError(result.error, "מחיקת הזמנה נכשלה.") };
          if (!(result.data as { ok?: boolean })?.ok) return { ok: false, error: "מחיקת הזמנה נכשלה." };
        }
        router.refresh();
        return { ok: true };
      },
    });
  }

  return (
    <div className="space-y-1">
      {hideTrigger ? null : (
        <DeleteButton label="מחיקת הזמנה" className={className} onClick={() => setConfirmOpen(true)} />
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="מחיקת הזמנה"
        description="ההזמנה, התשלומים והמסמכים המשויכים יימחקו."
        confirmLabel="מחיקה"
        cancelLabel="ביטול"
        destructive
        onConfirm={onDelete}
      />
    </div>
  );
}
