"use client";

import { type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Button } from "@/components/ui/button";
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
  className,
  children,
  ariaLabel,
}: {
  projectId: string;
  projectName?: string;
  redirectTo?: string;
  onDeleted?: () => void;
  size?: "default" | "sm" | "lg" | "icon" | "icon-sm";
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
      const res = await fetch("/api/projects/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: projectId }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        warning?: string;
      };

      if (!res.ok || !json.ok) {
        setError(json.error ?? "מחיקת פרויקט נכשלה.");
        return;
      }

      setOpen(false);
      onDeleted?.();

      if (redirectTo) {
        emitNavigationStart();
        router.push(redirectTo);
      }

      router.refresh();

      if (json.warning) {
        setError(json.warning);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "שגיאה לא ידועה");
    } finally {
      setLoading(false);
    }
  }

  const label = projectName?.trim() || "הפרויקט";

  return (
    <div className="space-y-1">
      <Dialog open={open} onOpenChange={setOpen}>
        <Button
          type="button"
          variant="destructive"
          size={size}
          onClick={() => setOpen(true)}
          disabled={loading}
          className={className}
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
