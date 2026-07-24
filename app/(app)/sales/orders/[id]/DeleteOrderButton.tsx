"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { offlineFetch } from "@/lib/offline-queue";

export default function DeleteOrderButton({
  orderId,
  iconOnly = false,
}: {
  orderId: string;
  iconOnly?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
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
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className={iconOnly ? "h-9 w-9 p-0" : undefined}
        aria-label="מחיקת הזמנה"
        title="מחיקת הזמנה"
        onClick={() => setConfirmOpen(true)}
        disabled={loading}
      >
        {iconOnly ? <Trash2 className="h-4 w-4" /> : loading ? "מוחק..." : "מחיקת הזמנה"}
      </Button>
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
