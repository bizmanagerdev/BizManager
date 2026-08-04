"use client";
import { toHebrewError } from "@/lib/error-messages";

import { type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Button } from "@/components/ui/button";
import { offlineFetch } from "@/lib/offline-queue";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export default function DeleteProjectButton({
  projectId,
  projectName,
  redirectTo,
  onDeleted,
  size = "sm",
  variant = "destructive",
  className,
  children,
  ariaLabel,
  hideTrigger = false,
  open: openProp,
  onOpenChange,
}: {
  projectId: string;
  projectName?: string;
  redirectTo?: string;
  onDeleted?: () => void;
  size?: "default" | "sm" | "lg" | "icon" | "icon-sm";
  /** "ghost" reads as a quiet last resort — used at the foot of the phone פעולות list. */
  variant?: "destructive" | "ghost";
  className?: string;
  children?: ReactNode;
  ariaLabel?: string;
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (loading) return;

    setError(null);
    setLoading(true);

    try {
      const result = await offlineFetch("/api/projects/delete", { id: projectId }, "מחיקת פרויקט");
      if (!result.queued && !result.ok) {
        setError(toHebrewError(result.error, "מחיקת פרויקט נכשלה."));
        return;
      }
      const json = result.queued
        ? null
        : (result.data as { ok?: boolean; warning?: string } | null);
      if (json && !json.ok) {
        setError("מחיקת פרויקט נכשלה.");
        return;
      }

      setOpen(false);
      onDeleted?.();

      if (redirectTo) {
        emitNavigationStart();
        router.push(redirectTo);
      }

      router.refresh();

      if (json?.warning) {
        setError(json.warning);
      }
    } catch (e: unknown) {
      setError(toHebrewError(e, "שגיאה לא ידועה"));
    } finally {
      setLoading(false);
    }
  }

  const label = projectName?.trim() || "הפרויקט";

  return (
    <div className="space-y-1">
        {hideTrigger ? null : (
          <Button
            type="button"
            variant={variant}
            size={size}
            onClick={() => setOpen(true)}
            disabled={loading}
            className={
              variant === "ghost"
                ? `text-destructive hover:text-destructive ${className ?? ""}`.trim()
                : className
            }
            aria-label={ariaLabel}
            title={ariaLabel}
          >
            {loading ? "מוחק..." : children ?? "מחיקת פרויקט"}
          </Button>
        )}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        destructive
        title="מחיקת פרויקט"
        description={`למחוק את ${label}? הפעולה אינה הפיכה.`}
        confirmLabel="מחק פרויקט"
        loading={loading}
        onConfirm={() => void onDelete()}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
