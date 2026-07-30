"use client";
import { toHebrewError } from "@/lib/error-messages";

import { type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Button } from "@/components/ui/button";
import { offlineFetch } from "@/lib/offline-queue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && loading) return;
          setOpen(next);
        }}
      >
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>מחיקת פרויקט</DialogTitle>
            <DialogDescription>
              {`למחוק את ${label}? הפעולה אינה הפיכה.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              ביטול
            </Button>
            <Button type="button" variant="destructive" onClick={() => void onDelete()} disabled={loading}>
              {loading ? "מוחק..." : "מחק פרויקט"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
