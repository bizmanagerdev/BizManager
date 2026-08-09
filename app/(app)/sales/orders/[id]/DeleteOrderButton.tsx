"use client";
import { toHebrewError } from "@/lib/error-messages";

import { type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import { DeleteIcon } from "@/components/ui/icons";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { offlineFetch } from "@/lib/offline-queue";

export default function DeleteOrderButton({
  orderId,
  iconOnly = false,
  variant = "destructive",
  className,
  children,
  hideTrigger = false,
  open: openProp,
  onOpenChange,
}: {
  orderId: string;
  iconOnly?: boolean;
  /** "ghost" (+ a destructive border) reads as a quiet last resort in an action row. */
  variant?: "destructive" | "ghost";
  className?: string;
  children?: ReactNode;
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
        <Button
          type="button"
          variant={variant}
          size="sm"
          className={
            variant === "ghost"
              ? `text-destructive hover:text-destructive ${className ?? ""}`.trim()
              : className ?? (iconOnly ? "h-9 w-9 p-0" : undefined)
          }
          aria-label="מחיקת הזמנה"
          title="מחיקת הזמנה"
          onClick={() => setConfirmOpen(true)}
          disabled={loading}
        >
          {loading ? "מוחק..." : children ?? (iconOnly ? <DeleteIcon className="h-4 w-4" /> : "מחיקת הזמנה")}
        </Button>
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
