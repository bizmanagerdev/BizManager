"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { DeleteButton } from "@/components/ui/icon-button";
import { offlineFetch } from "@/lib/offline-queue";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { scheduleDeferredAction } from "@/lib/undo-engine";

export default function DeleteProjectButton({
  projectId,
  projectName,
  redirectTo,
  onDeleted,
  onRestore,
  className,
  triggerLabel = "מחיקת פרויקט",
  hideTrigger = false,
  open: openProp,
  onOpenChange,
}: {
  projectId: string;
  projectName?: string;
  redirectTo?: string;
  onDeleted?: () => void;
  /** Called if the delete is undone before it commits — only meaningful for
   *  callers that hide the row themselves via onDeleted (e.g. a list), so it
   *  can put the row back. Navigate-away callers (redirectTo set) don't need it. */
  onRestore?: () => void;
  className?: string;
  /** The tooltip word — say WHAT is being deleted ("מחיקת הצעת מחיר"). */
  triggerLabel?: string;
  /** Render only the confirm dialog — for callers that trigger it from their own menu. */
  hideTrigger?: boolean;
  /** Control the confirm dialog from outside (pairs with hideTrigger). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  function onDelete() {
    setOpen(false);
    onDeleted?.();
    if (redirectTo) {
      emitNavigationStart();
      router.push(redirectTo);
    }
    scheduleDeferredAction({
      key: `project:delete:${projectId}`,
      message: "הפרויקט נמחק",
      onApplyOptimistic: () => {},
      onRevert: () => onRestore?.(),
      onCommit: async () => {
        const result = await offlineFetch("/api/projects/delete", { id: projectId }, "מחיקת פרויקט");
        if (!result.queued && !result.ok) {
          return { ok: false, error: toHebrewError(result.error, "מחיקת פרויקט נכשלה.") };
        }
        const json = result.queued ? null : (result.data as { ok?: boolean; warning?: string } | null);
        if (json && !json.ok) return { ok: false, error: "מחיקת פרויקט נכשלה." };
        if (json?.warning) toast.error(json.warning);
        router.refresh();
        return { ok: true };
      },
    });
  }

  const label = projectName?.trim() || "הפרויקט";

  return (
    <div className="space-y-1">
        {hideTrigger ? null : (
          <DeleteButton label={triggerLabel} className={className} onClick={() => setOpen(true)} />
        )}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        destructive
        title="מחיקת פרויקט"
        description={`למחוק את ${label}?`}
        confirmLabel="מחק פרויקט"
        onConfirm={onDelete}
      />
    </div>
  );
}
