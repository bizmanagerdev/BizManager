"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { DeleteButton } from "@/components/ui/icon-button";
import { offlineFetch } from "@/lib/offline-queue";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export default function DeleteCustomerButton({
  customerId,
  customerName,
  returnHref,
  className,
}: {
  customerId: string;
  customerName: string;
  returnHref: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openConfirm() {
    setError(null);
    setOpen(true);
  }

  function handleOpenChange(next: boolean) {
    if (loading) return;
    if (!next) setError(null);
    setOpen(next);
  }

  async function onConfirm() {
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const result = await offlineFetch("/api/customers/delete", { id: customerId }, "מחיקת לקוח");
      if (!result.queued && !result.ok) {
        setError(toHebrewError(result.error, "מחיקת לקוח נכשלה."));
        return;
      }
      const json = result.queued ? null : (result.data as { ok?: boolean } | null);
      if (json && !json.ok) {
        setError("מחיקת לקוח נכשלה.");
        return;
      }

      if (!result.queued) toast.success("הלקוח נמחק");
      emitNavigationStart();
      setOpen(false);
      router.push(returnHref);
      router.refresh();
    } catch (e: unknown) {
      setError(toHebrewError(e, "שגיאה לא ידועה"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <DeleteButton label="מחיקת לקוח" className={className} loading={loading} onClick={openConfirm} />

      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        destructive
        title="מחיקת לקוח"
        description={`האם למחוק את הלקוח "${customerName}"? הפעולה אינה הפיכה.`}
        confirmLabel="מחיקה"
        loading={loading}
        error={error || undefined}
        onConfirm={() => void onConfirm()}
      />
    </>
  );
}
