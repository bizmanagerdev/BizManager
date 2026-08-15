"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { DeleteButton } from "@/components/ui/icon-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { offlineFetch } from "@/lib/offline-queue";

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
  const [loading, setLoading] = useState(false);
  const [confirmOpenState, setConfirmOpenState] = useState(false);
  const confirmOpen = openProp ?? confirmOpenState;
  const setConfirmOpen = (next: boolean) => {
    setConfirmOpenState(next);
    onOpenChange?.(next);
  };
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (loading) return;

    setError(null);
    setLoading(true);

    try {
      const result = await offlineFetch("/api/orders/delete", { order_id: orderId }, "מחיקת הזמנה");
      if (!result.queued) {
        if (!result.ok) {
          setError(toHebrewError(result.error, "מחיקת הזמנה נכשלה."));
          return;
        }
        if (!(result.data as { ok?: boolean })?.ok) {
          setError("מחיקת הזמנה נכשלה.");
          return;
        }
      }

      setConfirmOpen(false);
      emitNavigationStart();
      router.push("/sales");
      router.refresh();
    } catch (e: unknown) {
      setError(toHebrewError(e, "שגיאה לא ידועה"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      {hideTrigger ? null : (
        <DeleteButton
          label="מחיקת הזמנה"
          className={className}
          loading={loading}
          onClick={() => setConfirmOpen(true)}
        />
      )}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="מחיקת הזמנה"
        description="ההזמנה, התשלומים והמסמכים המשויכים יימחקו לצמיתות. הפעולה אינה הפיכה."
        confirmLabel="מחיקה"
        cancelLabel="ביטול"
        destructive
        loading={loading}
        onConfirm={() => void onDelete()}
      />
    </div>
  );
}
