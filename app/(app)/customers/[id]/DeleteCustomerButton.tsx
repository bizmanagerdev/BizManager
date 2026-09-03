"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { DeleteButton } from "@/components/ui/icon-button";
import { offlineFetch } from "@/lib/offline-queue";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { scheduleDeferredDelete } from "@/lib/undo-engine";

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

  function openConfirm() {
    setOpen(true);
  }

  function onConfirm() {
    setOpen(false);
    emitNavigationStart();
    router.push(returnHref);
    scheduleDeferredDelete({
      scope: "customer",
      id: customerId,
      message: "הלקוח נמחק",
      onCommit: async () => {
        const result = await offlineFetch("/api/customers/delete", { id: customerId }, "מחיקת לקוח");
        if (!result.queued && !result.ok) return { ok: false, error: toHebrewError(result.error, "מחיקת לקוח נכשלה.") };
        const json = result.queued ? null : (result.data as { ok?: boolean } | null);
        if (json && !json.ok) return { ok: false, error: "מחיקת לקוח נכשלה." };
        router.refresh();
        return { ok: true };
      },
    });
  }

  return (
    <>
      <DeleteButton label="מחיקת לקוח" className={className} onClick={openConfirm} />

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        destructive
        title="מחיקת לקוח"
        description={`האם למחוק את הלקוח "${customerName}"?`}
        confirmLabel="מחיקה"
        onConfirm={onConfirm}
      />
    </>
  );
}
